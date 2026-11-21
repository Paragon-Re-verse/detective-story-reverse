import { localize } from "../i18n.js";
import { getCardData } from "./board-scenes.js";
import { userHasClue } from "../data/player-clues.js";
import { getClueTemplate } from "../data/clue-templates.js";
import { openClueView } from "../apps/clue-view.js";
import { openSuspectDossier } from "../apps/suspect-dossier.js";
import { openTemplateEditor } from "../apps/clue-editor.js";

/**
 * «Подробнее» на карточке доски: если у игрока есть улика с таким originId — открывается её карточка
 * со всеми открытыми уровнями; иначе уведомление. Карточка подозреваемого открывает досье.
 * ГМ (у него нет своих улик) получает редактор шаблона.
 * @param {DrawingDocument} drawingDocument
 */
export function openCardDetails(drawingDocument) {
  const cardData = getCardData(drawingDocument);
  if (cardData.suspectId) {
    openSuspectDossier(cardData.suspectId);
    return;
  }
  if (!cardData.originId) {
    ui.notifications.info(localize("Board.NoDetails"));
    return;
  }
  if (game.user.isGM) {
    if (getClueTemplate(cardData.originId)) {
      openTemplateEditor(cardData.originId);
    } else {
      ui.notifications.info(localize("Board.NoClue"));
    }
    return;
  }
  if (!userHasClue(game.user, cardData.originId)) {
    ui.notifications.info(localize("Board.NoClue"));
    return;
  }
  openClueView(game.user, cardData.originId);
}
