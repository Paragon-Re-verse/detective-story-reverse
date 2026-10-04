import { MODULE_ID, THREAD_COLORS, DEFAULT_THREAD_COLOR } from "../constants.js";
import { localize } from "../i18n.js";
import { BoardState } from "./board-state.js";
import { isBoardCard, getCardData } from "./board-scenes.js";
import { getEffectiveScale, getBoardSetting, BOARD_SETTING_KEYS } from "./board-settings.js";
import { updateCard } from "./board-relay.js";
import { createFreeCard, placeClueOnBoard, createSuspectCard } from "./clue-cards.js";
import { chooseClueForBoard, chooseSuspect } from "./pickers.js";

/** Какие карточки можно создать правым кликом по пустому месту, пока тянешь нить. */
const CONNECT_CARD_KINDS = [
  { kind: "sticky", icon: "fa-solid fa-note-sticky" },
  { kind: "pin", icon: "fa-solid fa-thumbtack" },
  { kind: "index", icon: "fa-solid fa-file-lines" },
  { kind: "photo", icon: "fa-solid fa-image" },
  { kind: "handout", icon: "fa-solid fa-scroll" },
  { kind: "media", icon: "fa-solid fa-tape" },
  { kind: "video", icon: "fa-solid fa-film" }
];

/**
 * Нити между карточками. Нить хранится один раз — на карточке, где начинается:
 * connections: [{ targetId, color, createdBy }]. Перерисовываются только нити изменённых карточек
 * (у каждой нити свой PIXI.Graphics), полная перерисовка — только при загрузке сцены.
 */

let threadsContainer = null;
let pinsContainer = null;
const threadGraphics = new Map();

let connectionSourceCard = null;
let connectionHighlight = null;
let connectionPreviewLine = null;
let animatedCardId = null;
let animationTicker = null;

/* -------------------------------------------- */
/*  Рисование пряжи (из прототипа)              */
/* -------------------------------------------- */

function getQuadraticBezierPoints(x0, y0, controlX, controlY, x1, y1, segments) {
  const points = [];
  for (let index = 0; index <= segments; index++) {
    const progress = index / segments;
    const inverse = 1 - progress;
    points.push({
      x: inverse * inverse * x0 + 2 * inverse * progress * controlX + progress * progress * x1,
      y: inverse * inverse * y0 + 2 * inverse * progress * controlY + progress * progress * y1
    });
  }
  return points;
}

