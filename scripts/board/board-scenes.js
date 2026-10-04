import { MODULE_ID } from "../constants.js";

/**
 * Доска улик — обычная сцена Foundry с флагом board. Досок может быть сколько угодно.
 */

const BOARD_FLAG = "board";

/** @param {Scene|null|undefined} scene */
export function isBoardScene(scene) {
  return Boolean(scene?.flags?.[MODULE_ID]?.[BOARD_FLAG]);
}

/**
 * Пометить сцену как доску или снять пометку (ГМ).
 * @param {Scene} scene
 * @param {boolean} isBoard
 */
export function setBoardScene(scene, isBoard) {
  if (isBoard) return scene.update({ [`flags.${MODULE_ID}.${BOARD_FLAG}`]: true });
  return scene.update({ [`flags.${MODULE_ID}.-=${BOARD_FLAG}`]: null });
}

/** Карточка доски модуля (Drawing с флагом type). @param {DrawingDocument} drawingDocument */
export function isBoardCard(drawingDocument) {
  return Boolean(drawingDocument?.flags?.[MODULE_ID]?.type);
}

/** Данные карточки. @param {DrawingDocument} drawingDocument */
export function getCardData(drawingDocument) {
  return drawingDocument?.flags?.[MODULE_ID] ?? {};
}
