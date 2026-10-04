import { MODULE_ID, FOLDER_KEYS, CLUE_KINDS, ZONE_MODES, ROLL_MODES, DEFAULT_FONT, INK_COLORS, STICKY_TINTS, BOARD_ASSET_PATH } from "../constants.js";
import { localize } from "../i18n.js";
import { ensureModuleFolder } from "./folders.js";

/**
 * Шаблон улики (то, что редактирует ГМ): один JournalEntry на шаблон в папке «Улики»,
 * данные — во флаге template. id журнала — уникальный ключ улики во всём модуле (originId).
 * Журнал читаем всем (OBSERVER): клиент игрока сам копирует шаблон при находке.
 */

const TEMPLATE_FLAG = "template";

export function defaultDetection() {
  return {
    zoneMode: "background",
    radius: 5,
    check: "inv",
    dc: "15",
    rollMode: "publicroll",
    maxAttempts: 1
  };
}

export function defaultVisual() {
  return {
    kind: "photo",
    image: "",
    audioPath: "",
    videoPath: "",
    audioEffectEnabled: true,
    text: "",
    textColor: INK_COLORS.black,
    tint: STICKY_TINTS.white,
    font: DEFAULT_FONT,
    fontSize: 16
  };
}

/**
 * Приводит данные обнаружения к ожидаемому виду (лишние поля отбрасываются).
 * @param {object} detection
 */
export function normalizeDetection(detection = {}) {
  const defaults = defaultDetection();
  let zoneMode = defaults.zoneMode;
  if (ZONE_MODES.includes(detection.zoneMode)) zoneMode = detection.zoneMode;
  let rollMode = defaults.rollMode;
  if (ROLL_MODES.includes(detection.rollMode)) rollMode = detection.rollMode;
  let radius = Number(detection.radius);
  if (!Number.isFinite(radius) || radius < 0) radius = defaults.radius;
  let maxAttempts = Number.parseInt(detection.maxAttempts, 10);
  if (!Number.isFinite(maxAttempts) || maxAttempts < 0) maxAttempts = defaults.maxAttempts;
  return {
    zoneMode,
    radius,
    check: String(detection.check ?? defaults.check).trim(),
    dc: String(detection.dc ?? defaults.dc).trim(),
    rollMode,
    maxAttempts
  };
}

/** @param {object} visual */
export function normalizeVisual(visual = {}) {
  const defaults = defaultVisual();
  let kind = defaults.kind;
  if (CLUE_KINDS.includes(visual.kind)) kind = visual.kind;
  let fontSize = Number.parseInt(visual.fontSize, 10);
  if (!Number.isFinite(fontSize) || fontSize < 6) fontSize = defaults.fontSize;
  let audioEffectEnabled = defaults.audioEffectEnabled;
  if (visual.audioEffectEnabled !== undefined) audioEffectEnabled = Boolean(visual.audioEffectEnabled);
  return {
    kind,
    image: String(visual.image ?? ""),
    audioPath: String(visual.audioPath ?? ""),
    videoPath: String(visual.videoPath ?? ""),
    audioEffectEnabled,
    text: String(visual.text ?? ""),
    textColor: String(visual.textColor || defaults.textColor),
    tint: String(visual.tint || defaults.tint),
    font: String(visual.font || defaults.font),
    fontSize
  };
}

/** Теги из строки «a, b, c» или массива. */
export function normalizeTags(tags) {
  let tagList = tags;
  if (typeof tagList === "string") tagList = tagList.split(",");
  if (!Array.isArray(tagList)) return [];
  const cleanTags = tagList.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0);
  return [...new Set(cleanTags)];
}

/** Содержимое вкладки «Сводка» в нормальном виде. */
export function normalizeSummary(summary = {}) {
  return {
    name: String(summary.name ?? "").trim() || localize("Clue.Unnamed"),
    img: String(summary.img || `${BOARD_ASSET_PATH}/placeholder.webp`),
    typeId: String(summary.typeId ?? ""),
    description: String(summary.description ?? ""),
    tags: normalizeTags(summary.tags)
  };
}