function pseudoRandom(seed) {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

/**
 * Seed узора нити из её ключа, а не из координат: иначе при движении конца изгиб и скрутка прыгают каждый кадр.
 * @param {string} seedText
 */
function getStableSeed(seedText) {
  let seed = 0;
  for (let index = 0; index < seedText.length; index++) seed = (seed * 31 + seedText.charCodeAt(index)) % 10000;
  return seed;
}

/**
 * Нить с провисанием, тенью, текстурой скрутки и свисающими концами.
 * В упрощённом виде (пока карточку тянут) — только тень и гладкая кривая: это в разы дешевле.
 * @param {PIXI.Graphics} graphics
 * @param {string} seedText - постоянный ключ нити (id карточек)
 */
function drawYarnLine(graphics, seedText, x1, y1, x2, y2, color, width, animated = false, animationOffset = 0, simplified = false) {
  const sceneScale = getEffectiveScale();
  const middleX = (x1 + x2) / 2;
  const middleY = (y1 + y2) / 2;
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const sag = distance * 0.15;
  const stableSeed = getStableSeed(seedText);
  const wobble = ((stableSeed % 100) / 100) * (20 * sceneScale) - 10 * sceneScale;
  const controlX = middleX + (x2 - x1) * 0.05 + wobble;
  const controlY = middleY + sag;

  const shadowOffset = 3 * sceneScale;
  graphics.lineStyle(width + 2 * sceneScale, 0x000000, 0.25);
  graphics.moveTo(x1 + shadowOffset, y1 + shadowOffset);
  graphics.quadraticCurveTo(controlX + shadowOffset, controlY + shadowOffset, x2 + shadowOffset, y2 + shadowOffset);

  if (simplified) {
    graphics.lineStyle(width, color, 1);
    graphics.moveTo(x1, y1);
    graphics.quadraticCurveTo(controlX, controlY, x2, y2);
    return;
  }

  const segments = Math.max(20, Math.floor(distance / (5 * sceneScale)));
  const points = getQuadraticBezierPoints(x1, y1, controlX, controlY, x2, y2, segments);

  if (animated) {
    const dashLength = 30 * sceneScale;
    const gapLength = 20 * sceneScale;
    graphics.lineStyle(width, color, 0.3);
    graphics.moveTo(x1, y1);
    graphics.quadraticCurveTo(controlX, controlY, x2, y2);
    let travelled = -animationOffset;
    for (let index = 0; index < points.length - 1; index++) {
      const startPoint = points[index];
      const endPoint = points[index + 1];
      const segmentLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
      const cycle = dashLength + gapLength;
      const startModulo = ((travelled % cycle) + cycle) % cycle;
      const endModulo = (((travelled + segmentLength) % cycle) + cycle) % cycle;
      if (startModulo < dashLength || endModulo < dashLength || startModulo > endModulo) {
        graphics.lineStyle(width * 2.5, 0xffffff, 0.8);
        graphics.moveTo(startPoint.x, startPoint.y);
        graphics.lineTo(endPoint.x, endPoint.y);
        graphics.lineStyle(width * 2, color, 1);
        graphics.moveTo(startPoint.x, startPoint.y);
        graphics.lineTo(endPoint.x, endPoint.y);
      }
      travelled += segmentLength;
    }
  } else {
    graphics.lineStyle(width, color, 1);
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) graphics.lineTo(points[index].x, points[index].y);

    const stepSize = Math.max(2 * sceneScale, width * 1.2);
    let distanceSinceTwist = 0;
    for (let index = 0; index < points.length - 1; index++) {
      const startPoint = points[index];
      const endPoint = points[index + 1];
      const segmentLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
      const subSteps = Math.ceil(segmentLength / (2 * sceneScale));
      for (let step = 0; step < subSteps; step++) {
        distanceSinceTwist += segmentLength / subSteps;
        if (distanceSinceTwist < stepSize) continue;
        distanceSinceTwist = 0;
        const progress = step / subSteps;
        const pointX = startPoint.x + (endPoint.x - startPoint.x) * progress;
        const pointY = startPoint.y + (endPoint.y - startPoint.y) * progress;
        const angle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
        const twistSeed = stableSeed + index * 10 + step;
        const twistAngle = angle + Math.PI / 4 + (pseudoRandom(twistSeed) * 0.2 - 0.1);
        const twistThickness = Math.max(sceneScale, (width / 2) * (0.8 + pseudoRandom(twistSeed) * 0.4));
        const twistLength = width * (1 + pseudoRandom(twistSeed + 2) * 0.4);
        graphics.lineStyle(twistThickness, 0x000000, 0.4);
        graphics.moveTo(pointX - Math.cos(twistAngle) * (twistLength / 2), pointY - Math.sin(twistAngle) * (twistLength / 2));
        graphics.lineTo(pointX + Math.cos(twistAngle) * (twistLength / 2), pointY + Math.sin(twistAngle) * (twistLength / 2));
      }
    }

    const highlightWidth = Math.max(sceneScale, width / 3);
    for (let index = 0; index < points.length - 1; index++) {
      const highlightSeed = stableSeed + index * 7;
      if (index % 2 !== 0 && pseudoRandom(highlightSeed) <= 0.5) continue;
      graphics.lineStyle(highlightWidth, 0xffffff, 0.1 + pseudoRandom(highlightSeed + 1) * 0.2);
      graphics.moveTo(points[index].x, points[index].y);
      graphics.lineTo(points[index + 1].x, points[index + 1].y);
    }
  }

  const drawDanglingEnd = (pointX, pointY, isStart) => {
    let endSeed = stableSeed + 456;
    if (isStart) endSeed = stableSeed + 123;
    const angle = Math.PI / 2 + (pseudoRandom(endSeed) * 2 - 1);
    const dangleLength = width * (3 + pseudoRandom(endSeed + 1) * 3);
    const endX = pointX + Math.cos(angle) * dangleLength;
    const endY = pointY + Math.sin(angle) * dangleLength;
    graphics.lineStyle(width, color, 1);
    graphics.moveTo(pointX, pointY);
    graphics.lineTo(endX, endY);
    graphics.lineStyle(Math.max(sceneScale, (width / 2) * (0.8 + pseudoRandom(endSeed + 2) * 0.4)), 0x000000, 0.4);
    graphics.moveTo(pointX, pointY);
    graphics.lineTo(endX, endY);
  };
  drawDanglingEnd(x1, y1, true);
  drawDanglingEnd(x2, y2, false);
}

