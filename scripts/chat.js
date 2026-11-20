import { TEMPLATE_PATH } from "./constants.js";
import { getClueType } from "./data/clue-types.js";
import { enrichText } from "./apps/view-helpers.js";
import { logEvent, LOG_EVENTS } from "./data/event-log.js";
import { getClueLevels, getLevelLabel } from "./data/clue-levels.js";

const { renderTemplate } = foundry.applications.handlebars;

/** id всех ГМ (включая не в сети: сообщение увидят при входе). */
function getGameMasterIds() {
  return game.users.filter((user) => user.isGM).map((user) => user.id);
}

/** Оформление скрытых сообщений ГМ: иконка и цвет полосы по смыслу события. */
export const GM_NOTE_TONES = {
  found: { tone: "found", icon: "fa-solid fa-magnifying-glass" },
  accepted: { tone: "accepted", icon: "fa-solid fa-handshake" },
  declined: { tone: "declined", icon: "fa-solid fa-hand" }
};

/**
 * Скрытое сообщение всем ГМ.
 * @param {string} htmlContent - уже экранированный HTML
 * @param {{tone: string, icon: string}} noteStyle - один из GM_NOTE_TONES
 */
export async function whisperGameMasters(htmlContent, noteStyle) {
  const gameMasterIds = getGameMasterIds();
  if (!gameMasterIds.length) return;
  await ChatMessage.create({
    content: `<div class="detective-story-chat gm-note tone-${noteStyle.tone}"><i class="${noteStyle.icon}" inert></i><div class="gm-note-text">${htmlContent}</div></div>`,
    whisper: gameMasterIds,
    speaker: ChatMessage.getSpeaker({ user: game.user })
  });
}

/**
 * Общее сообщение «Показать в чате»: иконка, название, тип, описание и все открытые уровни (п. 9). Без личных заметок.
 * @param {{name: string, img: string, typeId: string, description: string}} clue
 */
export async function postClueToChat(clue) {
  const clueType = getClueType(clue.typeId);
  const enrichedDescription = await enrichText(clue.description);
  const levels = [];
  for (const level of getClueLevels(clue)) {
    if (level.number > 1 && level.open) levels.push({ label: getLevelLabel(level.number), html: await enrichText(level.text) });
  }
  const content = await renderTemplate(`${TEMPLATE_PATH}/partials/chat-clue.hbs`, {
    clue,
    clueType,
    enrichedDescription,
    levels
  });
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ user: game.user })
  });
  await logEvent(LOG_EVENTS.shownInChat, { clue: clue.name });
}

/** Экранирование пользовательского текста для сообщений. */
export function escapeText(text) {
  return foundry.utils.escapeHTML(String(text ?? ""));
}
