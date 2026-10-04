import { MODULE_ID } from "../constants.js";
import { localize, format } from "../i18n.js";
import { getZone, listCanvasZones, getZoneState, areAttemptsExhausted, recordFailedAttempt, recordFoundZone } from "../data/zones.js";
import { getClueTemplate, buildPlayerContent } from "../data/clue-templates.js";
import { buildPlayerClue, addCluesToUser, userHasClue, CLUE_SOURCES } from "../data/player-clues.js";
import { whisperGameMasters, escapeText, GM_NOTE_TONES } from "../chat.js";
import { logEvent, LOG_EVENTS } from "../data/event-log.js";
import { isFocusModeActive, isZoneHighlighted, FOCUS_OFF_HOOK } from "./focus-mode.js";

/**
 * Поиск улики кликом по зоне. Проверки идут по порядку, первая сработавшая останавливает цепочку:
 *  1. боевая карта, токен не выбран — «Выберите токен своего персонажа», попытка не тратится;
 *  2. боевая карта, токен дальше радиуса — «Вы слишком далеко от этого места», не тратится;
 *  3. игрок уже нашёл улику — «Вы уже осмотрели это место», не тратится;
 *  4. попытки исчерпаны — то же сообщение, что и при провале, без броска;
 *  5. иначе бросок dnd5e; провал списывает попытку, успех добавляет улику.
 * ГМ кликает по Tile как обычно: поиск запускают только игроки.
 */

const PATCH_MARK = Symbol.for(`${MODULE_ID}.zoneClickPatched`);
let searchInProgress = false;

/** Подключиться к штатному клику слоя токенов (Foundry уже отличил клик от перетаскивания). */
export function initializeZoneClicks() {
  const TokenLayer = foundry.canvas.layers.TokenLayer;
  const prototype = TokenLayer.prototype;
  if (prototype._onClickLeft[PATCH_MARK]) return;
  const originalOnClickLeft = prototype._onClickLeft;
  function patchedOnClickLeft(event) {
    try {
      handleCanvasClick(event);
    } catch (error) {
      console.error(`${MODULE_ID} | zone click`, error);
    }
    return originalOnClickLeft.call(this, event);
  }
  patchedOnClickLeft[PATCH_MARK] = true;
  prototype._onClickLeft = patchedOnClickLeft;
}

/** @param {PIXI.FederatedEvent} event */
function handleCanvasClick(event) {
  if (game.user.isGM) return;
  if (!canvas?.ready) return;
  const worldPoint = event.getLocalPosition(canvas.stage);
  const clickedZone = findZoneAtPoint(worldPoint);
  if (!clickedZone) return;
  searchZone(clickedZone.document);
}

/**
 * Верхняя зона под точкой (по порядку отрисовки).
 * @param {{x: number, y: number}} point
 */
function findZoneAtPoint(point) {
  const zonesUnderPoint = listCanvasZones().filter((tileObject) => {
    const tileDocument = tileObject.document;
    return point.x >= tileDocument.x && point.x <= tileDocument.x + tileDocument.width
      && point.y >= tileDocument.y && point.y <= tileDocument.y + tileDocument.height;
  });
  if (!zonesUnderPoint.length) return null;
  zonesUnderPoint.sort((first, second) => (second.document.sort ?? 0) - (first.document.sort ?? 0));
  return zonesUnderPoint[0];
}

/* -------------------------------------------- */
/*  Подсказка у курсора над зоной               */
/* -------------------------------------------- */

let hintElement = null;

/**
 * Игрок в режиме сосредоточения наводит курсор на подсвеченную зону — у курсора подсказка:
 * «Осмотреть», «Выберите токен» или «Подойдите ближе: ещё ≈ N фт» (сколько осталось токену до радиуса зоны).
 * Вне режима подсказки нет: зоны тогда скрыты, и подсказка не должна их выдавать.
 */
export function initializeZoneHoverHint() {
  if (game.user.isGM) return;
  Hooks.on("canvasReady", attachHoverListeners);
  Hooks.on("canvasTearDown", hideZoneHint);
  Hooks.on(FOCUS_OFF_HOOK, hideZoneHint);
  if (canvas?.ready) attachHoverListeners();
}

function attachHoverListeners() {
  canvas.stage.off("pointermove", onCanvasPointerMove);
  canvas.stage.on("pointermove", onCanvasPointerMove);
  canvas.app.view.removeEventListener("pointerleave", hideZoneHint);
  canvas.app.view.addEventListener("pointerleave", hideZoneHint);
}