/** Чуть приглушённый «пряжевый» оттенок цвета палитры. @param {string} colorValue */
function toYarnColor(colorValue) {
  try {
    const color = foundry.utils.Color.from(colorValue);
    let yarnColor = color.multiply(0.7);
    if (color.r > 0.6 && color.g > 0.6 && color.b > 0.6) yarnColor = color.multiply(0.85);
    if (yarnColor.r < 0.1 && yarnColor.g < 0.1 && yarnColor.b < 0.1) yarnColor = yarnColor.add(foundry.utils.Color.from(0x222222));
    return yarnColor.valueOf();
  } catch {
    return 0xc62828;
  }
}

/* -------------------------------------------- */
/*  Контейнеры и точечная перерисовка           */
/* -------------------------------------------- */

function ensureThreadsContainer() {
  if (threadsContainer && !threadsContainer.destroyed) return threadsContainer;
  threadsContainer = new PIXI.Container();
  threadsContainer.zIndex = 10;
  threadsContainer.eventMode = "none";
  canvas.drawings.sortableChildren = true;
  canvas.drawings.addChild(threadsContainer);
  threadGraphics.clear();
  return threadsContainer;
}

function threadKey(sourceId, targetId) {
  return `${sourceId}>${targetId}`;
}

/** Карточки, которые сейчас перетаскивают: id оригинала → клон-превью под курсором. */
const dragPreviews = new Map();
/** Перерисовка нитей при перетаскивании — не чаще одного раза за кадр. */
const pendingDragRedraws = new Set();
let dragRedrawFrame = null;

function getPinPosition(cardObject) {
  const positionSource = dragPreviews.get(cardObject.document.id) ?? cardObject;
  if (typeof positionSource._getPinPosition === "function") return positionSource._getPinPosition();
  return { x: positionSource.document.x, y: positionSource.document.y };
}

/**
 * Во время перетаскивания нити следуют за превью карточек, а не ждут, пока карточку отпустят.
 * @param {Drawing[]} clones
 */
export function updateDragPreview(clones) {
  for (const clone of clones) {
    const originalId = clone._original?.document.id;
    if (!originalId) continue;
    dragPreviews.set(originalId, clone);
    pendingDragRedraws.add(originalId);
  }
  if (dragRedrawFrame) return;
  dragRedrawFrame = window.requestAnimationFrame(() => {
    dragRedrawFrame = null;
    const drawingIds = [...pendingDragRedraws];
    pendingDragRedraws.clear();
    for (const drawingId of drawingIds) redrawThreadsForCard(drawingId);
  });
}

/**
 * Снять превью перетаскивания (после того как документ обновился или перетаскивание отменено).
 * @param {string[]} [drawingIds] - без списка снимаются все
 */
export function clearDragPreview(drawingIds) {
  let idsToClear = drawingIds;
  if (!idsToClear) idsToClear = [...dragPreviews.keys()];
  for (const drawingId of idsToClear) {
    if (!dragPreviews.delete(drawingId)) continue;
    redrawThreadsForCard(drawingId);
  }
}

/** @param {string} key */
function removeThreadGraphics(key) {
  const graphics = threadGraphics.get(key);
  if (!graphics) return;
  if (!graphics.destroyed) graphics.destroy();
  threadGraphics.delete(key);
}

/**
 * Нарисовать одну нить.
 * @param {Drawing} sourceCard
 * @param {{targetId: string, color: string}} connection
 * @param {number} [animationOffset]
 */
function drawThread(sourceCard, connection, animationOffset = 0) {
  const key = threadKey(sourceCard.document.id, connection.targetId);
  const targetCard = canvas.drawings.get(connection.targetId);
  if (!targetCard) {
    removeThreadGraphics(key);
    return;
  }
  const container = ensureThreadsContainer();
  let graphics = threadGraphics.get(key);
  if (!graphics || graphics.destroyed) {
    graphics = new PIXI.Graphics();
    container.addChild(graphics);
    threadGraphics.set(key, graphics);
  }
  graphics.clear();
  const sourcePin = getPinPosition(sourceCard);
  const targetPin = getPinPosition(targetCard);
  const sceneScale = getEffectiveScale();
  const lineWidth = (getBoardSetting(BOARD_SETTING_KEYS.threadWidth) || 7) * sceneScale;
  const animated = animatedCardId === sourceCard.document.id;
  const simplified = dragPreviews.has(sourceCard.document.id) || dragPreviews.has(connection.targetId);
  drawYarnLine(graphics, key, sourcePin.x, sourcePin.y, targetPin.x, targetPin.y, toYarnColor(connection.color), lineWidth, animated, animationOffset, simplified);
}

