import { localize, format } from "../i18n.js";
import { getSetting, SETTING_KEYS } from "../settings.js";
import { getZone, isZone, listCanvasZones, getZoneState, isZoneLockedFor } from "../data/zones.js";
import { userHasClue } from "../data/player-clues.js";
import { getClueTemplate } from "../data/clue-templates.js";

/**
 * Режим сосредоточения и видимость зон у игрока (локально, документ Tile не меняется).
 *  - вне режима зоны у игрока невидимы и не подсвечены;
 *  - в режиме подсвечены все зоны текущей сцены, где игрок ещё ничего не нашёл, включая
 *    зоны с исчерпанными попытками (A10): по подсветке нельзя понять остаток попыток.
 * ГМ видит зоны как обычные Tile и в режиме сосредоточения тоже получает подсветку всех зон.
 */

const HIGHLIGHT_COLOR = 0xffe066;
let focusActive = false;
const highlights = new Map();
/** Подписи зон для ГМ: tileId → { container, text }. */
const zoneLabels = new Map();

export function isFocusModeActive() {
  return focusActive;
}

/** @param {boolean} [forceState] */
export function toggleFocusMode(forceState) {
  let nextState = !focusActive;
  if (typeof forceState === "boolean") nextState = forceState;
  if (nextState === focusActive) return;
  focusActive = nextState;
  if (focusActive) {
    ui.notifications.info(localize("Focus.On"));
  } else {
    ui.notifications.info(localize("Focus.Off"));
  }
  refreshAllZones();
  syncToolbarToggle();
  if (!focusActive) Hooks.callAll(FOCUS_OFF_HOOK);
}

/** Режим сосредоточения выключен — подсказка над зоной у курсора должна исчезнуть. */
export const FOCUS_OFF_HOOK = "detectiveStoryFocusOff";

/** Состояние переключателя на панели кнопок. */
function syncToolbarToggle() {
  const focusTool = ui.controls?.controls?.detective?.tools?.focus;
  if (!focusTool || focusTool.active === focusActive) return;
  focusTool.active = focusActive;
  if (ui.controls.control?.name === "detective") ui.controls.render({ parts: ["tools"] });
}

/**
 * Нужно ли подсвечивать зону текущему пользователю (и показывать над ней подсказку).
 * @param {TileDocument} tileDocument
 */
export function isZoneHighlighted(tileDocument) {
  if (!focusActive) return false;
  if (game.user.isGM) return true;
  const zone = getZone(tileDocument);
  if (!zone) return false;
  // Шаблон удалён — искать нечего, зона не должна манить игрока.
  if (!getClueTemplate(zone.templateId)) return false;
  if (getZoneState(game.user, tileDocument.id).found) return false;
  if (userHasClue(game.user, zone.templateId)) return false;
  // Цепочка не пройдена: для игрока зоны как будто нет.
  if (isZoneLockedFor(zone)) return false;
  return true;
}

/** @param {Tile} tileObject */
export function refreshZone(tileObject) {
  const tileDocument = tileObject?.document;
  if (!tileDocument) return;
  if (!isZone(tileDocument)) {
    removeHighlight(tileObject);
    clearZoneLabel(tileDocument.id);
    return;
  }
  updateZoneLabel(tileObject);
  const highlighted = isZoneHighlighted(tileDocument);
  if (!game.user.isGM && tileObject.mesh) {
    if (highlighted) {
      tileObject.mesh.alpha = tileDocument.alpha ?? 1;
    } else {
      tileObject.mesh.alpha = 0;
    }
  }
  if (highlighted) {
    drawHighlight(tileObject);
  } else {
    removeHighlight(tileObject);
  }
}

export function refreshAllZones() {
  for (const tileObject of listCanvasZones()) refreshZone(tileObject);
  for (const tileId of [...highlights.keys()]) {
    const tileObject = canvas.tiles?.get(tileId);
    if (!tileObject || !isZone(tileObject.document)) clearHighlightById(tileId);
  }
  for (const tileId of [...zoneLabels.keys()]) {
    const tileObject = canvas.tiles?.get(tileId);
    if (!tileObject || !isZone(tileObject.document)) clearZoneLabel(tileId);
  }
}

/* -------------------------------------------- */
/*  Подписи зон для ГМ                          */
/* -------------------------------------------- */

/**
 * Подпись над зоной: что за улика, какая проверка и сложность. Видит только ГМ (если не выключил в настройках).
 * Обновляется часто (refreshTile при перетаскивании), поэтому текст пересоздаётся только при изменении.
 * @param {Tile} tileObject
 */
function updateZoneLabel(tileObject) {
  const tileDocument = tileObject.document;
  if (!game.user.isGM || !getSetting(SETTING_KEYS.zoneLabels)) {
    clearZoneLabel(tileDocument.id);
    return;
  }
  const labelText = describeZoneForGameMaster(tileDocument);
  let label = zoneLabels.get(tileDocument.id);
  if (label && (label.container.destroyed || label.text !== labelText)) {
    clearZoneLabel(tileDocument.id);
    label = null;
  }
  if (!label) {
    label = { container: buildZoneLabel(labelText), text: labelText };
    canvas.controls.addChild(label.container);
    zoneLabels.set(tileDocument.id, label);
  }
  label.container.position.set(tileDocument.x + tileDocument.width / 2, tileDocument.y - 6);
}

