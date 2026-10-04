import { readUserSection, writeUserEntry, writeUserEntryField, writeUserEntries, deleteUserEntries } from "./user-flags.js";
import { getClueTemplate, buildPlayerContent, normalizeSummary, normalizeVisual } from "./clue-templates.js";
import { isClueLockedByClosedCase } from "./cases.js";
import { localize } from "../i18n.js";
import { logEvent, LOG_EVENTS } from "./event-log.js";

/**
 * Личные улики игрока: флаг clues на User, объект «originId → запись».
 * Запись — снимок шаблона на момент получения; дальнейшие правки шаблона на неё не влияют.
 *
 * @typedef {object} PlayerClue
 * @property {string} originId
 * @property {string} name
 * @property {string} img
 * @property {string} typeId
 * @property {string} description
 * @property {string[]} tags
 * @property {object} visual
 * @property {number} receivedAt
 * @property {{source: "zone"|"gm"|"player", name: string}} receivedFrom
 * @property {string} notes
 * @property {boolean} isNew
 */

const SECTION = "clues";

export const CLUE_SOURCES = {
  zone: "zone",
  gameMaster: "gm",
  player: "player"
};

/**
 * @param {User} user
 * @returns {Record<string, PlayerClue>}
 */
export function getPlayerClues(user) {
  return readUserSection(user, SECTION);
}

/**
 * @param {User} user
 * @param {string} originId
 * @returns {PlayerClue|null}
 */
export function getPlayerClue(user, originId) {
  return getPlayerClues(user)[originId] ?? null;
}

/** @param {User} user @param {string} originId */
export function userHasClue(user, originId) {
  return Boolean(getPlayerClues(user)[originId]);
}

/** Улики списком, новые сверху. @param {User} user @returns {PlayerClue[]} */
export function listPlayerClues(user) {
  return Object.values(getPlayerClues(user)).sort((first, second) => (second.receivedAt ?? 0) - (first.receivedAt ?? 0));
}

/**
 * Собрать запись улики игрока.
 * @param {string} originId
 * @param {object} content - name, img, typeId, description, tags, visual
 * @param {{source: string, name?: string}} receivedFrom
 * @param {string} [notes]
 * @returns {PlayerClue}
 */
export function buildPlayerClue(originId, content, receivedFrom, notes = "") {
  const summary = normalizeSummary(content);
  return {
    originId,
    ...summary,
    visual: normalizeVisual(content.visual),
    receivedAt: Date.now(),
    receivedFrom: { source: receivedFrom.source, name: receivedFrom.name ?? "" },
    notes: String(notes ?? ""),
    isNew: true
  };
}

/**
 * Добавить улики пользователю. Уже имеющиеся (по originId) не перезаписываются.
 * @param {User} user
 * @param {PlayerClue[]} clueRecords
 * @returns {Promise<string[]>} originId добавленных улик
 */
export async function addCluesToUser(user, clueRecords) {
  const existingClues = getPlayerClues(user);
  const newEntries = {};
  for (const clueRecord of clueRecords) {
    if (existingClues[clueRecord.originId]) continue;
    newEntries[clueRecord.originId] = clueRecord;
  }
  await writeUserEntries(user, SECTION, newEntries);
  return Object.keys(newEntries);
}

/**
 * Выдача улик ГМ: пишет прямо во флаги игроков (работает и для игроков не в сети).
 * @param {string[]} templateIds
 * @param {string[]} userIds
 * @returns {Promise<number>} сколько записей добавлено
 */
export async function grantCluesFromTemplates(templateIds, userIds) {
  let addedCount = 0;
  for (const userId of userIds) {
    const user = game.users.get(userId);
    if (!user || user.isGM) continue;
    const clueRecords = [];
    for (const templateId of templateIds) {
      const template = getClueTemplate(templateId);
      if (!template) continue;
      clueRecords.push(buildPlayerClue(template.id, buildPlayerContent(template), { source: CLUE_SOURCES.gameMaster }));
    }
    const addedIds = await addCluesToUser(user, clueRecords);
    addedCount += addedIds.length;
    if (addedIds.length) {
      const addedNames = clueRecords.filter((clueRecord) => addedIds.includes(clueRecord.originId)).map((clueRecord) => clueRecord.name);
      await logEvent(LOG_EVENTS.granted, { recipient: user.name, clues: addedNames });
    }
  }
  return addedCount;
}

/**
 * Правка копии улики конкретного игрока (ГМ). Меняет только эту копию.
 * @param {User} user
 * @param {string} originId
 * @param {object} content - name, img, typeId, description, tags, visual
 */
export async function updatePlayerClueContent(user, originId, content) {
  const existingClue = getPlayerClue(user, originId);
  if (!existingClue || warnIfLocked(originId)) return;
  const summary = normalizeSummary(content);
  await writeUserEntry(user, SECTION, originId, {
    ...existingClue,
    ...summary,
    visual: normalizeVisual(content.visual)
  });
}

/** @param {User} user @param {string} originId */
export async function deletePlayerClue(user, originId) {
  if (warnIfLocked(originId)) return;
  await deleteUserEntries(user, SECTION, [originId]);
}

/**
 * Закрытое дело блокирует улику (A11). Проверка здесь, а не только в окнах: так она ловит и редактор,
 * открытый до того, как дело закрыли.
 * @param {string} originId
 */
function warnIfLocked(originId) {
  if (!isClueLockedByClosedCase(originId)) return false;
  ui.notifications.warn(localize("Case.ClueLocked"));
  return true;
}

/**
 * Личные заметки владельца улики.
 * @param {User} user
 * @param {string} originId
 * @param {string} notes
 */
export async function setPlayerClueNotes(user, originId, notes) {
  if (!getPlayerClue(user, originId)) return;
  await writeUserEntryField(user, SECTION, originId, "notes", String(notes ?? ""));
}

/** Снять значок «новая». @param {User} user @param {string} originId */
export async function markPlayerClueSeen(user, originId) {
  const playerClue = getPlayerClue(user, originId);
  if (!playerClue?.isNew) return;
  await writeUserEntryField(user, SECTION, originId, "isNew", false);
}

/** Сколько новых (непросмотренных) улик. @param {User} user */
export function countNewPlayerClues(user) {
  return Object.values(getPlayerClues(user)).filter((playerClue) => playerClue.isNew).length;
}
