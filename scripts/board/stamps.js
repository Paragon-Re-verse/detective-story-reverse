import { MODULE_ID, STAMP_PATH, BUILT_IN_STAMPS, STAMPABLE_KINDS } from "../constants.js";
import { localize } from "../i18n.js";
import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";
import { isResponsibleGameMaster } from "../permissions.js";
import { getCardData } from "./board-scenes.js";
import { updateCard } from "./board-relay.js";

/**
 * Штампы на карточках доски: «Секретно», «Пропал», крест от руки и т. п.
 * Штамп — белая картинка с прозрачностью из папки штампов (настройка мира), цвет задаётся при наложении.
 * На карточке один штамп: новый заменяет прежний. Положение хранится в долях размера карточки,
 * поэтому штамп остаётся на месте при любом масштабе доски.
 *
 * Список файлов папки читает ГМ и сохраняет в скрытой настройке: у игроков может не быть права обзора файлов.
 */

const IMAGE_EXTENSIONS = [".webp", ".png", ".svg", ".jpg", ".jpeg"];
/** Крест и вымарывание идут почти ровно, текстовые штампы — с наклоном, как от руки. */
const STAMP_TILT_DEGREES = { x: 6, redacted: 2 };
const DEFAULT_TILT_DEGREES = 14;
/** Вымарывание всегда тёмное: это полоса поверх текста, а не цветная печать. */
const REDACTED_COLOR = "#141414";

/** @param {string} kind - вид карточки */
export function canStampKind(kind) {
  return STAMPABLE_KINDS.includes(kind);
}

/** Ключ штампа по имени файла: «classified.webp» → «classified». @param {string} imagePath */
function getStampKey(imagePath) {
  const fileName = decodeURIComponent(String(imagePath).split("/").pop() ?? "");
  return fileName.replace(/\.[^.]+$/, "");
}

/**
 * Штампы для меню: встроенные получают переведённое название, свои — имя файла.
 * @returns {{key: string, image: string, label: string}[]}
 */
export function listStamps() {
  let imagePaths = getSetting(SETTING_KEYS.stampFiles);
  if (!Array.isArray(imagePaths) || !imagePaths.length) {
    imagePaths = BUILT_IN_STAMPS.map((stampKey) => `${STAMP_PATH}/${stampKey}.webp`);
  }
  return imagePaths.map((imagePath) => {
    const stampKey = getStampKey(imagePath);
    let label = stampKey.replace(/[-_]+/g, " ");
    label = label.charAt(0).toLocaleUpperCase(game.i18n.lang) + label.slice(1);
    if (BUILT_IN_STAMPS.includes(stampKey)) label = localize(`Stamps.${stampKey}`);
    return { key: stampKey, image: imagePath, label };
  });
}

/**
 * Перечитать папку штампов и сохранить список файлов (только ответственный ГМ).
 * Вызывается при входе и при смене папки в настройках.
 */
export async function syncStampFiles() {
  if (!isResponsibleGameMaster()) return;
  const folder = String(getSetting(SETTING_KEYS.stampFolder) || STAMP_PATH).replace(/\/+$/, "");
  let imagePaths = [];
  try {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    const listing = await FilePicker.browse("data", folder);
    imagePaths = listing.files.filter((filePath) => IMAGE_EXTENSIONS.some((extension) => filePath.toLowerCase().endsWith(extension)));
  } catch (error) {
    console.warn(`${MODULE_ID} | stamps`, error);
    ui.notifications.warn(localize("Stamps.FolderUnreadable"));
  }
  imagePaths.sort((first, second) => getStampKey(first).localeCompare(getStampKey(second), game.i18n.lang));
  const current = getSetting(SETTING_KEYS.stampFiles) ?? [];
  if (JSON.stringify(current) !== JSON.stringify(imagePaths)) await setSetting(SETTING_KEYS.stampFiles, imagePaths);
}

/**
 * Наложить штамп в точку карточки (под курсором).
 * @param {DrawingDocument} drawingDocument
 * @param {{key: string, image: string}} stamp
 * @param {{x: number, y: number}} localPoint - точка в координатах карточки (без масштаба доски)
 * @param {{width: number, height: number}} cardSize
 */
export async function applyStamp(drawingDocument, stamp, localPoint, cardSize) {
  if (!canStampKind(getCardData(drawingDocument).type)) return;
  const tiltDegrees = STAMP_TILT_DEGREES[stamp.key] ?? DEFAULT_TILT_DEGREES;
  const color = getStampColor(stamp.key);
  await updateCard(drawingDocument.id, {
    [`flags.${MODULE_ID}.stamp`]: {
      image: stamp.image,
      key: stamp.key,
      x: Math.clamp(localPoint.x / cardSize.width, 0, 1),
      y: Math.clamp(localPoint.y / cardSize.height, 0, 1),
      rotation: (Math.random() * 2 - 1) * tiltDegrees,
      color
    }
  });
}

/** Цвет наложения: из настроек мира; вымарывание всегда тёмное. @param {string} stampKey */
export function getStampColor(stampKey) {
  if (stampKey === "redacted") return REDACTED_COLOR;
  return String(getSetting(SETTING_KEYS.stampColor) || "#b3261e");
}

/** Снять штамп. @param {DrawingDocument} drawingDocument */
export async function removeStamp(drawingDocument) {
  await updateCard(drawingDocument.id, { [`flags.${MODULE_ID}.stamp`]: null });
}

/** Крест закрывает почти всю карточку, текстовый штамп ложится полосой по ширине. */
const CROSS_SIZE_RATIO = 0.85;
const STAMP_WIDTH_RATIO = 0.72;
const STAMP_MAX_HEIGHT_RATIO = 0.9;

/**
 * Размер штампа на карточке (в координатах карточки без масштаба доски).
 * @param {string} stampKey
 * @param {{width: number, height: number}} cardSize
 * @param {number} imageRatio - ширина картинки штампа к высоте
 * @returns {{width: number, height: number}}
 */
export function getStampSize(stampKey, cardSize, imageRatio) {
  let width = cardSize.width * STAMP_WIDTH_RATIO;
  if (stampKey === "x") width = Math.min(cardSize.width, cardSize.height) * CROSS_SIZE_RATIO;
  let height = width / imageRatio;
  const maxHeight = cardSize.height * STAMP_MAX_HEIGHT_RATIO;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * imageRatio;
  }
  return { width, height };
}
