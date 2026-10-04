import { MODULE_ID, FOLDER_KEYS } from "../constants.js";
import { localize, format } from "../i18n.js";
import { canCreateCases, canManageCases, canPinAnyClue } from "../permissions.js";
import { registerGameMasterHandler, requestAsGameMaster, assertPermission } from "../socket.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";
import { ensureModuleFolder } from "./folders.js";
import { getPlayerClue } from "./player-clues.js";
import { getClueTemplate } from "./clue-templates.js";
import { buildCollaboratorOwnership, listFlaggedJournals } from "./shared-journals.js";
import { logEvent, LOG_EVENTS } from "./event-log.js";

/**
 * Дело — JournalEntry в папке «Дела», данные во флаге case.
 * Таймлайн живёт прямо в деле: timeline.events.<id>.
 * Закрытое дело блокирует прикреплённые улики (A11): их поля не правятся, сами улики не удаляются.
 */

const CASE_FLAG = "case";
export const CASE_STATUS = { open: "open", closed: "closed" };
export const TIMELINE_SIDES = { above: "above", below: "below" };

/** @param {JournalEntry} journalEntry */
function readCase(journalEntry) {
  const stored = journalEntry.flags[MODULE_ID][CASE_FLAG];
  let status = CASE_STATUS.open;
  if (stored.status === CASE_STATUS.closed) status = CASE_STATUS.closed;
  return {
    id: journalEntry.id,
    title: journalEntry.name,
    number: Number(stored.number) || 0,
    description: String(stored.description ?? ""),
    status,
    pinned: stored.pinned ?? {},
    suspectIds: Array.isArray(stored.suspectIds) ? stored.suspectIds : [],
    archivedSuspects: stored.archivedSuspects ?? {},
    timeline: { events: stored.timeline?.events ?? {} },
    createdAt: stored.createdAt ?? 0,
    closedAt: stored.closedAt ?? null
  };
}

/** Подпись дела: «Дело №1». */
export function getCaseLabel(caseData) {
  return format("Case.NumberLabel", { number: caseData.number });
}

/** @param {{includeClosed?: boolean}} [options] */
export function listCases({ includeClosed = true } = {}) {
  return listFlaggedJournals(CASE_FLAG)
    .map((journalEntry) => readCase(journalEntry))
    .filter((caseData) => includeClosed || caseData.status === CASE_STATUS.open)
    .sort((first, second) => first.number - second.number);
}

/** @param {string} caseId */
export function getCase(caseId) {
  const journalEntry = game.journal.get(caseId);
  if (!journalEntry?.flags?.[MODULE_ID]?.[CASE_FLAG]) return null;
  return readCase(journalEntry);
}

/**
 * Создание дела выполняет ГМ: номер берётся из счётчика мира.
 * @param {User} requester
 * @param {{title: string, description?: string}} caseInput
 */
async function createCaseAsGameMaster(requester, { title, description }) {
  assertPermission(canCreateCases(requester));
  const folder = await ensureModuleFolder(FOLDER_KEYS.cases);
  const number = (Number(getSetting(SETTING_KEYS.caseCounter)) || 0) + 1;
  await setSetting(SETTING_KEYS.caseCounter, number);
  let caseTitle = String(title ?? "").trim();
  if (!caseTitle) caseTitle = format("Case.NumberLabel", { number });
  const journalEntry = await JournalEntry.create({
    name: caseTitle,
    folder: folder?.id ?? null,
    ownership: buildCollaboratorOwnership(),
    flags: {
      [MODULE_ID]: {
        [CASE_FLAG]: {
          number,
          description: String(description ?? ""),
          status: CASE_STATUS.open,
          pinned: {},
          suspectIds: [],
          timeline: { events: {} },
          createdAt: Date.now(),
          closedAt: null
        }
      }
    }
  });
  return journalEntry.id;
}
registerGameMasterHandler("createCase", createCaseAsGameMaster);

/** @param {{title: string, description?: string}} caseInput */
export function createCase(caseInput) {
  return requestAsGameMaster("createCase", caseInput);
}

/**
 * Обновить поля флага дела (владелец пишет напрямую).
 * @param {string} caseId
 * @param {object} changes - пути внутри флага case
 * @param {string} [title]
 */
async function updateCaseFlag(caseId, changes, title) {
  const journalEntry = game.journal.get(caseId);
  if (!journalEntry || !canManageCases() || !journalEntry.isOwner) return;
  const update = {};
  for (const [path, value] of Object.entries(changes)) {
    update[`flags.${MODULE_ID}.${CASE_FLAG}.${path}`] = value;
  }
  if (title !== undefined) update.name = title;
  await journalEntry.update(update);
}

