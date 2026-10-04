import { ZONE_MODES, ROLL_MODES, CLUE_KINDS, FONTS, STICKY_TINTS, INK_COLORS } from "../constants.js";
import { fullKey } from "../i18n.js";

/**
 * Общие данные для форм: варианты выпадающих списков и подсказки.
 * Навыки и характеристики называются строками самой системы (CONFIG.DND5E), без своих переводов.
 */

export function getZoneModeChoices() {
  const choices = {};
  for (const zoneMode of ZONE_MODES) choices[zoneMode] = fullKey(`ZoneMode.${zoneMode}`);
  return choices;
}

export function getRollModeChoices() {
  const choices = {};
  for (const rollMode of ROLL_MODES) {
    choices[rollMode] = CONFIG.Dice.rollModes[rollMode]?.label ?? rollMode;
  }
  return choices;
}

/** Варианты для поля «Проверка»: навыки и характеристики dnd5e. */
export function getCheckSuggestions() {
  const suggestions = [];
  for (const [skillKey, skillConfig] of Object.entries(CONFIG.DND5E?.skills ?? {})) {
    suggestions.push({ value: skillKey, label: game.i18n.localize(skillConfig.label) });
  }
  for (const [abilityKey, abilityConfig] of Object.entries(CONFIG.DND5E?.abilities ?? {})) {
    suggestions.push({ value: abilityKey, label: game.i18n.localize(abilityConfig.label) });
  }
  return suggestions;
}

export function getKindChoices() {
  const choices = {};
  for (const kind of CLUE_KINDS) choices[kind] = fullKey(`Kind.${kind}`);
  return choices;
}

export function getFontChoices() {
  const choices = {};
  for (const font of FONTS) choices[font.family] = font.family;
  return choices;
}

/**
 * @param {Record<string, string>} palette
 * @param {string} selectedColor
 * @param {string} labelPrefix
 */
function buildSwatches(palette, selectedColor, labelPrefix) {
  return Object.entries(palette).map(([colorKey, colorValue]) => {
    return {
      key: colorKey,
      value: colorValue,
      label: fullKey(`${labelPrefix}.${colorKey}`),
      selected: colorValue.toLowerCase() === String(selectedColor ?? "").toLowerCase()
    };
  });
}

export function getInkSwatches(selectedColor) {
  return buildSwatches(INK_COLORS, selectedColor, "InkColors");
}

export function getTintSwatches(selectedColor) {
  return buildSwatches(STICKY_TINTS, selectedColor, "StickyTints");
}

/** Дата для показа: ДД.ММ.ГГГГ ЧЧ:ММ (A7). @param {string|number} dateValue */
export function formatDateTime(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return String(dateValue);
  return date.toLocaleString(game.i18n.lang, { dateStyle: "short", timeStyle: "short" });
}

/**
 * Обогащённый HTML для описаний. Описание могло прийти от другого игрока (передача берёт текст из его флагов,
 * а свои флаги игрок может переписать), поэтому сначала HTML чистится штатным очистителем Foundry.
 */
export function enrichText(htmlText) {
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(foundry.utils.cleanHTML(String(htmlText ?? "")));
}
