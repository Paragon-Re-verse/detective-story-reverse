import { TEMPLATE_PATH } from "../constants.js";
import { fullKey, localize } from "../i18n.js";
import { getZone, zoneFieldName, resetZoneForUsers } from "../data/zones.js";
import { listClueTemplates, getClueTemplate, defaultDetection } from "../data/clue-templates.js";
import { getPlayerUsers } from "../permissions.js";
import { getZoneModeChoices, getRollModeChoices, getCheckSuggestions } from "../apps/view-helpers.js";

/**
 * Вкладка «Улика» в штатном окне настройки Tile: выбор шаблона и переопределение настроек
 * обнаружения (A3). Поля сохраняются штатной кнопкой окна в флаг zone.
 */

const TAB_ID = "detectiveZone";

export function registerZoneTab() {
  const TileConfig = foundry.applications.sheets.TileConfig;
  TileConfig.TABS.sheet.tabs.push({ id: TAB_ID, icon: "fa-solid fa-magnifying-glass", label: fullKey("Zone.Tab") });

  const { footer, ...otherParts } = TileConfig.PARTS;
  TileConfig.PARTS = {
    ...otherParts,
    [TAB_ID]: { template: `${TEMPLATE_PATH}/zone-tab.hbs`, scrollable: [""] },
    footer
  };

  const originalPreparePartContext = TileConfig.prototype._preparePartContext;
  TileConfig.prototype._preparePartContext = async function preparePartContextWithZone(partId, context, options) {
    const partContext = await originalPreparePartContext.call(this, partId, context, options);
    if (partId === TAB_ID) Object.assign(partContext, buildZoneTabContext(this.document));
    return partContext;
  };
}

/** @param {TileDocument} tileDocument */
function buildZoneTabContext(tileDocument) {
  const zone = getZone(tileDocument);
  let selectedTemplateId = "";
  let detection = defaultDetection();
  if (zone) {
    selectedTemplateId = zone.templateId;
    detection = zone.detection;
  }
  const templateChoices = { "": localize("Zone.NoTemplate") };
  for (const template of listClueTemplates()) templateChoices[template.id] = template.name;

  return {
    zone: {
      isZone: Boolean(zone),
      isSaved: Boolean(tileDocument.id),
      templateId: selectedTemplateId,
      detection,
      templateFieldName: zoneFieldName("templateId"),
      detectionPrefix: zoneFieldName("detection"),
      datalistId: `detective-zone-checks-${tileDocument.id ?? "new"}`,
      templateChoices,
      zoneModeChoices: getZoneModeChoices(),
      rollModeChoices: getRollModeChoices(),
      checkSuggestions: getCheckSuggestions(),
      gridUnits: tileDocument.parent?.grid?.units || game.i18n.localize("GridUnits")
    }
  };
}

/**
 * Поведение вкладки: подстановка настроек шаблона при выборе, показ радиуса только для боевой карты,
 * сброс попыток всех игроков.
 * @param {TileConfig} application
 * @param {HTMLElement} element
 */
export function onRenderTileConfig(application, element) {
  const tabElement = element.querySelector(`.tab[data-tab="${TAB_ID}"]`);
  if (!tabElement) return;

  const templateSelect = tabElement.querySelector(`[name="${zoneFieldName("templateId")}"]`);
  templateSelect?.addEventListener("change", () => {
    const template = getClueTemplate(templateSelect.value);
    if (!template) return;
    for (const [field, value] of Object.entries(template.detection)) {
      const inputElement = tabElement.querySelector(`[name="${zoneFieldName(`detection.${field}`)}"]`);
      if (inputElement) inputElement.value = value;
    }
    syncRadiusVisibility(tabElement);
  });

  const modeSelect = tabElement.querySelector(`[name="${zoneFieldName("detection.zoneMode")}"]`);
  modeSelect?.addEventListener("change", () => syncRadiusVisibility(tabElement));
  syncRadiusVisibility(tabElement);

  tabElement.querySelector("[data-zone-action='resetAll']")?.addEventListener("click", async (event) => {
    event.preventDefault();
    const tileDocument = application.document;
    const playerIds = getPlayerUsers().map((user) => user.id);
    await resetZoneForUsers(playerIds, tileDocument.id);
    ui.notifications.info(localize("Notify.AttemptsReset"));
  });
}

/** @param {HTMLElement} tabElement */
function syncRadiusVisibility(tabElement) {
  const modeSelect = tabElement.querySelector(`[name="${zoneFieldName("detection.zoneMode")}"]`);
  const radiusGroup = tabElement.querySelector(".zone-radius-group");
  if (!modeSelect || !radiusGroup) return;
  radiusGroup.hidden = modeSelect.value !== "battlemap";
}
