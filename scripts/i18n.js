import { I18N_ROOT } from "./constants.js";

/**
 * Перевод строки по ключу без корня: localize("Clue.Name") → DETECTIVE_STORY.Clue.Name.
 * @param {string} key
 * @returns {string}
 */
export function localize(key) {
  return game.i18n.localize(`${I18N_ROOT}.${key}`);
}

/**
 * Перевод строки с подстановкой значений.
 * @param {string} key
 * @param {object} data
 * @returns {string}
 */
export function format(key, data) {
  return game.i18n.format(`${I18N_ROOT}.${key}`, data);
}

/**
 * Полный ключ для мест, где Foundry сам вызывает перевод (настройки, клавиши, вкладки).
 * @param {string} key
 * @returns {string}
 */
export function fullKey(key) {
  return `${I18N_ROOT}.${key}`;
}