/**
 * Правка содержимого дела: закрытое дело не меняется, пока его не переоткроют. Проверка здесь, а не только
 * в окнах, ловит и диалог, открытый до того, как дело закрыли.
 * @returns {Promise<boolean>} false — дело закрыто, ничего не записано
 */
async function updateOpenCaseFlag(caseId, changes, title) {
  if (getCase(caseId)?.status === CASE_STATUS.closed) {
    ui.notifications.warn(localize("Case.ClosedReadOnly"));
    return false;
  }
  await updateCaseFlag(caseId, changes, title);
  return true;
}

/** @param {string} caseId @param {{title: string, description: string}} details */
export function updateCaseDetails(caseId, { title, description }) {
  let caseTitle = String(title ?? "").trim();
  const caseData = getCase(caseId);
  if (!caseTitle && caseData) caseTitle = getCaseLabel(caseData);
  return updateOpenCaseFlag(caseId, { description: String(description ?? "") }, caseTitle);
}

/** Закрыть или переоткрыть дело. @param {string} caseId @param {boolean} closed */
export async function setCaseClosed(caseId, closed) {
  const caseData = getCase(caseId);
  if (closed) {
    await updateCaseFlag(caseId, { status: CASE_STATUS.closed, closedAt: Date.now() });
    if (caseData) await logEvent(LOG_EVENTS.caseClosed, describeCase(caseData));
    return;
  }
  await updateCaseFlag(caseId, { status: CASE_STATUS.open, closedAt: null });
  if (caseData) await logEvent(LOG_EVENTS.caseReopened, describeCase(caseData));
}

/** Дело для журнала событий: номер и название (подпись собирается при показе, на языке читателя). @param {object} caseData */
function describeCase(caseData) {
  return { caseNumber: caseData.number, caseTitle: caseData.title };
}

/** @param {string} caseId */
export async function deleteCase(caseId) {
  const journalEntry = game.journal.get(caseId);
  if (!journalEntry || !game.user.isGM) return;
  await journalEntry.delete();
}

/**
 * Прикрепить улику. Профайлер — только свою (A5), ГМ — любую.
 * Снимок берётся из копии владельца, а если её нет — из шаблона.
 * @param {string} caseId
 * @param {string} originId
 * @param {string} [ownerUserId] - чей список улик был источником перетаскивания
 * @returns {Promise<boolean|null>} null — дело закрыто (уведомление уже показано)
 */
export async function pinClueToCase(caseId, originId, ownerUserId) {
  if (!canManageCases()) return false;
  if (getCase(caseId)?.status === CASE_STATUS.closed) {
    ui.notifications.warn(localize("Case.ClosedReadOnly"));
    return null;
  }
  let sourceClue = getPlayerClue(game.user, originId);
  if (!sourceClue && canPinAnyClue()) {
    const ownerUser = game.users.get(ownerUserId);
    if (ownerUser) sourceClue = getPlayerClue(ownerUser, originId);
    if (!sourceClue) sourceClue = getClueTemplate(originId);
  }
  if (!sourceClue) return false;
  await updateCaseFlag(caseId, {
    [`pinned.${originId}`]: {
      originId,
      name: sourceClue.name,
      img: sourceClue.img,
      description: sourceClue.description,
      pinnedBy: game.user.id,
      pinnedByName: game.user.name,
      pinnedAt: Date.now()
    }
  });
  const caseData = getCase(caseId);
  if (caseData) await logEvent(LOG_EVENTS.pinned, { clue: sourceClue.name, ...describeCase(caseData) });
  return true;
}

/** @param {string} caseId @param {string} originId */
export function unpinClueFromCase(caseId, originId) {
  return updateOpenCaseFlag(caseId, { [`pinned.-=${originId}`]: null });
}

/** @param {string} caseId @param {string} suspectId */
export function linkSuspectToCase(caseId, suspectId) {
  const caseData = getCase(caseId);
  if (!caseData || caseData.suspectIds.includes(suspectId)) return null;
  return updateOpenCaseFlag(caseId, { suspectIds: [...caseData.suspectIds, suspectId] });
}

/** Отвязка снимает и архивный снимок подозреваемого. @param {string} caseId @param {string} suspectId */
export function unlinkSuspectFromCase(caseId, suspectId) {
  const caseData = getCase(caseId);
  if (!caseData) return null;
  return updateOpenCaseFlag(caseId, {
    suspectIds: caseData.suspectIds.filter((linkedId) => linkedId !== suspectId),
    [`archivedSuspects.-=${suspectId}`]: null
  });
}