/** @param {DrawingDocument} drawingDocument */
function getConnections(drawingDocument) {
  const connections = getCardData(drawingDocument).connections;
  if (!Array.isArray(connections)) return [];
  return connections.filter((connection) => connection?.targetId);
}

/**
 * Перерисовать нити, которые затрагивает карточка (исходящие и входящие).
 * @param {string} drawingId
 * @param {number} [animationOffset]
 */
export function redrawThreadsForCard(drawingId, animationOffset = 0) {
  if (!canvas?.ready || !canvas.drawings) return;
  const cardObject = canvas.drawings.get(drawingId);
  const currentKeys = new Set();
  if (cardObject && isBoardCard(cardObject.document)) {
    for (const connection of getConnections(cardObject.document)) {
      currentKeys.add(threadKey(drawingId, connection.targetId));
      drawThread(cardObject, connection, animationOffset);
    }
  }
  for (const key of [...threadGraphics.keys()]) {
    const [sourceId, targetId] = key.split(">");
    if (sourceId === drawingId && !currentKeys.has(key)) removeThreadGraphics(key);
    if (targetId !== drawingId) continue;
    const sourceCard = canvas.drawings.get(sourceId);
    const connection = sourceCard && getConnections(sourceCard.document).find((entry) => entry.targetId === drawingId);
    if (!cardObject || !connection) {
      removeThreadGraphics(key);
    } else {
      drawThread(sourceCard, connection);
    }
  }
}

/** Убрать все нити карточки (после удаления). @param {string} drawingId */
export function removeThreadsForCard(drawingId) {
  for (const key of [...threadGraphics.keys()]) {
    const [sourceId, targetId] = key.split(">");
    if (sourceId === drawingId || targetId === drawingId) removeThreadGraphics(key);
  }
}

/** Полная перерисовка (загрузка сцены). */
export function redrawAllThreads() {
  if (!canvas?.ready || !canvas.drawings) return;
  for (const key of [...threadGraphics.keys()]) removeThreadGraphics(key);
  for (const cardObject of canvas.drawings.placeables) {
    if (!isBoardCard(cardObject.document)) continue;
    for (const connection of getConnections(cardObject.document)) drawThread(cardObject, connection);
  }
}

/** Бегущий пунктир у нитей карточки, пока открыт её редактор. @param {string} drawingId */
export function startThreadAnimation(drawingId) {
  stopThreadAnimation();
  animatedCardId = drawingId;
  let offset = 0;
  animationTicker = () => {
    const sceneScale = getEffectiveScale();
    offset += 4 * sceneScale;
    if (offset > 50 * sceneScale) offset = 0;
    redrawThreadsForCard(drawingId, offset);
  };
  canvas.app.ticker.add(animationTicker);
}

/**
 * Остановить подсветку нитей. С id — только если подсвечена именно эта карточка
 * (окно другой карточки могло открыться позже и перехватить подсветку).
 * @param {string} [drawingId]
 */
export function stopThreadAnimation(drawingId) {
  if (drawingId && drawingId !== animatedCardId) return;
  const previousCardId = animatedCardId;
  animatedCardId = null;
  if (animationTicker) canvas.app?.ticker?.remove(animationTicker);
  animationTicker = null;
  if (previousCardId) redrawThreadsForCard(previousCardId);
}

/* -------------------------------------------- */
/*  Булавки                                     */
/* -------------------------------------------- */

function ensurePinsContainer() {
  if (pinsContainer && !pinsContainer.destroyed) return pinsContainer;
  pinsContainer = new PIXI.Container();
  pinsContainer.zIndex = 20;
  canvas.drawings.addChild(pinsContainer);
  return pinsContainer;
}

/**
 * Поставить булавку одной карточки: она живёт в общем контейнере поверх нитей и принимает клики соединения.
 * Обновляется только изменённая карточка, а не вся доска.
 * @param {Drawing} cardObject
 */
