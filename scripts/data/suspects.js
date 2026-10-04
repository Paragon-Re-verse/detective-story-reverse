import { MODULE_ID, FOLDER_KEYS, BOARD_ASSET_PATH } from "../constants.js";
import { localize } from "../i18n.js";
import { canEditSuspects } from "../permissions.js";
import { registerGameMasterHandler, requestAsGameMaster, assertPermission } from "../socket.js";
import { ensureModuleFolder } from "./folders.js";
import { readUserSection, writeUserEntry } from "./user-flags.js";
import { normalizeTags } from "./clue-templates.js";
import { buildCollaboratorOwnership, listFlaggedJournals } from "./shared-journals.js";
import { archiveSuspectInCases } from "./cases.js";

/**
 * Подозреваемый — JournalEntry в папке «Подозреваемые», данные во флаге suspect.
 * Досье общее; личные заметки к подозреваемому — у каждого игрока в suspectNotes.<id>.
 */

const SUSPECT_FLAG = "suspect";
const NOTES_SECTION = "suspectNotes";

/** @param {object} suspectData */
function normalizeSuspect(suspectData = {}) {
  return {
    name: String(suspectData.name ?? "").trim() || localize("Suspect.Unnamed"),
    flag: {
      portrait: String(suspectData.portrait || `${BOARD_ASSET_PATH}/placeholder.webp`),
      description: String(suspectData.description ?? ""),
      appearance: String(suspectData.appearance ?? ""),
      tags: normalizeTags(suspectData.tags)
    }
  };
}

/** @param {JournalEntry} journalEntry */
function readSuspect(journalEntry) {
  const stored = journalEntry.flags[MODULE_ID][SUSPECT_FLAG];
  const { flag } = normalizeSuspect(stored);
  return { id: journalEntry.id, name: journalEntry.name, ...flag, canEdit: journalEntry.isOwner && canEditSuspects() };
}

export function listSuspects() {
  return listFlaggedJournals(SUSPECT_FLAG)
    .map((journalEntry) => readSuspect(journalEntry))
    .sort((first, second) => first.name.localeCompare(second.name, game.i18n.lang));
}

/** @param {string} suspectId */
export function getSuspect(suspectId) {
  const journalEntry = game.journal.get(suspectId);
  if (!journalEntry?.flags?.[MODULE_ID]?.[SUSPECT_FLAG]) return null;
  return readSuspect(journalEntry);
}

/**
 * Создание выполняет ГМ (у профайлера нет права создавать общие документы, A1).
 * @param {User} requester
 * @param {object} suspectData
 * @param {{id?: string}} [options]
 */
async function createSuspectAsGameMaster(requester, suspectData, { id } = {}) {
  assertPermission(canEditSuspects(requester));
  const folder = await ensureModuleFolder(FOLDER_KEYS.suspects);
  const { name, flag } = normalizeSuspect(suspectData);
  const createData = {
    name,
    folder: folder?.id ?? null,
    ownership: buildCollaboratorOwnership(),
    flags: { [MODULE_ID]: { [SUSPECT_FLAG]: flag } }
  };
  let createOptions = {};
  if (id) {
    createData._id = id;
    createOptions = { keepId: true };
  }
  const journalEntry = await JournalEntry.create(createData, createOptions);
  return journalEntry.id;
}
registerGameMasterHandler("createSuspect", createSuspectAsGameMaster);

/** @param {object} suspectData @returns {Promise<string|null>} id */
export function createSuspect(suspectData) {
  return requestAsGameMaster("createSuspect", suspectData);
}

/** Импорт с сохранением id (только ГМ). */
export function createSuspectWithId(suspectData, id) {
  return createSuspectAsGameMaster(game.user, suspectData, { id });
}

/**
 * Правка: ГМ и профайлер — владельцы журнала, пишут напрямую, без ведущего.
 * @param {string} suspectId
 * @param {object} suspectData
 */
export async function updateSuspect(suspectId, suspectData) {
  const journalEntry = game.journal.get(suspectId);
  if (!journalEntry || !canEditSuspects()) return;
  const { name, flag } = normalizeSuspect(suspectData);
  await journalEntry.update({ name, [`flags.${MODULE_ID}.${SUSPECT_FLAG}`]: flag });
}

/**
 * Удалить досье. В делах, где подозреваемый привязан, он остаётся архивным (снимок пишется до удаления).
 * @param {string} suspectId
 */
export async function deleteSuspect(suspectId) {
  const journalEntry = game.journal.get(suspectId);
  if (!journalEntry || !canEditSuspects() || !journalEntry.isOwner) return;
  await archiveSuspectInCases(readSuspect(journalEntry));
  await journalEntry.delete();
}

/** Личные заметки текущего игрока. @param {string} suspectId */
export function getSuspectNotes(suspectId, user = game.user) {
  return String(readUserSection(user, NOTES_SECTION)[suspectId] ?? "");
}

/** @param {string} suspectId @param {string} notes */
export async function setSuspectNotes(suspectId, notes) {
  await writeUserEntry(game.user, NOTES_SECTION, suspectId, String(notes ?? ""));
}

/** Данные для экспорта. */
export function exportSuspects() {
  return listSuspects().map(({ canEdit, ...suspect }) => suspect);
}