/** Дела, к которым привязан подозреваемый. @param {string} suspectId */
export function listCasesWithSuspect(suspectId) {
  return listCases().filter((caseData) => caseData.suspectIds.includes(suspectId));
}

/**
 * Досье удаляют, а дела должны остаться в первозданном виде: в каждое дело, где подозреваемый привязан,
 * пишется его снимок, и дальше дело показывает его как архивного подозреваемого.
 * @param {{id: string, name: string, portrait: string, description: string, appearance: string, tags: string[]}} suspect
 */
export async function archiveSuspectInCases(suspect) {
  const snapshot = {
    id: suspect.id,
    name: suspect.name,
    portrait: suspect.portrait,
    description: suspect.description,
    appearance: suspect.appearance,
    tags: suspect.tags,
    archivedAt: Date.now()
  };
  for (const caseData of listCasesWithSuspect(suspect.id)) {
    await updateCaseFlag(caseData.id, { [`archivedSuspects.${suspect.id}`]: snapshot });
  }
}

/** Снимок архивного подозреваемого из любого дела, где он есть. @param {string} suspectId */
export function getArchivedSuspect(suspectId) {
  for (const caseData of listCases()) {
    const snapshot = caseData.archivedSuspects[suspectId];
    if (snapshot) return { ...snapshot, archived: true };
  }
  return null;
}

/**
 * Создать или изменить событие таймлайна.
 * @param {string} caseId
 * @param {{id?: string, title: string, dateTime: string, image: string, side: string}} eventInput
 */
export function saveTimelineEvent(caseId, eventInput) {
  let eventId = eventInput.id;
  if (!eventId) eventId = foundry.utils.randomID();
  let side = TIMELINE_SIDES.above;
  if (eventInput.side === TIMELINE_SIDES.below) side = TIMELINE_SIDES.below;
  return updateOpenCaseFlag(caseId, {
    [`timeline.events.${eventId}`]: {
      id: eventId,
      title: String(eventInput.title ?? "").trim(),
      dateTime: String(eventInput.dateTime ?? ""),
      image: String(eventInput.image ?? ""),
      side
    }
  });
}

/** @param {string} caseId @param {string} eventId */
export function deleteTimelineEvent(caseId, eventId) {
  return updateOpenCaseFlag(caseId, { [`timeline.events.-=${eventId}`]: null });
}

/** События, отсортированные по дате. @param {object} caseData */
export function getSortedTimelineEvents(caseData) {
  return Object.values(caseData.timeline.events).sort((first, second) => String(first.dateTime).localeCompare(String(second.dateTime)));
}

/**
 * Дела, к которым прикреплена улика (для тега с номером дела у игрока, A12).
 * @param {string} originId
 */
export function listCasesWithClue(originId) {
  return listCases().filter((caseData) => Boolean(caseData.pinned[originId]));
}

/**
 * Индекс «originId → дела» за один проход по делам: для списков на сотни улик вместо поиска по делам для каждой.
 * @returns {Map<string, object[]>}
 */
export function buildCaseIndex() {
  const caseIndex = new Map();
  for (const caseData of listCases()) {
    for (const originId of Object.keys(caseData.pinned)) {
      if (!caseIndex.has(originId)) caseIndex.set(originId, []);
      caseIndex.get(originId).push(caseData);
    }
  }
  return caseIndex;
}

/** Улика закреплена закрытым делом (A11). @param {string} originId */
export function isClueLockedByClosedCase(originId) {
  return listCasesWithClue(originId).some((caseData) => caseData.status === CASE_STATUS.closed);
}

/** Данные для экспорта. */
export function exportCases() {
  return listCases().map((caseData) => foundry.utils.deepClone(caseData));
}

/**
 * Импорт дела с сохранением id (только ГМ).
 * @param {object} caseData
 */
export async function createCaseWithId(caseData) {
  const folder = await ensureModuleFolder(FOLDER_KEYS.cases);
  const { id, title, ...flagData } = caseData;
  await JournalEntry.create({
    _id: id,
    name: title,
    folder: folder?.id ?? null,
    ownership: buildCollaboratorOwnership(),
    flags: { [MODULE_ID]: { [CASE_FLAG]: flagData } }
  }, { keepId: true });
}

/**
 * Заменить данные существующего дела при импорте (только ГМ).
 * @param {object} caseData
 */
export async function replaceCaseData(caseData) {
  const journalEntry = game.journal.get(caseData.id);
  if (!journalEntry) return;
  const { id, title, ...flagData } = caseData;
  await journalEntry.update({ name: title, [`flags.${MODULE_ID}.-=${CASE_FLAG}`]: null });
  await journalEntry.update({ [`flags.${MODULE_ID}.${CASE_FLAG}`]: flagData });
}