export function updatePinForCard(cardObject) {
  if (!canvas?.ready || !canvas.drawings || cardObject.isPreview || cardObject.destroyed) return;
  const cardData = getCardData(cardObject.document);
  const pinSprite = cardObject.pinSprite;
  if (!cardData.type || !pinSprite || pinSprite.destroyed) return;
  pinSprite.cardId = cardObject.document.id;
  pinSprite.eventMode = "static";
  pinSprite.cursor = "pointer";
  pinSprite.removeAllListeners();
  pinSprite.on("click", (event) => onPinClick(event, cardObject));

  if (cardData.type === "pin") {
    if (pinSprite.parent !== cardObject) cardObject.addChild(pinSprite);
    pinSprite.width = cardObject.document.shape.width || 40;
    pinSprite.height = cardObject.document.shape.height || 40;
    pinSprite.position.set(0, 0);
    return;
  }

  const sceneScale = getEffectiveScale();
  const cardWidth = cardObject.getCardWidth();
  let pinY = cardObject.document.y + 3 * sceneScale;
  if (cardData.type === "handout") pinY = cardObject.document.y + (cardObject.document.shape.height || 400) * 0.05 * sceneScale;
  pinSprite.width = 40 * sceneScale;
  pinSprite.height = 40 * sceneScale;
  pinSprite.x = cardObject.document.x + (cardWidth * sceneScale) / 2 - 20 * sceneScale;
  pinSprite.y = pinY;
  pinSprite.visible = !cardObject.document.hidden || game.user.isGM;
  pinSprite.alpha = 1;
  if (game.user.isGM && cardObject.document.hidden) pinSprite.alpha = 0.4;
  const container = ensurePinsContainer();
  if (pinSprite.parent !== container) container.addChild(pinSprite);
}

/** Все булавки сцены (загрузка сцены, смена масштаба). */
export function updatePins() {
  if (!canvas?.ready || !canvas.drawings) return;
  for (const cardObject of canvas.drawings.placeables) updatePinForCard(cardObject);
}

export function cleanupBoardGraphics() {
  dragPreviews.clear();
  pendingDragRedraws.clear();
  if (dragRedrawFrame) window.cancelAnimationFrame(dragRedrawFrame);
  dragRedrawFrame = null;
  resetConnectionState();
  stopThreadAnimation();
  for (const key of [...threadGraphics.keys()]) removeThreadGraphics(key);
  for (const container of [threadsContainer, pinsContainer]) {
    if (container && !container.destroyed) {
      container.parent?.removeChild(container);
      container.destroy({ children: true });
    }
  }
  threadsContainer = null;
  pinsContainer = null;
}

/* -------------------------------------------- */
/*  Соединение карточек                         */
/* -------------------------------------------- */

function getSelectedThreadColor() {
  return THREAD_COLORS[BoardState.threadColor] ?? THREAD_COLORS[DEFAULT_THREAD_COLOR];
}

/**
 * @param {Drawing} sourceCard
 * @param {Drawing} targetCard
 */
async function createConnection(sourceCard, targetCard) {
  const connections = getConnections(sourceCard.document);
  if (connections.some((connection) => connection.targetId === targetCard.document.id)) return;
  const reverseExists = getConnections(targetCard.document).some((connection) => connection.targetId === sourceCard.document.id);
  if (reverseExists) return;
  const updatedConnections = [...connections, { targetId: targetCard.document.id, color: getSelectedThreadColor(), createdBy: game.user.id }];
  await updateCard(sourceCard.document.id, { [`flags.${MODULE_ID}.connections`]: updatedConnections });
}

/**
 * Удалить одну нить (может любой).
 * @param {string} sourceId
 * @param {string} targetId
 */
export async function removeThread(sourceId, targetId) {
  const sourceDocument = canvas.scene?.drawings.get(sourceId);
  if (!sourceDocument) return;
  const remainingConnections = getConnections(sourceDocument).filter((connection) => connection.targetId !== targetId);
  await updateCard(sourceId, { [`flags.${MODULE_ID}.connections`]: remainingConnections });
}

/** Удалить все нити, касающиеся карточки (исходящие и входящие). @param {string} drawingId */
export async function removeAllThreadsOfCard(drawingId) {
  const cardDocument = canvas.scene?.drawings.get(drawingId);
  if (cardDocument && getConnections(cardDocument).length) {
    await updateCard(drawingId, { [`flags.${MODULE_ID}.connections`]: [] });
  }
  for (const otherDocument of canvas.scene?.drawings ?? []) {
    if (otherDocument.id === drawingId || !isBoardCard(otherDocument)) continue;
    const connections = getConnections(otherDocument);
    if (!connections.some((connection) => connection.targetId === drawingId)) continue;
    await updateCard(otherDocument.id, { [`flags.${MODULE_ID}.connections`]: connections.filter((connection) => connection.targetId !== drawingId) });
  }
}

