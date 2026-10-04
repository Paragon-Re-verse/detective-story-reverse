import { MODULE_ID } from "../constants.js";

/**
 * Низкоуровневый доступ к флагам пользователя (User). Запись всегда точечная — по ключу,
 * а не целым объектом: так две одновременные записи в разные ключи не теряют друг друга.
 * Игрок пишет только в свой User, ГМ — в любой (правило Foundry для документа User).
 */

/**
 * @param {User} user
 * @param {string} section - clues, zoneState, outbox, receipts, suspectNotes
 * @returns {object}
 */
export function readUserSection(user, section) {
  return user?.flags?.[MODULE_ID]?.[section] ?? {};
}

/**
 * Записать одну запись раздела.
 * @param {User} user
 * @param {string} section
 * @param {string} key
 * @param {object} value
 */
export function writeUserEntry(user, section, key, value) {
  return user.update({ [`flags.${MODULE_ID}.${section}.${key}`]: value });
}

/**
 * Изменить одно поле записи раздела.
 * @param {User} user
 * @param {string} section
 * @param {string} key
 * @param {string} field
 * @param {*} value
 */
export function writeUserEntryField(user, section, key, field, value) {
  return user.update({ [`flags.${MODULE_ID}.${section}.${key}.${field}`]: value });
}

/**
 * Записать несколько записей раздела одним обновлением.
 * @param {User} user
 * @param {string} section
 * @param {Record<string, object>} entries
 */
export function writeUserEntries(user, section, entries) {
  const changes = {};
  for (const [key, value] of Object.entries(entries)) {
    changes[`flags.${MODULE_ID}.${section}.${key}`] = value;
  }
  if (foundry.utils.isEmpty(changes)) return null;
  return user.update(changes);
}

/**
 * Удалить записи раздела (синтаксис -= Foundry v13).
 * @param {User} user
 * @param {string} section
 * @param {string[]} keys
 */
export function deleteUserEntries(user, section, keys) {
  const changes = {};
  for (const key of keys) {
    changes[`flags.${MODULE_ID}.${section}.-=${key}`] = null;
  }
  if (foundry.utils.isEmpty(changes)) return null;
  return user.update(changes);
}

/**
 * Какие ключи раздела затронуты обновлением User (по объекту changes из хука updateUser).
 * Возвращает null, если раздел не менялся.
 * @param {object} changes
 * @param {string} section
 * @returns {{changed: string[], deleted: string[]}|null}
 */
export function getChangedSectionKeys(changes, section) {
  const moduleFlags = changes?.flags?.[MODULE_ID];
  if (!moduleFlags) return null;
  const changed = [];
  const deleted = [];
  for (const [key, value] of Object.entries(moduleFlags)) {
    if (key === `-=${section}`) return { changed: [], deleted: ["*"] };
    if (key !== section) continue;
    for (const entryKey of Object.keys(value ?? {})) {
      if (entryKey.startsWith("-=")) {
        deleted.push(entryKey.slice(2));
      } else {
        changed.push(entryKey);
      }
    }
  }
  if (!changed.length && !deleted.length) {
    if (!(section in moduleFlags)) return null;
  }
  return { changed, deleted };
}
