import { MODULE_ID } from "../constants.js";
import { readUserSection } from "./user-flags.js";

/**
 * Журнал событий модуля: кто что нашёл, передал, выставил на доску.
 * Каждый пользователь пишет свои события в свой User (раздел log) — запись работает и без ГМ в сети,
 * а окно ГМ собирает общую ленту из всех пользователей. На пользователя хранится не больше LOG_LIMIT
 * последних записей: самые старые удаляются той же записью, что добавляет новую.
 *
 * @typedef {{id: string, type: string, at: number, details: object}} LogEntry
 */

const SECTION = "log";
const LOG_LIMIT = 200;

export const LOG_EVENTS = {
  found: "found",
  failed: "failed",
  transferSent: "transferSent",
  transferAccepted: "transferAccepted",
  transferDeclined: "transferDeclined",
  placedOnBoard: "placedOnBoard",
  shownInChat: "shownInChat",
  granted: "granted",
  pinned: "pinned",
  caseClosed: "caseClosed",
  caseReopened: "caseReopened",
  levelOpened: "levelOpened"
};

/**
 * Записать событие текущего пользователя.
 * @param {string} type - один из LOG_EVENTS
 * @param {object} [details] - имена и подписи на момент события (ленте не нужны живые документы)
 */
export async function logEvent(type, details = {}) {
  const entryId = foundry.utils.randomID();
  const changes = {
    [`flags.${MODULE_ID}.${SECTION}.${entryId}`]: { id: entryId, type, at: Date.now(), details }
  };
  const existingEntries = Object.values(readUserSection(game.user, SECTION)).sort((first, second) => first.at - second.at);
  const overflowCount = existingEntries.length + 1 - LOG_LIMIT;
  for (const oldEntry of existingEntries.slice(0, Math.max(0, overflowCount))) {
    changes[`flags.${MODULE_ID}.${SECTION}.-=${oldEntry.id}`] = null;
  }
  try {
    await game.user.update(changes);
  } catch (error) {
    // Журнал вспомогательный: его сбой не должен прерывать само действие.
    console.warn(`${MODULE_ID} | log`, error);
  }
}

/**
 * Все события всех пользователей, новые сверху.
 * @returns {(LogEntry & {user: User})[]}
 */
export function listEventLog() {
  const entries = [];
  for (const user of game.users) {
    for (const entry of Object.values(readUserSection(user, SECTION))) {
      if (entry?.type) entries.push({ ...entry, user });
    }
  }
  return entries.sort((first, second) => second.at - first.at);
}

/** Очистить журнал у всех пользователей (только ГМ). */
export async function clearEventLog() {
  if (!game.user.isGM) return;
  for (const user of game.users) {
    if (!user.flags?.[MODULE_ID]?.[SECTION]) continue;
    await user.update({ [`flags.${MODULE_ID}.-=${SECTION}`]: null });
  }
}
