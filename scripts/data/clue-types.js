import { MODULE_ID, ASSET_PATH, BUILT_IN_CLUE_TYPES } from "../constants.js";
import { localize } from "../i18n.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";

/**
 * Типы улик: встроенные (иконки модуля, удалить нельзя) и добавленные ГМ (настройка мира clueTypes).
 * @typedef {{id: string, name: string, icon: string, builtIn: boolean}} ClueType
 */

const FALLBACK_ICON = `${ASSET_PATH}/icons/types/item.svg`;

/** @returns {Record<string, ClueType>} */
function getBuiltInClueTypes() {
  const builtInTypes = {};
  for (const typeId of BUILT_IN_CLUE_TYPES) {
    builtInTypes[typeId] = {
      id: typeId,
      name: localize(`ClueTypes.${typeId}`),
      icon: `${ASSET_PATH}/icons/types/${typeId}.svg`,
      builtIn: true
    };
  }
  return builtInTypes;
}

/** @returns {Record<string, ClueType>} */
function getCustomClueTypes() {
  return getSetting(SETTING_KEYS.clueTypes) ?? {};
}

/**
 * Собранные типы кешируются: список улик спрашивает тип для каждой из сотен карточек.
 * Кеш сбрасывается, когда меняется настройка своих типов.
 */
let cachedClueTypes = null;
let cachedClueTypeList = null;

function resetClueTypeCache(setting) {
  if (setting.key !== `${MODULE_ID}.${SETTING_KEYS.clueTypes}`) return;
  cachedClueTypes = null;
  cachedClueTypeList = null;
}
Hooks.on("createSetting", resetClueTypeCache);
Hooks.on("updateSetting", resetClueTypeCache);
Hooks.on("deleteSetting", resetClueTypeCache);

/** Все типы: встроенные + свои. @returns {Record<string, ClueType>} */
export function getAllClueTypes() {
  if (cachedClueTypes) return cachedClueTypes;
  const allTypes = getBuiltInClueTypes();
  for (const [typeId, customType] of Object.entries(getCustomClueTypes())) {
    allTypes[typeId] = { ...customType, id: typeId, builtIn: false };
  }
  cachedClueTypes = allTypes;
  return allTypes;
}

/** Типы списком, отсортированные по названию. @returns {ClueType[]} */
export function getClueTypeList() {
  if (!cachedClueTypeList) {
    cachedClueTypeList = Object.values(getAllClueTypes()).sort((first, second) => first.name.localeCompare(second.name, game.i18n.lang));
  }
  return cachedClueTypeList;
}

/**
 * Тип по id; для удалённого типа — заглушка, чтобы старые улики продолжали показываться.
 * @param {string} typeId
 * @returns {ClueType}
 */
export function getClueType(typeId) {
  const clueType = getAllClueTypes()[typeId];
  if (clueType) return clueType;
  return { id: typeId ?? "", name: localize("ClueTypes.unknown"), icon: FALLBACK_ICON, builtIn: false };
}

/**
 * Создать или изменить свой тип (только ГМ).
 * @param {{id?: string, name: string, icon: string}} typeData
 * @returns {Promise<string>} id типа
 */
export async function saveCustomClueType({ id, name, icon }) {
  const customTypes = foundry.utils.deepClone(getCustomClueTypes());
  let typeId = id;
  if (!typeId) typeId = foundry.utils.randomID();
  customTypes[typeId] = { id: typeId, name: name.trim(), icon: icon || FALLBACK_ICON, builtIn: false };
  await setSetting(SETTING_KEYS.clueTypes, customTypes);
  return typeId;
}

/** @param {string} typeId */
export async function deleteCustomClueType(typeId) {
  const customTypes = foundry.utils.deepClone(getCustomClueTypes());
  delete customTypes[typeId];
  await setSetting(SETTING_KEYS.clueTypes, customTypes);
}

/** Свои типы для экспорта. */
export function exportCustomClueTypes() {
  return foundry.utils.deepClone(getCustomClueTypes());
}

/**
 * Импорт своих типов: существующие id перезаписываются, остальные добавляются.
 * @param {Record<string, ClueType>} importedTypes
 */
export async function importCustomClueTypes(importedTypes) {
  const customTypes = foundry.utils.deepClone(getCustomClueTypes());
  for (const [typeId, importedType] of Object.entries(importedTypes ?? {})) {
    if (BUILT_IN_CLUE_TYPES.includes(typeId)) continue;
    customTypes[typeId] = { id: typeId, name: String(importedType.name ?? ""), icon: String(importedType.icon ?? FALLBACK_ICON), builtIn: false };
  }
  await setSetting(SETTING_KEYS.clueTypes, customTypes);
}
