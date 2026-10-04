import { MODULE_ID, BOARD_ASSET_PATH, DEFAULT_FONT, INK_COLORS, STICKY_TINTS, VIDEO_CASSETTE_IMAGE, VIDEO_CASSETTE_RATIO } from "../constants.js";
import { localize } from "../i18n.js";
import { getEffectiveScale, getBoardSetting, BOARD_SETTING_KEYS } from "./board-settings.js";
import { createCards } from "./board-relay.js";
import { isBoardScene } from "./board-scenes.js";
import { logEvent, LOG_EVENTS } from "../data/event-log.js";

/**
 * Создание карточек доски. Карточка хранит снимок содержимого (название, изображение, текст),
 * чтобы её видели все, даже если самой улики у них нет. Личные заметки на карточку не попадают.
 */

const CASSETTE_IMAGES = ["cassette1.webp", "cassette2.webp", "cassette3.webp"];

/** Размер карточки вида. @param {string} kind */
export function getCardSize(kind) {
  if (kind === "photo") {
    const width = getBoardSetting(BOARD_SETTING_KEYS.photoWidth) || 225;
    return { width, height: Math.round(width / (225 / 290)) };
  }
  if (kind === "index") {
    const width = getBoardSetting(BOARD_SETTING_KEYS.indexWidth) || 600;
    return { width, height: Math.round(width / (600 / 400)) };
  }
  if (kind === "handout") {
    return {
      width: getBoardSetting(BOARD_SETTING_KEYS.handoutWidth) || 400,
      height: getBoardSetting(BOARD_SETTING_KEYS.handoutHeight) || 400
    };
  }
  if (kind === "media") return { width: 400, height: Math.round(400 * 0.74) };
  if (kind === "video") return { width: 420, height: Math.round(420 / VIDEO_CASSETTE_RATIO) };
  if (kind === "pin") return { width: 40, height: 40 };
  const stickyWidth = getBoardSetting(BOARD_SETTING_KEYS.stickyWidth) || 200;
  return { width: stickyWidth, height: stickyWidth };
}

/** Текст без HTML-разметки (описание приходит из редактора с форматированием). */
function toPlainText(htmlText) {
  if (!htmlText) return "";
  return new DOMParser().parseFromString(htmlText, "text/html").body.textContent.trim();
}

function pickCassetteImage() {
  const imageName = CASSETTE_IMAGES[Math.floor(Math.random() * CASSETTE_IMAGES.length)];
  return `${BOARD_ASSET_PATH}/${imageName}`;
}

/**
 * Данные Drawing для карточки.
 * @param {string} kind
 * @param {object} cardFlags
 * @param {{x?: number, y?: number, centerX?: number, centerY?: number}} position
 */
function buildCardCreateData(kind, cardFlags, position = {}) {
  const sceneScale = getEffectiveScale();
  const { width, height } = getCardSize(kind);
  let centerX = position.centerX;
  let centerY = position.centerY;
  if (centerX === undefined || centerY === undefined) {
    centerX = canvas.stage.pivot.x;
    centerY = canvas.stage.pivot.y;
  }
  let x = centerX - (width * sceneScale) / 2;
  let y = centerY - (height * sceneScale) / 2;
  if (position.x !== undefined && position.y !== undefined) {
    x = position.x;
    y = position.y;
  }
  return {
    author: game.user.id,
    x,
    y,
    shape: { type: "r", width, height },
    fillType: CONST.DRAWING_FILL_TYPES.SOLID,
    fillColor: "#000000",
    fillAlpha: 0.001,
    strokeWidth: 0,
    strokeAlpha: 0,
    locked: false,
    flags: {
      [MODULE_ID]: {
        type: kind,
        text: "",
        image: "",
        audioPath: "",
        videoPath: "",
        audioEffectEnabled: true,
        font: DEFAULT_FONT,
        fontSize: 16,
        tint: STICKY_TINTS.white,
        textColor: INK_COLORS.black,
        connections: [],
        createdBy: game.user.id,
        ...cardFlags
      }
    }
  };
}

/**
 * Свободная карточка (стикер, булавка).
 * @param {string} kind
 * @param {object} [position]
 * @param {object} [cardFlags]
 * @returns {Promise<string|null>}
 */
export async function createFreeCard(kind, position = {}, cardFlags = {}) {
  if (!isBoardScene(canvas.scene)) {
    ui.notifications.warn(localize("ClueList.OpenBoardFirst"));
    return null;
  }
  const defaultFlags = { text: "" };
  if (kind === "sticky") defaultFlags.text = localize("Board.DefaultStickyText");
  if (kind === "media") defaultFlags.image = pickCassetteImage();
  if (kind === "video") defaultFlags.image = VIDEO_CASSETTE_IMAGE;
  const createData = buildCardCreateData(kind, { ...defaultFlags, ...cardFlags }, position);
  const [createdId] = await createCards([createData]);
  return createdId ?? null;
}

/**
 * «Выставить на доску»: карточка вида из поля «Вид» улики — в центре видимой области или в заданной точке.
 * @param {object} playerClue
 * @param {{centerX?: number, centerY?: number}} [position]
 */
export async function placeClueOnBoard(playerClue, position = {}) {
  const visual = playerClue.visual ?? {};
  const kind = visual.kind || "photo";
  const plainDescription = toPlainText(playerClue.description);
  const cardFlags = {
    originId: playerClue.originId,
    snapshot: { name: playerClue.name, img: playerClue.img, description: plainDescription },
    font: visual.font || DEFAULT_FONT,
    fontSize: visual.fontSize || 16,
    textColor: visual.textColor || INK_COLORS.black,
    tint: visual.tint || STICKY_TINTS.white
  };
  if (kind === "photo") {
    cardFlags.text = visual.text || playerClue.name;
    cardFlags.image = visual.image || playerClue.img;
  } else if (kind === "index") {
    cardFlags.text = visual.text || plainDescription || playerClue.name;
  } else if (kind === "sticky") {
    cardFlags.text = visual.text || playerClue.name;
  } else if (kind === "handout") {
    cardFlags.image = visual.image || playerClue.img;
  } else if (kind === "media") {
    cardFlags.text = playerClue.name;
    cardFlags.image = pickCassetteImage();
    cardFlags.audioPath = visual.audioPath || "";
    cardFlags.audioEffectEnabled = visual.audioEffectEnabled !== false;
  } else if (kind === "video") {
    cardFlags.text = playerClue.name;
    cardFlags.image = VIDEO_CASSETTE_IMAGE;
    cardFlags.videoPath = visual.videoPath || "";
    cardFlags.audioEffectEnabled = visual.audioEffectEnabled !== false;
  }
  const createData = buildCardCreateData(kind, cardFlags, position);
  const [createdId] = await createCards([createData]);
  if (createdId) {
    ui.notifications.info(localize("Board.CardPlaced"));
    await logEvent(LOG_EVENTS.placedOnBoard, { clue: playerClue.name, scene: canvas.scene?.name ?? "" });
  }
  return createdId ?? null;
}

/**
 * Фотокарточка подозреваемого (A12).
 * @param {{id: string, name: string, portrait: string}} suspect
 */
export async function createSuspectCard(suspect, position = {}) {
  return createFreeCard("photo", position, {
    text: suspect.name,
    image: suspect.portrait,
    suspectId: suspect.id,
    snapshot: { name: suspect.name, img: suspect.portrait, description: "" }
  });
}
