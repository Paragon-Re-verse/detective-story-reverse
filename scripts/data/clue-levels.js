import { MODULE_ID } from "../constants.js";
import { format } from "../i18n.js";
import { getPlayerClue, getPlayerClues } from "./player-clues.js";
import { getClueTemplate } from "./clue-templates.js";
import { logEvent, LOG_EVENTS } from "./event-log.js";

/**
 * Уровни улики. Уровень 1 — описание улики, он открыт сразу. Уровни 2–6 — дополнительные тексты со своей
 * проверкой и сложностью; шаблон хранит их в поле levels (до 5 записей).
 *
 * У игрока в записи улики:
 *  - openLevels — объект «номер уровня → true», по ключу (ГМ открывает и закрывает любой уровень);
 *  - levelsSnapshot — снимок уровней на момент получения: нужен, если шаблон удалят;
 *  - customLevels — ГМ правил уровни этой копии: тогда у игрока свои тексты, а не тексты шаблона (п. 4).
 */

export const MAX_CLUE_LEVELS = 6;
const SECTION_PATH = `flags.${MODULE_ID}.clues`;

/** Дополнительные уровни (2–6) в нормальном виде. */
export function normalizeLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return levels.slice(0, MAX_CLUE_LEVELS - 1).map((level) => ({
    text: String(level?.text ?? ""),
    check: String(level?.check ?? "inv").trim() || "inv",
    dc: String(level?.dc ?? "15").trim() || "15"
  }));
}

/** Дополнительные уровни копии игрока: свои (после правки ГМ), иначе из шаблона, иначе снимок. */
function readExtraLevels(playerClue) {
  if (playerClue.customLevels) return normalizeLevels(playerClue.levelsSnapshot);
  const template = getClueTemplate(playerClue.originId);
  if (template) return template.levels;
  return normalizeLevels(playerClue.levelsSnapshot);
}

/**
 * Все уровни улики игрока с отметкой «открыт».
 * @param {object} playerClue
 * @returns {{number: number, text: string, check: string, dc: string, open: boolean}[]}
 */
export function getClueLevels(playerClue) {
  const openLevels = playerClue.openLevels ?? {};
  const levels = [{ number: 1, text: playerClue.description ?? "", check: "", dc: "", open: true }];
  readExtraLevels(playerClue).forEach((level, index) => {
    const number = index + 2;
    levels.push({ ...level, number, open: Boolean(openLevels[number]) });
  });
  return levels;
}

/** «2/4»: открыто из всего. */
export function describeLevelProgress(playerClue) {
  const levels = getClueLevels(playerClue);
  return { open: levels.filter((level) => level.open).length, total: levels.length };
}

/** Следующий уровень, который игрок может изучить сам: наименьший закрытый (п. 3). */
export function getNextClosedLevel(playerClue) {
  return getClueLevels(playerClue).find((level) => !level.open) ?? null;
}

/**
 * Открыть или закрыть уровень у игрока. Открытие ставит улике метку «новая» (п. 8).
 * Игрок пишет только в свой User, ГМ — в любой.
 * @param {User} user
 * @param {string} originId
 * @param {number} levelNumber - 2…6
 * @param {boolean} open
 */
export async function setClueLevelOpen(user, originId, levelNumber, open) {
  const playerClue = getPlayerClue(user, originId);
  if (!playerClue || levelNumber < 2) return false;
  if (Boolean(playerClue.openLevels?.[levelNumber]) === open) return false;
  const update = {};
  if (open) {
    update[`${SECTION_PATH}.${originId}.openLevels.${levelNumber}`] = true;
    update[`${SECTION_PATH}.${originId}.isNew`] = true;
  } else {
    update[`${SECTION_PATH}.${originId}.openLevels.-=${levelNumber}`] = null;
  }
  await user.update(update);
  if (open) await logEvent(LOG_EVENTS.levelOpened, { clue: playerClue.name, level: levelNumber, player: user.name });
  return true;
}

/**
 * ГМ открывает (или закрывает) уровень сразу у нескольких игроков, у которых есть улика (п. 7в).
 * @returns {Promise<number>} у скольких игроков что-то изменилось
 */
export async function setClueLevelForUsers(userIds, originId, levelNumber, open) {
  let changedCount = 0;
  for (const userId of userIds) {
    const user = game.users.get(userId);
    if (user && await setClueLevelOpen(user, originId, levelNumber, open)) changedCount += 1;
  }
  return changedCount;
}

/** Игроки, у которых есть улика. @param {string} originId */
export function listClueHolders(originId) {
  return game.users.filter((user) => !user.isGM && Boolean(getPlayerClues(user)[originId]));
}

/**
 * Открытые уровни переходят вместе с уликой (п. 5): если улика у получателя уже есть,
 * открытые уровни объединяются.
 * @param {User} user
 * @param {string} originId
 * @param {Record<string, boolean>} openLevels
 */
export async function mergeOpenLevels(user, originId, openLevels) {
  const playerClue = getPlayerClue(user, originId);
  if (!playerClue) return;
  const update = {};
  for (const [levelNumber, isOpen] of Object.entries(openLevels ?? {})) {
    if (isOpen && !playerClue.openLevels?.[levelNumber]) update[`${SECTION_PATH}.${originId}.openLevels.${levelNumber}`] = true;
  }
  if (!foundry.utils.isEmpty(update)) await user.update(update);
}

/** Подпись проверки: навык или характеристика системы, иначе сама формула. */
export function describeCheck(checkKey) {
  const skillConfig = CONFIG.DND5E?.skills?.[checkKey];
  if (skillConfig) return game.i18n.localize(skillConfig.label);
  const abilityConfig = CONFIG.DND5E?.abilities?.[checkKey];
  if (abilityConfig) return game.i18n.localize(abilityConfig.label);
  return checkKey;
}

/** Подзаголовок уровня: «Уровень 2». */
export function getLevelLabel(levelNumber) {
  return format("Levels.LevelN", { number: levelNumber });
}