/** @param {PIXI.FederatedPointerEvent} event */
function onCanvasPointerMove(event) {
  if (!isFocusModeActive() || !canvas?.ready) {
    hideZoneHint();
    return;
  }
  const zoneObject = findZoneAtPoint(event.getLocalPosition(canvas.stage));
  if (!zoneObject || !isZoneHighlighted(zoneObject.document)) {
    hideZoneHint();
    return;
  }
  showZoneHint(describeZoneHint(zoneObject.document), event.clientX, event.clientY);
}

/**
 * Что скажет подсказка над зоной.
 * @param {TileDocument} tileDocument
 * @returns {{text: string, tone: "ready"|"far"|"warning"}}
 */
function describeZoneHint(tileDocument) {
  const detection = getZone(tileDocument).detection;
  if (detection.zoneMode !== "battlemap") return { text: localize("Search.HintInspect"), tone: "ready" };
  const tokenObject = getOwnControlledToken();
  if (!tokenObject) return { text: localize("Search.SelectToken"), tone: "warning" };
  const remainingDistance = getRemainingDistance(tokenObject, tileDocument, detection.radius);
  if (remainingDistance > 0) {
    return { text: format("Search.HintCloser", { distance: remainingDistance, units: getGridUnits() }), tone: "far" };
  }
  return { text: localize("Search.HintInspect"), tone: "ready" };
}

function showZoneHint({ text, tone }, clientX, clientY) {
  if (!hintElement) {
    hintElement = document.createElement("div");
    hintElement.id = "detective-story-zone-hint";
    document.body.append(hintElement);
  }
  if (hintElement.textContent !== text) hintElement.textContent = text;
  hintElement.dataset.tone = tone;
  hintElement.style.left = `${clientX + 18}px`;
  hintElement.style.top = `${clientY + 18}px`;
  hintElement.hidden = false;
}

/** Скрыть подсказку: зона найдена, попытки изменились или режим сосредоточения выключен. */
export function hideZoneHint() {
  if (hintElement) hintElement.hidden = true;
}

/**
 * Сколько токену ещё идти до радиуса зоны, с округлением вверх до шага сетки (0 — уже достаточно близко).
 * @param {Token} tokenObject
 * @param {TileDocument} tileDocument
 * @param {number} radius
 */
function getRemainingDistance(tokenObject, tileDocument, radius) {
  const excess = measureDistanceToZone(tokenObject, tileDocument) - radius;
  if (excess <= 0) return 0;
  const gridStep = canvas.grid.distance || 1;
  return Math.ceil(excess / gridStep) * gridStep;
}

function getGridUnits() {
  return canvas.scene?.grid?.units || game.i18n.localize("GridUnits");
}

/** Свой выбранный токен. */
function getOwnControlledToken() {
  return canvas.tokens.controlled.find((tokenObject) => tokenObject.isOwner && tokenObject.actor) ?? null;
}

/**
 * Расстояние от центра токена до ближайшей точки прямоугольника Tile (внутри — ноль), в единицах сцены.
 * @param {Token} tokenObject
 * @param {TileDocument} tileDocument
 */
export function measureDistanceToZone(tokenObject, tileDocument) {
  const tokenCenter = tokenObject.center;
  const nearestPoint = {
    x: Math.clamp(tokenCenter.x, tileDocument.x, tileDocument.x + tileDocument.width),
    y: Math.clamp(tokenCenter.y, tileDocument.y, tileDocument.y + tileDocument.height)
  };
  if (nearestPoint.x === tokenCenter.x && nearestPoint.y === tokenCenter.y) return 0;
  return canvas.grid.measurePath([tokenCenter, nearestPoint]).distance;
}

/** Актёр для фона без токена: персонаж из профиля, иначе выбранный токен. */
function getBackgroundActor() {
  if (game.user.character) return game.user.character;
  return getOwnControlledToken()?.actor ?? null;
}

/**
 * @param {TileDocument} tileDocument
 */
export async function searchZone(tileDocument) {
  if (searchInProgress) return;
  searchInProgress = true;
  try {
    await runZoneSearch(tileDocument);
  } finally {
    searchInProgress = false;
  }
}

