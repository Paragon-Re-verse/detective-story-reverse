import { TEMPLATE_PATH } from "../constants.js";
import { localize } from "../i18n.js";
import { listSuspects } from "../data/suspects.js";
import { listPlayerClues } from "../data/player-clues.js";
import { listClueTemplates } from "../data/clue-templates.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Окна выбора для доски: подозреваемый для фотокарточки и улика для карточки.
 * Отдельный файл: их зовут и панель кнопок, и меню нитей, а те друг от друга не зависят.
 */

/**
 * Выбор одного варианта радиокнопками.
 * @param {{title: string, icon: string, confirmLabel: string, entries: {id: string, name: string, img: string}[]}} options
 * @returns {Promise<string|null>} id выбранного
 */
async function pickOne({ title, icon, confirmLabel, entries }) {
  const content = await renderTemplate(`${TEMPLATE_PATH}/board/entry-picker.hbs`, { entries });
  const chosenId = await DialogV2.wait({
    window: { title, icon },
    classes: ["detective-story", "entry-picker"],
    content,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        icon: "fa-solid fa-check",
        default: true,
        callback: (event, button) => button.form.querySelector("input[name='entryId']:checked")?.value ?? null
      },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (typeof chosenId !== "string") return null;
  return chosenId;
}

/** Подозреваемый для фотокарточки. @returns {Promise<object|null>} */
export async function chooseSuspect() {
  const suspects = listSuspects();
  if (!suspects.length) {
    ui.notifications.info(localize("Board.NoSuspects"));
    return null;
  }
  const suspectId = await pickOne({
    title: localize("Controls.SuspectCard"),
    icon: "fa-solid fa-camera-retro",
    confirmLabel: localize("Board.PlaceSuspect"),
    entries: suspects.map((suspect) => ({ id: suspect.id, name: suspect.name, img: suspect.portrait }))
  });
  return suspects.find((suspect) => suspect.id === suspectId) ?? null;
}

/**
 * Улика для карточки: игрок выбирает из своего списка, ГМ (у него своих улик нет) — из шаблонов.
 * @returns {Promise<object|null>} запись улики (или шаблон) с полями name, img, description, visual
 */
export async function chooseClueForBoard() {
  let clues = listPlayerClues(game.user).map((playerClue) => ({ ...playerClue, id: playerClue.originId }));
  if (game.user.isGM) clues = listClueTemplates().map((template) => ({ ...template, originId: template.id }));
  if (!clues.length) {
    ui.notifications.info(localize("ClueList.Empty"));
    return null;
  }
  const clueId = await pickOne({
    title: localize("Board.PickClueTitle"),
    icon: "fa-solid fa-magnifying-glass",
    confirmLabel: localize("Board.PlaceSuspect"),
    entries: clues.map((clue) => ({ id: clue.id, name: clue.name, img: clue.img }))
  });
  return clues.find((clue) => clue.id === clueId) ?? null;
}
