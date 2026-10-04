import { MODULE_ID, FOLDER_KEYS } from "../constants.js";
import { localize } from "../i18n.js";

/**
 * Мировые папки журналов модуля: «Улики», «Подозреваемые», «Дела».
 * Папку находим по флагу, а не по имени, чтобы ГМ мог её переименовать.
 */

const FOLDER_LABELS = {
  [FOLDER_KEYS.clues]: "Folders.Clues",
  [FOLDER_KEYS.suspects]: "Folders.Suspects",
  [FOLDER_KEYS.cases]: "Folders.Cases"
};

/**
 * @param {string} folderKey
 * @returns {Folder|undefined}
 */
export function findModuleFolder(folderKey) {
  return game.folders.find((folder) => folder.type === "JournalEntry" && folder.getFlag(MODULE_ID, "folderKey") === folderKey);
}

/**
 * Найти или создать папку (создаёт только ГМ).
 * @param {string} folderKey
 * @returns {Promise<Folder|undefined>}
 */
export async function ensureModuleFolder(folderKey) {
  const existingFolder = findModuleFolder(folderKey);
  if (existingFolder) return existingFolder;
  if (!game.user.isGM) return undefined;
  return Folder.create({
    name: localize(FOLDER_LABELS[folderKey]),
    type: "JournalEntry",
    sorting: "a",
    flags: { [MODULE_ID]: { folderKey } }
  });
}

/** Создать все папки модуля (вызывает ответственный ГМ при запуске мира). */
export async function ensureAllModuleFolders() {
  for (const folderKey of Object.values(FOLDER_KEYS)) {
    await ensureModuleFolder(folderKey);
  }
}

/** id всех папок модуля — чтобы скрыть их из боковой панели журналов. */
export function getModuleFolderIds() {
  const folderIds = [];
  for (const folderKey of Object.values(FOLDER_KEYS)) {
    const folder = findModuleFolder(folderKey);
    if (folder) folderIds.push(folder.id);
  }
  return folderIds;
}
