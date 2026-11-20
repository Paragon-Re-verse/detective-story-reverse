import { MODULE_ID, FOLDER_KEYS } from "../constants.js";
import { localize, format } from "../i18n.js";
import { canCreateCases, canManageCases, canPinAnyClue, isProfiler } from "../permissions.js";
import { registerGameMasterHandler, requestAsGameMaster, assertPermission } from "../socket.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";
import { ensureModuleFolder } from "./folders.js";
import { getPlayerClue } from "./player-clues.js";
import { getClueTemplate } from "./clue-templates.js";
import { buildCollaboratorOwnership, listFlaggedJournals } from "./shared-journals.js";
import { logEvent, LOG_EVENTS } from "./event-log.js";
import { TIMELINE_MODES, parseTimelineTime } from "./timeline-layout.js";

/**
 * Дело — JournalEntry в папке «Дела», данные во флаге case.
 * Таймлайн живёт прямо в деле: timeline.events.<id>.
 * Закрытое дело блокирует прикреплённые улики (A11): их поля не правятся, сами улики не удаляются.
 */

const CASE_FLAG = "case";
export const CASE_STATUS = { open: "open", closed: "closed" };
/** Видимость события таймлайна: всем, только ГМ, или игроку, у которого есть связанная улика (п. 23). */
export const TIMELINE_VISIBILITY = { visible: "visible", hidden: "hidden", onClue: "onClue" };
/** Решение ГМ по версии профайлера. */
export const THEORY_VERDICTS = { correct: "correct", wrong: "wrong" };

/** Список строк-id без пустых и повторов. */
function readIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry)).filter((entry) => entry.length > 0))];
}

/**
 * Событие таймлайна в нормальном виде. Старые события (1.0–1.1) хранили dateTime и side: dateTime читается как начало,
 * side больше не нужен — сторона выбирается раскладкой.
 * @param {object} stored
 */
export function normalizeTimelineEvent(stored = {}) {
  let visibility = TIMELINE_VISIBILITY.visible;
  if (Object.values(TIMELINE_VISIBILITY).includes(stored.visibility)) visibility = stored.visibility;
  let color = "";
  if (/^#[0-9a-f]{6}$/i.test(String(stored.color ?? ""))) color = stored.color;
  return {
    id: String(stored.id ?? ""),
    title: String(stored.title ?? "").trim(),
    description: String(stored.description ?? ""),
    start: String(stored.start ?? stored.dateTime ?? ""),
    end: String(stored.end ?? ""),
    approximate: Boolean(stored.approximate),
    location: String(stored.location ?? "").trim(),
    color,
    image: String(stored.image ?? ""),
    clueIds: readIdList(stored.clueIds),
    suspectIds: readIdList(stored.suspectIds),
    visibility
  };
}

/** @param {object} stored */
function readSolution(stored = {}) {
  return {
    suspectIds: readIdList(stored.suspectIds),
    clueIds: readIdList(stored.clueIds),
    motive: String(stored.motive ?? ""),
    method: String(stored.method ?? ""),
    text: String(stored.text ?? ""),
    revealed: Boolean(stored.revealed),
    revealedAt: stored.revealedAt ?? null
  };
}

/** @param {object} stored */
function readTheory(stored = {}) {
  let verdict = null;
  if (Object.values(THEORY_VERDICTS).includes(stored.verdict)) verdict = stored.verdict;
  return {
    id: String(stored.id ?? ""),
    authorId: String(stored.authorId ?? ""),
    authorName: String(stored.authorName ?? ""),
    suspectIds: readIdList(stored.suspectIds),
    clueIds: readIdList(stored.clueIds),
    motive: String(stored.motive ?? ""),
    method: String(stored.method ?? ""),
    createdAt: Number(stored.createdAt) || 0,
    verdict,
    decidedAt: stored.decidedAt ?? null
  };
}

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
    folders: stored.folders ?? {},
    suspectIds: Array.isArray(stored.suspectIds) ? stored.suspectIds : [],
    memberIds: readIdList(stored.memberIds),
    archivedSuspects: stored.archivedSuspects ?? {},
    timeline: readTimeline(stored.timeline),
    theories: Object.fromEntries(Object.entries(stored.theories ?? {}).map(([theoryId, theory]) => [theoryId, readTheory(theory)])),
    solution: readSolution(stored.solution),
    clueSources: { folderIds: readIdList(stored.clueSources?.folderIds), templateIds: readIdList(stored.clueSources?.templateIds) },
    createdAt: stored.createdAt ?? 0,
    closedAt: stored.closedAt ?? null
  };
}

