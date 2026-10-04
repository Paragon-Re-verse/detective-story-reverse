import { MODULE_ID } from "../constants.js";
import { canCreateDrawingsDirectly } from "../permissions.js";
import { registerGameMasterHandler, registerEveryoneHandler, requestAsGameMaster, assertPermission, executeForOthers } from "../socket.js";
import { isBoardCard, isBoardScene } from "./board-scenes.js";
import { applyTapeEffectToSound } from "./audio-utils.js";
import { openVideoPlayer, closeVideoPlayer } from "./video-player.js";

/**
 * Запись карточек доски. Если у пользователя есть права Foundry — пишет напрямую,
 * иначе запрос уходит ГМ через socketlib (гибрид A1). ГМ проверяет, что запрос касается
 * карточек модуля на сцене-доске и не трогает посторонних полей.
 */

const ALLOWED_UPDATE_KEYS = ["x", "y", "shape", "flags", "_id"];

/**
 * @param {object} changes
 * @returns {object} только разрешённые поля
 */
function filterCardChanges(changes) {
  const flatChanges = foundry.utils.flattenObject(changes);
  const allowedChanges = {};
  for (const [path, value] of Object.entries(flatChanges)) {
    const rootKey = path.split(".")[0];
    if (!ALLOWED_UPDATE_KEYS.includes(rootKey)) continue;
    if (rootKey === "flags" && !path.startsWith(`flags.${MODULE_ID}.`)) continue;
    allowedChanges[path] = value;
  }
  return allowedChanges;
}

/** Foundry v13 требует видимую заливку, линию или текст: страховка для старых карточек. */
function ensureVisibleFill(drawingDocument, changes) {
  if (drawingDocument.fillAlpha === 0 && drawingDocument.strokeWidth === 0 && !("fillAlpha" in changes)) {
    return { ...changes, fillAlpha: 0.001 };
  }
  return changes;
}

registerGameMasterHandler("boardCreateCards", async (requester, sceneId, createDataList) => {
  const scene = game.scenes.get(sceneId);
  assertPermission(Boolean(scene) && isBoardScene(scene) && Array.isArray(createDataList));
  const sanitizedList = createDataList.map((createData) => {
    assertPermission(Boolean(createData?.flags?.[MODULE_ID]?.type));
    return { ...createData, author: requester.id };
  });
  const createdDocuments = await scene.createEmbeddedDocuments("Drawing", sanitizedList, { detectiveStoryCreation: true, requestingUserId: requester.id });
  return createdDocuments.map((drawingDocument) => drawingDocument.id);
});

registerGameMasterHandler("boardUpdateCard", async (requester, sceneId, drawingId, changes) => {
  const drawingDocument = game.scenes.get(sceneId)?.drawings.get(drawingId);
  assertPermission(isBoardCard(drawingDocument));
  const allowedChanges = filterCardChanges(changes);
  if (foundry.utils.isEmpty(allowedChanges)) return false;
  await drawingDocument.update(ensureVisibleFill(drawingDocument, allowedChanges));
  return true;
});

const activeGlobalSounds = new Map();

/** Проиграть файл у себя (часть общего воспроизведения). */
async function playLocally(audioPath, applyEffect, offset) {
  stopLocally(audioPath);
  const sound = await game.audio.play(audioPath, { volume: 0.8, offset: offset || 0 });
  if (!sound) return;
  activeGlobalSounds.set(audioPath, sound);
  if (applyEffect) applyTapeEffectToSound(sound);
}

function stopLocally(audioPath) {
  activeGlobalSounds.get(audioPath)?.stop();
  activeGlobalSounds.delete(audioPath);
}

registerEveryoneHandler("boardPlayAudio", playLocally);
registerEveryoneHandler("boardStopAudio", stopLocally);

/** Воспроизведение для всех (только ГМ). */
export async function playAudioForEveryone(audioPath, applyEffect, offset) {
  if (!game.user.isGM) return;
  await executeForOthers("boardPlayAudio", audioPath, applyEffect, offset);
  await playLocally(audioPath, applyEffect, offset);
}

export async function stopAudioForEveryone(audioPath) {
  if (!game.user.isGM) return;
  await executeForOthers("boardStopAudio", audioPath);
  stopLocally(audioPath);
}

/** Видео, которые ГМ сейчас показывает всем (для пункта «Остановить для всех»). */
const activeGlobalVideos = new Set();

registerEveryoneHandler("boardPlayVideo", (playback) => openVideoPlayer(playback));
registerEveryoneHandler("boardStopVideo", (videoPath) => closeVideoPlayer(videoPath));

/**
 * Показать видео всем (только ГМ): у каждого открывается окно и играет с того же места.
 * @param {{videoPath: string, title: string, applyEffect: boolean, offset: number}} playback
 */
export async function playVideoForEveryone(playback) {
  if (!game.user.isGM) return;
  activeGlobalVideos.add(playback.videoPath);
  await executeForOthers("boardPlayVideo", playback);
  await openVideoPlayer(playback);
}

/** @param {string} videoPath */
export async function stopVideoForEveryone(videoPath) {
  if (!game.user.isGM) return;
  activeGlobalVideos.delete(videoPath);
  await executeForOthers("boardStopVideo", videoPath);
  await closeVideoPlayer(videoPath);
}

/** Показывает ли ГМ это видео всем. @param {string} videoPath */
export function isGlobalVideoPlaying(videoPath) {
  return activeGlobalVideos.has(videoPath);
}

/** Идёт ли общее воспроизведение файла. */
export function isGlobalAudioPlaying(audioPath) {
  return Boolean(activeGlobalSounds.get(audioPath)?.playing);
}

/**
 * Создать карточки на текущей сцене.
 * @param {object[]} createDataList
 * @param {object} [options]
 * @returns {Promise<string[]>} id созданных карточек
 */
export async function createCards(createDataList, options = {}) {
  const scene = canvas.scene;
  if (!scene) return [];
  if (canCreateDrawingsDirectly()) {
    const createdDocuments = await scene.createEmbeddedDocuments("Drawing", createDataList, { ...options, detectiveStoryCreation: true });
    return createdDocuments.map((drawingDocument) => drawingDocument.id);
  }
  const createdIds = await requestAsGameMaster("boardCreateCards", scene.id, createDataList);
  return createdIds ?? [];
}

/**
 * Изменить карточку: владелец и ГМ пишут напрямую, остальные — через ГМ.
 * @param {string} drawingId
 * @param {object} changes
 */
export async function updateCard(drawingId, changes) {
  const scene = canvas.scene;
  const drawingDocument = scene?.drawings.get(drawingId);
  if (!drawingDocument || !isBoardCard(drawingDocument)) return;
  if (game.user.isGM || drawingDocument.isOwner) {
    await drawingDocument.update(ensureVisibleFill(drawingDocument, changes), { detectiveStoryRelayed: true });
    return;
  }
  await requestAsGameMaster("boardUpdateCard", scene.id, drawingId, changes);
}

/** Удалить карточку (только ГМ). @param {string} drawingId */
export async function deleteCard(drawingId) {
  if (!game.user.isGM) return;
  await canvas.scene?.drawings.get(drawingId)?.delete({ detectiveStoryDelete: true });
}
