import { MODULE_ID } from "../constants.js";
import { fullKey } from "../i18n.js";

/**
 * Настройки доски, перенесённые из прототипа (масштаб, булавки, ширина нитей и карточек).
 */

export const BOARD_SETTING_KEYS = {
  autoScale: "boardAutoScale",
  sceneScale: "boardSceneScale",
  pinColor: "boardPinColor",
  threadWidth: "boardThreadWidth",
  stickyWidth: "boardStickyWidth",
  photoWidth: "boardPhotoWidth",
  indexWidth: "boardIndexWidth",
  handoutWidth: "boardHandoutWidth",
  handoutHeight: "boardHandoutHeight",
  baseFontSize: "boardBaseFontSize"
};

/** @param {Function} refreshCards */
export function registerBoardSettings(refreshCards) {
  const numberSetting = (key, settingName, defaultValue) => {
    game.settings.register(MODULE_ID, key, {
      name: fullKey(`BoardSettings.${settingName}.Name`),
      hint: fullKey(`BoardSettings.${settingName}.Hint`),
      scope: "world",
      config: true,
      type: Number,
      default: defaultValue,
      onChange: () => refreshCards()
    });
  };

  game.settings.register(MODULE_ID, BOARD_SETTING_KEYS.autoScale, {
    name: fullKey("BoardSettings.AutoScale.Name"),
    hint: fullKey("BoardSettings.AutoScale.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshCards()
  });

  game.settings.register(MODULE_ID, BOARD_SETTING_KEYS.sceneScale, {
    name: fullKey("BoardSettings.SceneScale.Name"),
    hint: fullKey("BoardSettings.SceneScale.Hint"),
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0.3, max: 2.5, step: 0.1 },
    default: 1,
    onChange: () => refreshCards()
  });

  game.settings.register(MODULE_ID, BOARD_SETTING_KEYS.pinColor, {
    name: fullKey("BoardSettings.PinColor.Name"),
    hint: fullKey("BoardSettings.PinColor.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      random: fullKey("BoardSettings.PinColor.random"),
      red: fullKey("BoardSettings.PinColor.red"),
      blue: fullKey("BoardSettings.PinColor.blue"),
      yellow: fullKey("BoardSettings.PinColor.yellow"),
      green: fullKey("BoardSettings.PinColor.green"),
      none: fullKey("BoardSettings.PinColor.none")
    },
    default: "random",
    onChange: () => refreshCards()
  });

  numberSetting(BOARD_SETTING_KEYS.threadWidth, "ThreadWidth", 7);
  numberSetting(BOARD_SETTING_KEYS.stickyWidth, "StickyWidth", 200);
  numberSetting(BOARD_SETTING_KEYS.photoWidth, "PhotoWidth", 225);
  numberSetting(BOARD_SETTING_KEYS.indexWidth, "IndexWidth", 600);
  numberSetting(BOARD_SETTING_KEYS.handoutWidth, "HandoutWidth", 400);
  numberSetting(BOARD_SETTING_KEYS.handoutHeight, "HandoutHeight", 400);
  numberSetting(BOARD_SETTING_KEYS.baseFontSize, "BaseFontSize", 16);
}

/** @param {string} key */
export function getBoardSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

/** Масштаб карточек на текущей сцене (авто по ширине сцены и общий множитель). */
export function getEffectiveScale() {
  const baseScale = getBoardSetting(BOARD_SETTING_KEYS.sceneScale) || 1;
  if (!getBoardSetting(BOARD_SETTING_KEYS.autoScale) || !canvas?.scene) return baseScale;
  const autoFactor = canvas.scene.width / 3070;
  return Math.clamp(baseScale * autoFactor, 0.1, 5);
}