/** @param {object} storedTimeline */
function readTimeline(storedTimeline = {}) {
  let mode = TIMELINE_MODES.date;
  if (storedTimeline.mode === TIMELINE_MODES.day) mode = TIMELINE_MODES.day;
  const events = {};
  for (const [eventId, storedEvent] of Object.entries(storedTimeline.events ?? {})) {
    events[eventId] = normalizeTimelineEvent({ ...storedEvent, id: storedEvent?.id || eventId });
  }
  return { mode, events };
}

/**
 * Видит ли пользователь дело. Несколько групп игроков могут вести разные дела в одном мире (п. 16):
 * у дела есть участники, и игрок видит только дела, где он участник. Дело без участников видят все.
 * @param {object} caseData
 * @param {User} [user]
 */
export function canSeeCase(caseData, user = game.user) {
  if (!caseData) return false;
  if (user.isGM || !caseData.memberIds.length) return true;
  return caseData.memberIds.includes(user.id);
}

/** Ведёт ли пользователь дело: ГМ — любое, профайлер — дела, которые он видит. */
export function canManageCase(caseData, user = game.user) {
  return canManageCases(user) && canSeeCase(caseData, user);
}

/** Открытые дела, которые ведёт игрок, — «текущие дела» в его списке улик (п. 18). */
export function listActiveCasesFor(user = game.user) {
  return listCases({ includeClosed: false }).filter((caseData) => canSeeCase(caseData, user));
}

