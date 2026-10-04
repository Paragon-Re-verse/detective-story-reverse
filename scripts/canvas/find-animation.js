import { FIND_ANIMATION_DURATION_MS } from "../constants.js";
import { localize, format } from "../i18n.js";
import { getSetting, SETTING_KEYS } from "../settings.js";
import { getPlayerClues, CLUE_SOURCES } from "../data/player-clues.js";
import { getClueType } from "../data/clue-types.js";

/**
 * Анимация находки: по центру экрана полароид улики на булавке, штамп «Улика найдена» и тип; 5 секунд, затем плавное затухание.
 * Видна только получателю, без звука и без перехвата кликов.
 * Триггер — новая запись в собственном clues (updateUser на самого себя).
 * Несколько улик за раз — одна анимация с первой и подписью «и ещё N» (A14).
 */

const ELEMENT_ID = "detective-story-find-animation";
let knownOriginIds = new Set();
let hideTimer = null;
let removeTimer = null;

/**
 * @param {object[]} clueRecords
 */
export function showFindAnimation(clueRecords) {
  if (!clueRecords.length) return;
  if (!getSetting(SETTING_KEYS.findAnimation)) return;

  const firstClue = clueRecords[0];
  const clueType = getClueType(firstClue.typeId);

  document.getElementById(ELEMENT_ID)?.remove();
  window.clearTimeout(hideTimer);
  window.clearTimeout(removeTimer);

  const container = document.createElement("div");
  container.id = ELEMENT_ID;
  container.setAttribute("aria-live", "polite");

  const stampElement = document.createElement("div");
  stampElement.className = "find-stamp";
  let stampKey = "FindAnimation.Stamp";
  if (firstClue.receivedFrom?.source !== CLUE_SOURCES.zone) stampKey = "FindAnimation.StampReceived";
  stampElement.textContent = localize(stampKey);

  const polaroidElement = document.createElement("figure");
  polaroidElement.className = "dsr-polaroid find-polaroid";
  const imageElement = document.createElement("img");
  imageElement.src = firstClue.img;
  imageElement.alt = "";
  const captionElement = document.createElement("figcaption");
  captionElement.textContent = firstClue.name;
  polaroidElement.append(imageElement, captionElement);

  const typeElement = document.createElement("div");
  typeElement.className = "find-type";
  const typeIcon = document.createElement("img");
  typeIcon.src = clueType.icon;
  typeIcon.alt = "";
  const typeName = document.createElement("span");
  typeName.textContent = clueType.name;
  typeElement.append(typeIcon, typeName);

  container.append(polaroidElement, stampElement, typeElement);

  if (clueRecords.length > 1) {
    const moreElement = document.createElement("div");
    moreElement.className = "find-more";
    moreElement.textContent = format("FindAnimation.AndMore", { count: clueRecords.length - 1 });
    container.append(moreElement);
  }

  // Появление — CSS-анимация при вставке в страницу; затухание — класс fading.
  document.body.append(container);

  hideTimer = window.setTimeout(() => container.classList.add("fading"), FIND_ANIMATION_DURATION_MS);
  removeTimer = window.setTimeout(() => container.remove(), FIND_ANIMATION_DURATION_MS + 1500);
}

/** Запомнить текущие улики, чтобы отличать новые. */
export function initializeFindAnimationWatcher() {
  knownOriginIds = new Set(Object.keys(getPlayerClues(game.user)));
}

/**
 * Вызывается из хука updateUser для текущего пользователя.
 */
export function onOwnCluesChanged() {
  const currentClues = getPlayerClues(game.user);
  const newClues = [];
  for (const [originId, clueRecord] of Object.entries(currentClues)) {
    if (!knownOriginIds.has(originId)) newClues.push(clueRecord);
  }
  knownOriginIds = new Set(Object.keys(currentClues));
  if (game.user.isGM) return;
  showFindAnimation(newClues);
}