/**
 * @param {JournalEntry} journalEntry
 * @returns {boolean}
 */
export function isClueTemplateEntry(journalEntry) {
  return Boolean(journalEntry?.flags?.[MODULE_ID]?.[TEMPLATE_FLAG]);
}

/**
 * Читает шаблон из журнала в нормальном виде.
 * @param {JournalEntry} journalEntry
 */
function readTemplate(journalEntry) {
  const stored = journalEntry.flags[MODULE_ID][TEMPLATE_FLAG];
  const summary = normalizeSummary({ ...stored, name: journalEntry.name });
  return {
    id: journalEntry.id,
    ...summary,
    detection: normalizeDetection(stored.detection),
    visual: normalizeVisual(stored.visual)
  };
}

/**
 * @param {string} templateId
 * @returns {ReturnType<readTemplate>|null}
 */
export function getClueTemplate(templateId) {
  const journalEntry = game.journal.get(templateId);
  if (!isClueTemplateEntry(journalEntry)) return null;
  return readTemplate(journalEntry);
}

/** Все шаблоны, по названию. */
export function listClueTemplates() {
  return game.journal
    .filter((journalEntry) => isClueTemplateEntry(journalEntry))
    .map((journalEntry) => readTemplate(journalEntry))
    .sort((first, second) => first.name.localeCompare(second.name, game.i18n.lang));
}

/**
 * Данные для записи во флаг.
 * @param {object} templateData
 */
function buildTemplateFlag(templateData) {
  const summary = normalizeSummary(templateData);
  return {
    name: summary.name,
    flag: {
      img: summary.img,
      typeId: summary.typeId,
      description: summary.description,
      tags: summary.tags,
      detection: normalizeDetection(templateData.detection),
      visual: normalizeVisual(templateData.visual)
    }
  };
}

/**
 * Создать шаблон (только ГМ).
 * @param {object} templateData
 * @param {object} [options]
 * @param {string} [options.id] - сохранить заданный id (импорт)
 * @returns {Promise<string>} id шаблона
 */
export async function createClueTemplate(templateData, { id } = {}) {
  const folder = await ensureModuleFolder(FOLDER_KEYS.clues);
  const { name, flag } = buildTemplateFlag(templateData);
  const createData = {
    name,
    folder: folder?.id ?? null,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { [TEMPLATE_FLAG]: flag } }
  };
  let createOptions = {};
  if (id) {
    createData._id = id;
    createOptions = { keepId: true };
  }
  const journalEntry = await JournalEntry.create(createData, createOptions);
  return journalEntry.id;
}

/**
 * Изменить шаблон (только ГМ). Уже выданные игрокам копии не меняются.
 * @param {string} templateId
 * @param {object} templateData
 */
export async function updateClueTemplate(templateId, templateData) {
  const journalEntry = game.journal.get(templateId);
  if (!journalEntry) return;
  const { name, flag } = buildTemplateFlag(templateData);
  await journalEntry.update({ name, [`flags.${MODULE_ID}.${TEMPLATE_FLAG}`]: flag });
}

/** @param {string} templateId */
export async function deleteClueTemplate(templateId) {
  const journalEntry = game.journal.get(templateId);
  if (journalEntry) await journalEntry.delete();
}

/**
 * Снимок шаблона для личной копии игрока: «Сводка» и «Визуализация», без настроек обнаружения.
 * @param {ReturnType<readTemplate>} template
 */
export function buildPlayerContent(template) {
  return {
    name: template.name,
    img: template.img,
    typeId: template.typeId,
    description: template.description,
    tags: [...template.tags],
    visual: { ...template.visual }
  };
}

/** Данные шаблонов для экспорта. */
export function exportClueTemplates() {
  return listClueTemplates().map((template) => foundry.utils.deepClone(template));
}