/**
 * Удалить у всех карточек сцены нити, ведущие к удалённой карточке (выполняет ответственный ГМ).
 * @param {Scene} scene
 * @param {string} deletedId
 */
export async function cleanupThreadsToDeletedCard(scene, deletedId) {
  const updates = [];
  for (const drawingDocument of scene.drawings) {
    if (!isBoardCard(drawingDocument)) continue;
    const connections = getConnections(drawingDocument);
    if (!connections.some((connection) => connection.targetId === deletedId)) continue;
    updates.push({ _id: drawingDocument.id, [`flags.${MODULE_ID}.connections`]: connections.filter((connection) => connection.targetId !== deletedId) });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Drawing", updates);
}

function onPreviewPointerMove(event) {
  if (!connectionSourceCard || !connectionPreviewLine) return;
  const worldPosition = event.getLocalPosition(canvas.stage);
  const sourcePin = getPinPosition(connectionSourceCard);
  connectionPreviewLine.clear();
  const lineWidth = (getBoardSetting(BOARD_SETTING_KEYS.threadWidth) || 7) * getEffectiveScale();
  drawYarnLine(connectionPreviewLine, connectionSourceCard.document.id, sourcePin.x, sourcePin.y, worldPosition.x, worldPosition.y, toYarnColor(getSelectedThreadColor()), lineWidth);
}

/**
 * Клик по булавке: первая — начало нити, вторая — конец.
 * @param {PIXI.FederatedEvent} event
 * @param {Drawing} cardObject
 */
export function onPinClick(event, cardObject) {
  event.stopPropagation();
  if (!BoardState.active) return;
  if (!connectionSourceCard) {
    connectionSourceCard = cardObject;
    const sceneScale = getEffectiveScale();
    connectionHighlight = new PIXI.Graphics();
    connectionHighlight.lineStyle(4 * sceneScale, 0x00ff00, 1);
    connectionHighlight.drawRect(
      cardObject.document.x,
      cardObject.document.y,
      (cardObject.document.shape.width || 40) * sceneScale,
      (cardObject.document.shape.height || 40) * sceneScale
    );
    canvas.controls.addChild(connectionHighlight);
    connectionPreviewLine = new PIXI.Graphics();
    connectionPreviewLine.zIndex = 15;
    canvas.drawings.addChild(connectionPreviewLine);
    canvas.stage.on("pointermove", onPreviewPointerMove);
    canvas.stage.once("click", onCanvasClickWhileConnecting);
    canvas.stage.once("rightclick", onCanvasRightClickWhileConnecting);
    return;
  }
  if (cardObject === connectionSourceCard) {
    ui.notifications.warn(localize("Board.CannotConnectSelf"));
    return;
  }
  const sourceCard = connectionSourceCard;
  resetConnectionState();
  createConnection(sourceCard, cardObject);
}

/** Клик по пустому месту во время соединения — булавка в этой точке и нить к ней. */
async function onCanvasClickWhileConnecting(event) {
  if (!connectionSourceCard) return;
  const target = event.target;
  // Клик пришёлся на карточку, а не на булавку: соединение продолжается, ждём следующий клик.
  if (target?.document && isBoardCard(target.document)) {
    canvas.stage.once("click", onCanvasClickWhileConnecting);
    return;
  }
  const sourceCard = connectionSourceCard;
  const worldPosition = event.getLocalPosition(canvas.stage);
  resetConnectionState();
  const pinSize = 40 * getEffectiveScale();
  const createdId = await createFreeCard("pin", { x: worldPosition.x - pinSize / 2, y: worldPosition.y - pinSize / 2 });
  const targetCard = canvas.drawings.get(createdId);
  if (targetCard) await createConnection(sourceCard, targetCard);
}

/** Правый клик по пустому месту — меню: создать стикер или булавку и соединить. */
function onCanvasRightClickWhileConnecting(event) {
  if (!connectionSourceCard) return;
  const sourceCard = connectionSourceCard;
  const worldPosition = event.getLocalPosition(canvas.stage);
  const screenPosition = event.global;
  canvas.stage.off("click", onCanvasClickWhileConnecting);
  const position = { centerX: worldPosition.x, centerY: worldPosition.y };
  /** Создать карточку в точке клика и протянуть к ней нить. @param {() => Promise<string|null>} createCard */
  const createAndConnect = async (createCard) => {
    resetConnectionState();
    const createdId = await createCard();
    const targetCard = canvas.drawings.get(createdId);
    if (targetCard) await createConnection(sourceCard, targetCard);
  };
  const menuItems = CONNECT_CARD_KINDS.map(({ kind, icon }) => ({
    icon,
    label: localize(`Kind.${kind}`),
    callback: () => createAndConnect(() => createFreeCard(kind, position))
  }));
  menuItems.push({
    icon: "fa-solid fa-magnifying-glass",
    label: localize("Board.CreateFromClue"),
    callback: () => createAndConnect(async () => {
      const clue = await chooseClueForBoard();
      if (!clue) return null;
      return placeClueOnBoard(clue, position);
    })
  });
  menuItems.push({
    icon: "fa-solid fa-user-secret",
    label: localize("Board.CreateSuspect"),
    callback: () => createAndConnect(async () => {
      const suspect = await chooseSuspect();
      if (!suspect) return null;
      return createSuspectCard(suspect, position);
    })
  });
  showBoardContextMenu(screenPosition.x, screenPosition.y, menuItems, () => resetConnectionState());
}

export function resetConnectionState() {
  connectionSourceCard = null;
  if (connectionHighlight && !connectionHighlight.destroyed) {
    connectionHighlight.parent?.removeChild(connectionHighlight);
    connectionHighlight.destroy();
  }
  connectionHighlight = null;
  if (connectionPreviewLine && !connectionPreviewLine.destroyed) {
    connectionPreviewLine.parent?.removeChild(connectionPreviewLine);
    connectionPreviewLine.destroy();
  }
  connectionPreviewLine = null;
  if (canvas?.stage) {
    canvas.stage.off("pointermove", onPreviewPointerMove);
    canvas.stage.off("click", onCanvasClickWhileConnecting);
    canvas.stage.off("rightclick", onCanvasRightClickWhileConnecting);
  }
}

/* -------------------------------------------- */
/*  Контекстное меню доски                      */
/* -------------------------------------------- */

/**
 * Простое меню в точке экрана (доска — PIXI, штатное ContextMenu Foundry к ней не цепляется).
 * @param {number} screenX
 * @param {number} screenY
 * @param {{icon: string, label: string, callback: Function}[]} menuItems
 * @param {Function} [onDismiss]
 */
export function showBoardContextMenu(screenX, screenY, menuItems, onDismiss) {
  document.querySelectorAll(".detective-story-board-menu").forEach((menuElement) => menuElement.remove());
  const menuElement = document.createElement("nav");
  menuElement.className = "detective-story-board-menu";
  menuElement.style.left = `${screenX}px`;
  menuElement.style.top = `${screenY}px`;
  const listElement = document.createElement("ol");
  let chosen = false;
  for (const menuItem of menuItems) {
    const itemElement = document.createElement("li");
    itemElement.className = "board-menu-item";
    let iconElement = document.createElement("i");
    iconElement.className = menuItem.icon;
    if (menuItem.maskImage) {
      iconElement = document.createElement("span");
      iconElement.className = "board-menu-stamp";
      iconElement.style.setProperty("--stamp-image", `url("${foundry.utils.getRoute(menuItem.maskImage)}")`);
      iconElement.style.backgroundColor = menuItem.maskColor;
    }
    const labelElement = document.createElement("span");
    labelElement.textContent = menuItem.label;
    itemElement.append(iconElement, labelElement);
    itemElement.addEventListener("click", (event) => {
      event.stopPropagation();
      chosen = true;
      closeMenu();
      menuItem.callback();
    });
    listElement.append(itemElement);
  }
  menuElement.append(listElement);
  document.body.append(menuElement);

  const onOutsidePointer = (event) => {
    if (menuElement.contains(event.target)) return;
    closeMenu();
  };
  function closeMenu() {
    menuElement.remove();
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    window.removeEventListener("wheel", closeMenu);
    if (!chosen && onDismiss) onDismiss();
  }
  window.setTimeout(() => {
    document.addEventListener("pointerdown", onOutsidePointer, true);
    window.addEventListener("wheel", closeMenu, { once: true });
  }, 50);
}