/** Участники дела (задаёт ГМ). */
export function setCaseMembers(caseId, memberIds) {
  if (!game.user.isGM) return false;
  return updateCaseFlag(caseId, { memberIds: readIdList(memberIds) });
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
          folders: {},
          memberIds: [],
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
  if (!journalEntry || !canManageCase(getCase(caseId)) || !journalEntry.isOwner) return;
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
export async function updateOpenCaseFlag(caseId, changes, title) {
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
export function describeCase(caseData) {
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
 * @param {string|null} [folderId] - папка дела; без неё улика остаётся в своей папке (или в корне, если новая)
 * @returns {Promise<boolean|null>} null — дело закрыто (уведомление уже показано)
 */
export async function pinClueToCase(caseId, originId, ownerUserId, folderId) {
  if (!canManageCase(getCase(caseId))) return false;
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
  const pinnedRecord = buildPinnedClue(originId, sourceClue);
  if (folderId !== undefined) pinnedRecord.folderId = folderId;
  await updateCaseFlag(caseId, { [`pinned.${originId}`]: pinnedRecord });
  const caseData = getCase(caseId);
  if (caseData) await logEvent(LOG_EVENTS.pinned, { clue: sourceClue.name, ...describeCase(caseData) });
  return true;
}

/**
 * Запись прикреплённой улики (снимок названия, картинки и описания).
 * @param {string} originId
 * @param {{name: string, img: string, description: string}} sourceClue
 */
export function buildPinnedClue(originId, sourceClue) {
  return {
    originId,
    name: sourceClue.name,
    img: sourceClue.img,
    description: sourceClue.description,
    pinnedBy: game.user.id,
    pinnedByName: game.user.name,
    pinnedAt: Date.now()
  };
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
 * Создать или изменить событие таймлайна. Конец раньше начала не сохраняется: событие становится точкой.
 * @param {string} caseId
 * @param {object} eventInput - поля normalizeTimelineEvent
 */
export function saveTimelineEvent(caseId, eventInput) {
  let eventId = eventInput.id;
  if (!eventId) eventId = foundry.utils.randomID();
  const timelineEvent = normalizeTimelineEvent({ ...eventInput, id: eventId });
  const mode = getCase(caseId)?.timeline.mode ?? TIMELINE_MODES.date;
  const startMinutes = parseTimelineTime(timelineEvent.start, mode);
  const endMinutes = parseTimelineTime(timelineEvent.end, mode);
  if (endMinutes === null || startMinutes === null || endMinutes <= startMinutes) timelineEvent.end = "";
  return updateOpenCaseFlag(caseId, { [`timeline.events.${eventId}`]: timelineEvent });
}

/** Сдвинуть событие по шкале (перетаскивание): меняются только начало и конец. */
export function moveTimelineEvent(caseId, eventId, start, end) {
  return updateOpenCaseFlag(caseId, { [`timeline.events.${eventId}.start`]: start, [`timeline.events.${eventId}.end`]: end });
}

/** Обычные даты или «день N, время». Уже введённые значения другого режима остаются, но не разбираются. */
export function setTimelineMode(caseId, mode) {
  let timelineMode = TIMELINE_MODES.date;
  if (mode === TIMELINE_MODES.day) timelineMode = TIMELINE_MODES.day;
  return updateOpenCaseFlag(caseId, { "timeline.mode": timelineMode });
}

/**
 * Видно ли событие пользователю. ГМ видит всё; скрытое — только ГМ; «по улике» — тем, у кого есть
 * хотя бы одна из связанных улик.
 * @param {object} timelineEvent
 * @param {(originId: string) => boolean} hasClue
 */
export function isTimelineEventVisible(timelineEvent, hasClue, isGameMaster = game.user.isGM) {
  if (isGameMaster) return true;
  if (timelineEvent.visibility === TIMELINE_VISIBILITY.hidden) return false;
  if (timelineEvent.visibility === TIMELINE_VISIBILITY.onClue) return timelineEvent.clueIds.some((originId) => hasClue(originId));
  return true;
}

/** @param {string} caseId @param {string} eventId */
export function deleteTimelineEvent(caseId, eventId) {
  return updateOpenCaseFlag(caseId, { [`timeline.events.-=${eventId}`]: null });
}

/* -------------------------------------------- */
/*  Версии профайлеров и разгадка               */
/* -------------------------------------------- */

/**
 * Профайлер выдвигает версию (п. 7). Каждая отправка — новая запись: ГМ видит всю историю (п. 12).
 * @param {string} caseId
 * @param {{suspectIds: string[], clueIds: string[], motive: string, method: string}} theoryInput
 */
export async function submitTheory(caseId, theoryInput) {
  if (!isProfiler()) return false;
  const theoryId = foundry.utils.randomID();
  const theory = readTheory({
    ...theoryInput,
    id: theoryId,
    authorId: game.user.id,
    authorName: game.user.name,
    createdAt: Date.now()
  });
  return updateOpenCaseFlag(caseId, { [`theories.${theoryId}`]: theory });
}

/** Решение ГМ по версии: верно, неверно или снять решение (null). */
export function decideTheory(caseId, theoryId, verdict) {
  if (!game.user.isGM) return false;
  let storedVerdict = null;
  if (Object.values(THEORY_VERDICTS).includes(verdict)) storedVerdict = verdict;
  let decidedAt = null;
  if (storedVerdict) decidedAt = Date.now();
  return updateOpenCaseFlag(caseId, { [`theories.${theoryId}.verdict`]: storedVerdict, [`theories.${theoryId}.decidedAt`]: decidedAt });
}

/** Разгадка дела, которую ГМ задаёт заранее (подсказка «совпало / не совпало», п. 9). */
export function saveSolution(caseId, solutionInput) {
  if (!game.user.isGM) return false;
  // Отметку «показана» меняет только закрытие с показом: здесь её не пишем, чтобы не открыть развязку заново.
  const { revealed, revealedAt, ...solution } = readSolution(solutionInput);
  return updateOpenCaseFlag(caseId, { solution });
}

/**
 * Закрыть дело после решения; показывать ли развязку игрокам, ГМ выбирает сам (п. 11).
 * Развязку можно показать и позже, у уже закрытого дела.
 */
export async function closeCaseWithSolution(caseId, reveal) {
  if (!game.user.isGM || !getCase(caseId)) return;
  if (getCase(caseId).status !== CASE_STATUS.closed) await setCaseClosed(caseId, true);
  if (reveal) await updateCaseFlag(caseId, { "solution.revealed": true, "solution.revealedAt": Date.now() });
}

/**
 * Совпадение версии с разгадкой: подозреваемые — тот же набор, улики — все улики разгадки есть в версии.
 * null — разгадка в этой части не задана.
 * @param {object} theory
 * @param {object} solution
 */
export function compareTheory(theory, solution) {
  let suspectsMatch = null;
  if (solution.suspectIds.length) {
    suspectsMatch = theory.suspectIds.length === solution.suspectIds.length && solution.suspectIds.every((suspectId) => theory.suspectIds.includes(suspectId));
  }
  let cluesMatch = null;
  if (solution.clueIds.length) cluesMatch = solution.clueIds.every((originId) => theory.clueIds.includes(originId));
  return { suspectsMatch, cluesMatch };
}

/** Источники «всех улик дела» для прогресса: папки библиотеки и отдельные шаблоны (п. 14). */
export function saveCaseClueSources(caseId, { folderIds, templateIds }) {
  if (!game.user.isGM) return false;
  return updateOpenCaseFlag(caseId, { clueSources: { folderIds: readIdList(folderIds), templateIds: readIdList(templateIds) } });
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
