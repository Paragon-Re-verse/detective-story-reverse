import { MODULE_ID, STAMP_PATH } from "./constants.js";
import { fullKey } from "./i18n.js";

export const SETTING_KEYS = {
  schemaVersion: "schemaVersion",
  clueTypes: "clueTypes",
  profilers: "profilers",
  profilersCreateCases: "profilersCreateCases",
  caseCounter: "caseCounter",
  showSetupWarning: "showSetupWarning",
  findAnimation: "findAnimation",
  windowPositions: "windowPositions",
  clueListSort: "clueListSort",
  clueListView: "clueListView",
  zoneLabels: "zoneLabels",
  stampFolder: "stampFolder",
  stampColor: "stampColor",
  stampFiles: "stampFiles",
  libraryFolders: "libraryFolders",
  folderTreeState: "folderTreeState"
};

/**
 * Регистрирует настройки мира и клиента.
 * @param {object} menus - классы окон для пунктов меню настроек
 * @param {Function} menus.profilersConfig
 * @param {Function} menus.permissionsWarning
 * @param {Function} onProfilersChange
 */
export function registerSettings({ profilersConfig, permissionsWarning }, onProfilersChange) {
  game.settings.register(MODULE_ID, SETTING_KEYS.schemaVersion, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.clueTypes, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.profilers, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => onProfilersChange()
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.profilersCreateCases, {
    name: fullKey("Settings.ProfilersCreateCases.Name"),
    hint: fullKey("Settings.ProfilersCreateCases.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.caseCounter, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.showSetupWarning, {
    name: fullKey("Settings.ShowSetupWarning.Name"),
    hint: fullKey("Settings.ShowSetupWarning.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.findAnimation, {
    name: fullKey("Settings.FindAnimation.Name"),
    hint: fullKey("Settings.FindAnimation.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.windowPositions, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.clueListSort, {
    scope: "client",
    config: false,
    type: String,
    default: "received"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.clueListView, {
    scope: "client",
    config: false,
    type: String,
    default: "grid"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.zoneLabels, {
    name: fullKey("Settings.ZoneLabels.Name"),
    hint: fullKey("Settings.ZoneLabels.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => import("./canvas/focus-mode.js").then(({ refreshAllZones }) => refreshAllZones())
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.stampFolder, {
    name: fullKey("Settings.StampFolder.Name"),
    hint: fullKey("Settings.StampFolder.Hint"),
    scope: "world",
    config: true,
    type: String,
    filePicker: "folder",
    default: STAMP_PATH,
    onChange: () => import("./board/stamps.js").then(({ syncStampFiles }) => syncStampFiles())
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.stampColor, {
    name: fullKey("Settings.StampColor.Name"),
    hint: fullKey("Settings.StampColor.Hint"),
    scope: "world",
    config: true,
    type: new foundry.data.fields.ColorField({ nullable: false, initial: "#b3261e" }),
    default: "#b3261e"
  });

  // Папки библиотеки ГМ: «id → папка». Пишет только ГМ.
  game.settings.register(MODULE_ID, SETTING_KEYS.libraryFolders, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // Свёрнутые папки каждого дерева на этом клиенте: «ключ дерева → id папок».
  game.settings.register(MODULE_ID, SETTING_KEYS.folderTreeState, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.stampFiles, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.registerMenu(MODULE_ID, "profilersMenu", {
    name: fullKey("Settings.Profilers.Name"),
    label: fullKey("Settings.Profilers.Label"),
    hint: fullKey("Settings.Profilers.Hint"),
    icon: "fa-solid fa-user-secret",
    type: profilersConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "permissionsMenu", {
    name: fullKey("Settings.Permissions.Name"),
    label: fullKey("Settings.Permissions.Label"),
    hint: fullKey("Settings.Permissions.Hint"),
    icon: "fa-solid fa-user-lock",
    type: permissionsWarning,
    restricted: true
  });
}

/**
 * @param {string} key
 * @returns {*}
 */
export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * @param {string} key
 * @param {*} value
 * @returns {Promise<*>}
 */
export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}