/** @param {TileDocument} tileDocument */
async function runZoneSearch(tileDocument) {
  const zone = getZone(tileDocument);
  if (!zone) return;
  const template = getClueTemplate(zone.templateId);
  if (!template) {
    ui.notifications.warn(localize("Search.NoTemplate"));
    return;
  }
  const detection = zone.detection;

  let actor = null;
  if (detection.zoneMode === "battlemap") {
    const tokenObject = getOwnControlledToken();
    if (!tokenObject) {
      ui.notifications.warn(localize("Search.SelectToken"));
      return;
    }
    const remainingDistance = getRemainingDistance(tokenObject, tileDocument, detection.radius);
    if (remainingDistance > 0) {
      ui.notifications.warn(format("Search.TooFar", { distance: remainingDistance, units: getGridUnits() }));
      return;
    }
    actor = tokenObject.actor;
  } else {
    actor = getBackgroundActor();
  }

  const zoneState = getZoneState(game.user, tileDocument.id);
  if (zoneState.found || userHasClue(game.user, template.id)) {
    ui.notifications.info(localize("Search.AlreadySearched"));
    return;
  }
  if (areAttemptsExhausted(zoneState, detection.maxAttempts)) {
    ui.notifications.info(localize("Search.Failed"));
    return;
  }

  const rollResult = await rollDetectionCheck(detection, actor);
  if (!rollResult) return;

  if (rollResult.total >= rollResult.difficulty) {
    await onSearchSuccess(tileDocument, template);
  } else {
    await recordFailedAttempt(game.user, tileDocument.id);
    ui.notifications.info(localize("Search.Failed"));
    await logEvent(LOG_EVENTS.failed, {
      clue: template.name,
      scene: tileDocument.parent?.name ?? "",
      attempt: getZoneState(game.user, tileDocument.id).attempts,
      max: detection.maxAttempts
    });
  }
}

/**
 * @param {TileDocument} tileDocument
 * @param {object} template
 */
async function onSearchSuccess(tileDocument, template) {
  const clueRecord = buildPlayerClue(template.id, buildPlayerContent(template), { source: CLUE_SOURCES.zone });
  await addCluesToUser(game.user, [clueRecord]);
  await recordFoundZone(game.user, tileDocument.id);
  await whisperGameMasters(format("Chat.PlayerFoundClue", {
    player: escapeText(game.user.name),
    clue: escapeText(template.name)
  }), GM_NOTE_TONES.found);
  await logEvent(LOG_EVENTS.found, { clue: template.name, scene: tileDocument.parent?.name ?? "" });
}

/**
 * Сложность: число или формула, вычисляется в момент броска.
 * @param {string} difficultyText
 * @param {object} rollData
 */
async function evaluateDifficulty(difficultyText, rollData) {
  const numericDifficulty = Number(difficultyText);
  if (difficultyText !== "" && Number.isFinite(numericDifficulty)) return numericDifficulty;
  if (!Roll.validate(difficultyText)) return Number.POSITIVE_INFINITY;
  const difficultyRoll = await new Roll(difficultyText, rollData).evaluate();
  return difficultyRoll.total;
}

/**
 * Бросок средствами dnd5e: ключ навыка (prc, inv), ключ характеристики (wis) или формула (A2).
 * Модуль не кидает кости сам, только сравнивает итог со сложностью.
 * @param {object} detection
 * @param {Actor|null} actor
 * @returns {Promise<{total: number, difficulty: number}|null>} null — бросок не состоялся
 */
export async function rollDetectionCheck(detection, actor) {
  const checkKey = detection.check;
  const rollMode = detection.rollMode;
  const isSkill = Boolean(CONFIG.DND5E?.skills?.[checkKey]);
  const isAbility = Boolean(CONFIG.DND5E?.abilities?.[checkKey]);

  if ((isSkill || isAbility) && !actor) {
    ui.notifications.warn(localize("Search.NoActor"));
    return null;
  }

  let rollData = {};
  if (actor) rollData = actor.getRollData();
  const difficulty = await evaluateDifficulty(detection.dc, rollData);

  let total = null;
  if (isSkill) {
    const rolls = await actor.rollSkill({ skill: checkKey }, { configure: false }, { rollMode });
    total = rolls?.[0]?.total ?? null;
  } else if (isAbility) {
    const rolls = await actor.rollAbilityCheck({ ability: checkKey }, { configure: false }, { rollMode });
    total = rolls?.[0]?.total ?? null;
  } else {
    if (!Roll.validate(checkKey)) {
      ui.notifications.error(localize("Search.InvalidFormula"));
      return null;
    }
    const formulaRoll = await new Roll(checkKey, rollData).evaluate();
    let speaker = ChatMessage.getSpeaker({ user: game.user });
    if (actor) speaker = ChatMessage.getSpeaker({ actor });
    await formulaRoll.toMessage({ speaker, flavor: localize("Search.RollFlavor") }, { rollMode });
    total = formulaRoll.total;
  }
  if (total === null || !Number.isFinite(total)) return null;
  return { total, difficulty };
}