/** Текст подписи: название улики, ниже — проверка, сложность, радиус и лимит попыток. */
function describeZoneForGameMaster(tileDocument) {
  const zone = getZone(tileDocument);
  const template = getClueTemplate(zone.templateId);
  let title = localize("Zone.TemplateDeleted");
  if (template) title = template.name;
  const detection = zone.detection;
  let checkLabel = detection.check;
  const skillConfig = CONFIG.DND5E?.skills?.[detection.check];
  const abilityConfig = CONFIG.DND5E?.abilities?.[detection.check];
  if (skillConfig) {
    checkLabel = game.i18n.localize(skillConfig.label);
  } else if (abilityConfig) {
    checkLabel = game.i18n.localize(abilityConfig.label);
  }
  const details = [checkLabel, format("Zone.LabelDifficulty", { dc: detection.dc })];
  if (detection.zoneMode === "battlemap") {
    details.push(format("Zone.LabelRadius", { radius: detection.radius, units: canvas.scene?.grid?.units || game.i18n.localize("GridUnits") }));
  }
  if (detection.maxAttempts) details.push(format("Zone.LabelAttempts", { count: detection.maxAttempts }));
  const lines = [title, details.join(" · ")];
  if (zone.requires.length) {
    const requiredNames = zone.requires.map((requiredId) => getClueTemplate(requiredId)?.name ?? localize("Zone.TemplateDeleted"));
    lines.push(format("Zone.LabelRequires", { clues: requiredNames.join(", ") }));
  }
  return lines.join("\n");
}

/** Табличка: тёмная подложка и текст, якорь — середина нижнего края (над зоной). */
function buildZoneLabel(labelText) {
  const container = new PIXI.Container();
  container.eventMode = "none";
  const style = CONFIG.canvasTextStyle.clone();
  style.fontSize = Math.max(14, Math.round(canvas.grid.size * 0.2));
  style.align = "center";
  style.fill = 0xfff3d6;
  const TextClass = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
  const textObject = new TextClass(labelText, style);
  textObject.anchor.set(0.5, 1);
  const padding = 6;
  const background = new PIXI.Graphics();
  background.beginFill(0x1b1410, 0.78);
  background.lineStyle(1, HIGHLIGHT_COLOR, 0.8);
  background.drawRoundedRect(
    -textObject.width / 2 - padding,
    -textObject.height - padding,
    textObject.width + padding * 2,
    textObject.height + padding * 2,
    6
  );
  background.endFill();
  textObject.position.set(0, 0);
  container.addChild(background, textObject);
  return container;
}

/** @param {string} tileId */
function clearZoneLabel(tileId) {
  const label = zoneLabels.get(tileId);
  if (!label) return;
  if (!label.container.destroyed) label.container.destroy({ children: true });
  zoneLabels.delete(tileId);
}

/** Пульсирующая рамка со свечением вокруг зоны (рисуется только в режиме и только на текущей сцене). */
function drawHighlight(tileObject) {
  const tileDocument = tileObject.document;
  let highlight = highlights.get(tileDocument.id);
  if (!highlight) {
    const graphics = new PIXI.Graphics();
    graphics.eventMode = "none";
    canvas.tiles.addChild(graphics);
    const glowFilter = createGlowFilter();
    if (glowFilter) graphics.filters = [glowFilter];
    let elapsed = 0;
    const ticker = () => {
      elapsed += canvas.app.ticker.deltaMS;
      graphics.alpha = 0.65 + 0.35 * Math.sin(elapsed / 300);
    };
    canvas.app.ticker.add(ticker);
    highlight = { graphics, ticker };
    highlights.set(tileDocument.id, highlight);
  }
  const padding = 6;
  highlight.graphics.clear();
  highlight.graphics.lineStyle(4, HIGHLIGHT_COLOR, 0.95);
  highlight.graphics.beginFill(HIGHLIGHT_COLOR, 0.08);
  highlight.graphics.drawRoundedRect(
    tileDocument.x - padding,
    tileDocument.y - padding,
    tileDocument.width + padding * 2,
    tileDocument.height + padding * 2,
    10
  );
  highlight.graphics.endFill();
}

/** Фильтр свечения ядра Foundry (тот же, что подсвечивает выделенные объекты), если доступен. */
function createGlowFilter() {
  const GlowOverlayFilter = foundry.canvas?.rendering?.filters?.GlowOverlayFilter;
  if (!GlowOverlayFilter) return null;
  try {
    return GlowOverlayFilter.create({ glowColor: [1, 0.878, 0.4, 1], distance: 10, quality: 0.4, knockout: false });
  } catch {
    return null;
  }
}

/** @param {Tile} tileObject */
function removeHighlight(tileObject) {
  clearHighlightById(tileObject.document.id);
}

/** @param {string} tileId */
function clearHighlightById(tileId) {
  const highlight = highlights.get(tileId);
  if (!highlight) return;
  canvas.app?.ticker?.remove(highlight.ticker);
  if (!highlight.graphics.destroyed) highlight.graphics.destroy();
  highlights.delete(tileId);
}

/** Смена сцены: подсветка прошлой сцены уничтожена вместе со слоем. */
export function resetHighlightsForNewCanvas() {
  for (const highlight of highlights.values()) {
    canvas.app?.ticker?.remove(highlight.ticker);
    if (!highlight.graphics.destroyed) highlight.graphics.destroy();
  }
  highlights.clear();
  for (const tileId of [...zoneLabels.keys()]) clearZoneLabel(tileId);
  refreshAllZones();
}
