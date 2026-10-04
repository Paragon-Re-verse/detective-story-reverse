import { BOARD_ASSET_PATH, DEFAULT_FONT, FONT_REPLACEMENTS, VIDEO_CASSETTE_IMAGE } from "../constants.js";

/**
 * Небольшое превью карточки доски в редакторе улики: та же бумага, рамка, шрифт и цвет чернил,
 * что и на доске. Размер шрифта пересчитывается так же, как на канвасе (ширина 200 — базовая).
 */

const PREVIEW_WIDTHS = { photo: 160, sticky: 170, index: 260, handout: 200, media: 220, video: 230 };
const ENLARGED_FONTS = ["Caveat", "Amatic SC"];

/** Текст без HTML-разметки. @param {string} htmlText */
function toPlainText(htmlText) {
  if (!htmlText) return "";
  return new DOMParser().parseFromString(htmlText, "text/html").body.textContent.trim();
}

/**
 * @param {string} className
 * @param {string} [source]
 */
function createImage(className, source) {
  const imageElement = document.createElement("img");
  imageElement.className = className;
  imageElement.alt = "";
  if (source) imageElement.src = source;
  return imageElement;
}

/**
 * Текстовый блок со шрифтом карточки.
 * @param {string} className
 * @param {string} text
 * @param {object} visual
 * @param {number} previewWidth
 */
function createText(className, text, visual, previewWidth) {
  let fontFamily = visual.font || DEFAULT_FONT;
  if (FONT_REPLACEMENTS[fontFamily]) fontFamily = FONT_REPLACEMENTS[fontFamily];
  let fontBoost = 1;
  if (ENLARGED_FONTS.includes(fontFamily)) fontBoost = 1.6;
  const fontSize = (previewWidth / 200) * (Number(visual.fontSize) || 16) * fontBoost;
  const textElement = document.createElement("div");
  textElement.className = className;
  textElement.textContent = text;
  textElement.style.fontFamily = `"${fontFamily}", sans-serif`;
  textElement.style.fontSize = `${fontSize}px`;
  textElement.style.color = visual.textColor || "#000000";
  return textElement;
}

/**
 * Нарисовать превью в контейнере.
 * @param {HTMLElement} container
 * @param {{name: string, img: string, description: string, visual: object}} clue
 */
export function renderCardMiniPreview(container, { name, img, description, visual }) {
  const kind = visual.kind || "photo";
  const previewWidth = PREVIEW_WIDTHS[kind] ?? 180;
  const cardElement = document.createElement("div");
  cardElement.className = `mini-card mini-${kind}`;
  cardElement.style.width = `${previewWidth}px`;

  if (kind === "photo") {
    cardElement.append(createImage("mini-frame", `${BOARD_ASSET_PATH}/photoFrame.webp`));
    const photoWindow = document.createElement("div");
    photoWindow.className = "mini-photo-window";
    photoWindow.append(createImage("mini-photo", visual.image || img || `${BOARD_ASSET_PATH}/placeholder.webp`));
    cardElement.append(photoWindow, createText("mini-caption", visual.text || name, visual, previewWidth));
  } else if (kind === "sticky" || kind === "index") {
    let paperImage = `${BOARD_ASSET_PATH}/note_white.webp`;
    let text = visual.text || name;
    if (kind === "index") {
      paperImage = `${BOARD_ASSET_PATH}/note_index.webp`;
      text = visual.text || toPlainText(description) || name;
    }
    cardElement.style.setProperty("--paper-image", `url("${foundry.utils.getRoute(paperImage)}")`);
    cardElement.style.setProperty("--paper-tint", visual.tint || "#ffffff");
    if (kind === "index") cardElement.style.setProperty("--paper-tint", "#ffffff");
    cardElement.append(createText("mini-paper-text", text, visual, previewWidth));
  } else if (kind === "handout") {
    cardElement.append(createImage("mini-handout", visual.image || img || `${BOARD_ASSET_PATH}/newhandout.webp`));
  } else if (kind === "media") {
    cardElement.append(createImage("mini-cassette", `${BOARD_ASSET_PATH}/cassette1.webp`));
  } else if (kind === "video") {
    cardElement.append(createImage("mini-cassette", VIDEO_CASSETTE_IMAGE));
    const labelElement = document.createElement("div");
    labelElement.className = "mini-vhs-label";
    labelElement.style.fontFamily = `"${visual.font || DEFAULT_FONT}"`;
    labelElement.textContent = visual.text || name;
    cardElement.append(labelElement);
  }

  const pinElement = createImage("mini-pin", `${BOARD_ASSET_PATH}/redPin.webp`);
  cardElement.append(pinElement);
  container.replaceChildren(cardElement);
}
