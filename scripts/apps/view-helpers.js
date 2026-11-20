import { ZONE_MODES, ROLL_MODES, CLUE_KINDS, FONTS, STICKY_TINTS, INK_COLORS, TEMPLATE_PATH } from "../constants.js";
import { fullKey, localize } from "../i18n.js";

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
 * Поле «Проверка»: выпадающий список навыков и характеристик системы и пункт «Своя формула».
 * Значение хранится в текстовом поле (оно и отправляется формой); список лишь подставляет ключ.
 * Слушатели вешаются один раз на элемент поля.
 * @param {HTMLElement} root
 */
export function attachCheckFields(root) {
  for (const fieldElement of root.querySelectorAll(".check-field")) {
    if (fieldElement.dataset.attached) continue;
    fieldElement.dataset.attached = "true";
    const selectElement = fieldElement.querySelector(".check-select");
    const inputElement = fieldElement.querySelector(".check-formula");
    selectElement.addEventListener("change", () => {
      if (selectElement.value) {
        inputElement.value = selectElement.value;
        inputElement.hidden = true;
      } else {
        inputElement.hidden = false;
        inputElement.focus();
      }
    });
    syncCheckField(fieldElement);
  }
}

/** Список следует за текстовым полем (например, после подстановки настроек шаблона). @param {HTMLElement} fieldElement */
export function syncCheckField(fieldElement) {
  const selectElement = fieldElement.querySelector(".check-select");
  const inputElement = fieldElement.querySelector(".check-formula");
  const matchesOption = [...selectElement.options].some((option) => option.value && option.value === inputElement.value);
  if (matchesOption) {
    selectElement.value = inputElement.value;
  } else {
    selectElement.value = "";
  }
  inputElement.hidden = matchesOption;
}

/**
 * Обогащённый HTML для описаний. Описание могло прийти от другого игрока (передача берёт текст из его флагов,
 * а свои флаги игрок может переписать), поэтому сначала HTML чистится штатным очистителем Foundry.
 */
export function enrichText(htmlText) {
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(foundry.utils.cleanHTML(String(htmlText ?? "")));
}

/**
 * Сетка выбора (partial dsr-picker): поиск по названию и тегам и переключатель «показать ещё»
 * (например, архивных подозреваемых). Слушатели вешаются один раз.
 * @param {HTMLElement} root
 */
export function attachPickers(root) {
  for (const pickerElement of root.querySelectorAll(".dsr-picker")) {
    if (pickerElement.dataset.attached) continue;
    pickerElement.dataset.attached = "true";
    const searchInput = pickerElement.querySelector(".picker-search");
    const extraToggle = pickerElement.querySelector("[data-picker-toggle]");
    const applyFilter = () => {
      const searchText = searchInput.value.trim().toLocaleLowerCase(game.i18n.lang);
      const showExtra = Boolean(extraToggle?.checked);
      for (const itemElement of pickerElement.querySelectorAll("[data-search]")) {
        const matches = !searchText || itemElement.dataset.search.includes(searchText);
        // Отмеченное остаётся видимым, даже если это «скрытый» вариант: выбор не теряется из виду.
        const allowed = showExtra || !("extra" in itemElement.dataset) || itemElement.querySelector("input:checked");
        itemElement.hidden = !(matches && allowed);
      }
    };
    searchInput.addEventListener("input", applyFilter);
    extraToggle?.addEventListener("change", applyFilter);
    applyFilter();
  }
}

/**
 * Пункт сетки выбора.
 * @param {{id: string, name: string, img?: string, tags?: string[], selected?: boolean, extra?: boolean, badge?: string}} item
 */
export function toPickerItem(item) {
  return {
    ...item,
    searchIndex: [item.name, ...(item.tags ?? [])].join(" ").toLocaleLowerCase(game.i18n.lang)
  };
}

/**
 * Окно выбора нескольких пунктов из сетки.
 * @returns {Promise<string[]|null>} id отмеченных; null — отмена
 */
export async function pickItemsDialog({ title, icon = "fa-solid fa-list-check", items, toggleLabel = "", emptyText = "", confirmLabel = "" }) {
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_PATH}/partials/picker.hbs`, {
    items: items.map((item) => toPickerItem(item)),
    name: "picked",
    toggleLabel,
    emptyText
  });
  const pickedIds = await foundry.applications.api.DialogV2.wait({
    window: { title, icon },
    classes: ["detective-story", "picker-dialog"],
    position: { width: 520 },
    content,
    render: (event, dialog) => attachPickers(dialog.element),
    buttons: [
      {
        action: "confirm",
        label: confirmLabel || localize("Common.Select"),
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => [...button.form.querySelectorAll("input[name='picked']:checked")].map((input) => input.value)
      },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!Array.isArray(pickedIds)) return null;
  return pickedIds;
}
