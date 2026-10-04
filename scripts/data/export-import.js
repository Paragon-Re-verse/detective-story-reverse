import { MODULE_ID, EXPORT_FORMAT, EXPORT_FORMAT_VERSION } from "../constants.js";
import { setSetting, getSetting, SETTING_KEYS } from "../settings.js";
import { exportCustomClueTypes, importCustomClueTypes } from "./clue-types.js";
import { exportClueTemplates, createClueTemplate, updateClueTemplate, listClueTemplates } from "./clue-templates.js";
import { exportSuspects, createSuspectWithId, updateSuspect, listSuspects } from "./suspects.js";
import { exportCases, createCaseWithId, replaceCaseData, listCases } from "./cases.js";

/**
 * Экспорт и импорт данных ГМ: типы, шаблоны, подозреваемые, дела с таймлайнами.
 * Не попадают: улики, заметки и попытки игроков, сцены и зоны, сами файлы картинок и аудио.
 */

export const CONFLICT_MODES = { replace: "replace", skip: "skip" };

export class InvalidImportError extends Error {}

/** Собрать файл экспорта. */
export function buildExportData() {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    clueTypes: exportCustomClueTypes(),
    templates: exportClueTemplates(),
    suspects: exportSuspects(),
    cases: exportCases()
  };
}

/** Скачать файл экспорта. */
export function downloadExport() {
  const exportData = buildExportData();
  const dateStamp = new Date().toISOString().slice(0, 10);
  foundry.utils.saveDataToFile(JSON.stringify(exportData, null, 2), "application/json", `${MODULE_ID}-${dateStamp}.json`);
}

/**
 * Разобрать и проверить файл.
 * @param {string} text
 */
export function parseImportText(text) {
  let importData;
  try {
    importData = JSON.parse(text);
  } catch {
    throw new InvalidImportError("InvalidJson");
  }
  if (importData?.format !== EXPORT_FORMAT) throw new InvalidImportError("WrongFormat");
  if (Number(importData.formatVersion) > EXPORT_FORMAT_VERSION) throw new InvalidImportError("NewerVersion");
  let clueTypes = {};
  if (importData.clueTypes && typeof importData.clueTypes === "object") clueTypes = importData.clueTypes;
  return {
    clueTypes,
    templates: readEntryList(importData.templates),
    suspects: readEntryList(importData.suspects),
    cases: readEntryList(importData.cases)
  };
}

/** Массив записей с id; всё остальное отбрасывается. */
function readEntryList(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => typeof entry?.id === "string" && entry.id.length > 0);
}

/** Сводка для подтверждения. */
export function summarizeImport(importData) {
  return {
    clueTypes: Object.keys(importData.clueTypes).length,
    templates: importData.templates.length,
    suspects: importData.suspects.length,
    cases: importData.cases.length
  };
}

/** Записи, чей id уже занят в мире. */
export function countImportConflicts(importData) {
  const allIds = [...importData.templates, ...importData.suspects, ...importData.cases].map((entry) => entry.id);
  return allIds.filter((entryId) => game.journal.has(entryId)).length;
}

/**
 * Применить импорт (только ГМ).
 * @param {object} importData
 * @param {string} conflictMode - replace или skip
 */
export async function applyImport(importData, conflictMode) {
  await importCustomClueTypes(importData.clueTypes);

  for (const template of importData.templates) {
    if (game.journal.has(template.id)) {
      if (conflictMode === CONFLICT_MODES.replace) await updateClueTemplate(template.id, template);
    } else {
      await createClueTemplate(template, { id: template.id });
    }
  }

  for (const suspect of importData.suspects) {
    if (game.journal.has(suspect.id)) {
      if (conflictMode === CONFLICT_MODES.replace) await updateSuspect(suspect.id, suspect);
    } else {
      await createSuspectWithId(suspect, suspect.id);
    }
  }

  let highestCaseNumber = Number(getSetting(SETTING_KEYS.caseCounter)) || 0;
  for (const caseData of importData.cases) {
    if (game.journal.has(caseData.id)) {
      if (conflictMode === CONFLICT_MODES.replace) await replaceCaseData(caseData);
    } else {
      await createCaseWithId(caseData);
    }
    highestCaseNumber = Math.max(highestCaseNumber, Number(caseData.number) || 0);
  }
  await setSetting(SETTING_KEYS.caseCounter, highestCaseNumber);
}

/**
 * Сброс данных модуля (только ГМ).
 * @param {{includePlayerData: boolean}} options
 */
export async function resetModuleData({ includePlayerData }) {
  const journalIds = [
    ...listClueTemplates().map((template) => template.id),
    ...listSuspects().map((suspect) => suspect.id),
    ...listCases().map((caseData) => caseData.id)
  ];
  if (journalIds.length) await JournalEntry.deleteDocuments(journalIds);
  await setSetting(SETTING_KEYS.clueTypes, {});
  await setSetting(SETTING_KEYS.caseCounter, 0);
  if (!includePlayerData) return;
  for (const user of game.users) {
    if (!user.flags?.[MODULE_ID]) continue;
    await user.update({ [`flags.-=${MODULE_ID}`]: null });
  }
}

