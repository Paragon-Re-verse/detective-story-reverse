export const MODULE_ID = "detective-story-reverse";
export const I18N_ROOT = "DETECTIVE_STORY";
export const MODULE_PATH = `modules/${MODULE_ID}`;
export const TEMPLATE_PATH = `${MODULE_PATH}/templates`;
export const ASSET_PATH = `${MODULE_PATH}/assets`;
export const BOARD_ASSET_PATH = `${ASSET_PATH}/board`;

/** Версия схемы данных мира: нужна будущим версиям для миграций. */
export const SCHEMA_VERSION = 1;

/** Формат файла экспорта. */
export const EXPORT_FORMAT = "detective-story-reverse";
export const EXPORT_FORMAT_VERSION = 1;

/** Ключи мировых папок журналов, которые модуль создаёт сам. */
export const FOLDER_KEYS = {
  clues: "clues",
  suspects: "suspects",
  cases: "cases"
};

/** Встроенные типы улик. Названия берутся из языкового файла. */
export const BUILT_IN_CLUE_TYPES = [
  "silhouette", "blood", "footprints", "fingerprint", "document", "item", "weapon", "key", "audio"
];

/** Виды карточек на доске. */
export const CLUE_KINDS = ["photo", "index", "sticky", "handout", "media", "video"];

export const ZONE_MODES = ["background", "battlemap"];

export const ROLL_MODES = ["publicroll", "gmroll", "blindroll", "selfroll"];

/** Цвета бумаги стикера. */
export const STICKY_TINTS = {
  white: "#ffffff",
  lightRed: "#ffcccc",
  blue: "#99ccff",
  green: "#99ff99",
  yellow: "#ffff99",
  orange: "#ffcc99"
};

/** Цвета чернил. */
export const INK_COLORS = {
  black: "#000000",
  red: "#cc0000",
  green: "#006600",
  blue: "#0000cc"
};

/** Палитра нитей (допущение A15). */
export const THREAD_COLORS = {
  red: "#c62828",
  blue: "#1565c0",
  green: "#2e7d32",
  yellow: "#f9a825",
  white: "#f5f5f5",
  black: "#212121"
};
export const DEFAULT_THREAD_COLOR = "red";

export const PIN_IMAGES = ["redPin.webp", "bluePin.webp", "yellowPin.webp", "greenPin.webp"];

/** Штампы: встроенные белые картинки с прозрачностью (цвет задаётся при наложении). */
export const STAMP_PATH = `${ASSET_PATH}/stamps`;

/** Видеокассета VHS: картинка карточки и её пропорции (ширина к высоте). */
export const VIDEO_CASSETTE_IMAGE = `${BOARD_ASSET_PATH}/vhs.webp`;
export const VIDEO_CASSETTE_RATIO = 416 / 228;
export const BUILT_IN_STAMPS = ["classified", "missing", "x", "evidence", "deceased", "redacted"];
/** Виды карточек, на которые ставится штамп: бумага, раздаточный материал и фотокарточка. */
export const STAMPABLE_KINDS = ["sticky", "index", "handout", "photo"];

/**
 * Шрифты с кириллицей, прошедшие проверку покрытия глифов (fontTools):
 * 33 буквы в обоих регистрах, латиница, цифры, пунктуация.
 */
export const FONTS = [
  { family: "Caveat", style: "handwritten" },
  { family: "Marck Script", style: "handwritten" },
  { family: "Neucha", style: "handwritten" },
  { family: "Bad Script", style: "handwritten" },
  { family: "Amatic SC", style: "handwritten" },
  { family: "PT Mono", style: "typewriter" },
  { family: "IBM Plex Mono", style: "typewriter" },
  { family: "Fira Mono", style: "typewriter" },
  { family: "Roboto Mono", style: "typewriter" }
];
export const DEFAULT_FONT = "Caveat";

/** Замена удалённых шрифтов прототипа шрифтом того же стиля. */
export const FONT_REPLACEMENTS = {
  "Rock Salt": "Caveat",
  "Typewriter Condensed": "PT Mono",
  "IB Special Elite": "PT Mono",
  "Special Elite": "PT Mono"
};

export const FIND_ANIMATION_DURATION_MS = 5000;
export const SEARCH_DEBOUNCE_MS = 250;
