import { MODULE_ID } from "../constants.js";
import { getSetting, SETTING_KEYS } from "../settings.js";

/**
 * Общие журналы модуля (подозреваемые и дела): ГМ и профайлеры — OWNER, остальные — OBSERVER.
 */

/** Права для общего журнала по текущему списку профайлеров. */
export function buildCollaboratorOwnership() {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  for (const profilerId of getSetting(SETTING_KEYS.profilers) ?? []) {
    ownership[profilerId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  }
  return ownership;
}

/**
 * Журналы модуля с флагом заданного вида.
 * @param {string} flagName - suspect или case
 * @returns {JournalEntry[]}
 */
export function listFlaggedJournals(flagName) {
  return game.journal.filter((journalEntry) => Boolean(journalEntry.flags?.[MODULE_ID]?.[flagName]));
}

/**
 * Привести права всех подозреваемых и дел к текущему списку профайлеров (выполняет ГМ).
 */
export async function syncCollaboratorOwnership() {
  const ownership = buildCollaboratorOwnership();
  const updates = [];
  for (const journalEntry of [...listFlaggedJournals("suspect"), ...listFlaggedJournals("case")]) {
    const changes = { _id: journalEntry.id, ownership: { ...ownership } };
    for (const userId of Object.keys(journalEntry.ownership)) {
      if (userId === "default") continue;
      if (!(userId in ownership)) changes.ownership[`-=${userId}`] = null;
    }
    updates.push(changes);
  }
  if (updates.length) await JournalEntry.updateDocuments(updates);
}
