import { MODULE_ID, FONTS } from "../constants.js";
import { localize } from "../i18n.js";
import { isResponsibleGameMaster } from "../permissions.js";
import { BoardState } from "./board-state.js";
import { isBoardScene, isBoardCard, getCardData, setBoardScene } from "./board-scenes.js";
import { registerBoardSettings } from "./board-settings.js";
import { CardDrawing } from "./card-drawing.js";
import { updateCard } from "./board-relay.js";
import {
  updatePins,
  updatePinForCard,
  redrawAllThreads,
  redrawThreadsForCard,
  removeThreadsForCard,
  cleanupBoardGraphics,
  cleanupThreadsToDeletedCard,
  resetConnectionState,
  clearDragPreview
} from "./threads.js";
import { openCardSheet } from "./card-sheet.js";

/**
 * Доска улик: движок прототипа (карточки-Drawing, булавки, нити) на сценах с флагом доски.
 * Режим доски включается, когда на сцене-доске активен слой рисунков.
 */

function refreshAllCards() {
  if (!canvas?.ready || !canvas.drawings) return;
  for (const cardObject of canvas.drawings.placeables) {
    if (isBoardCard(cardObject.document)) cardObject.refreshCard();
  }
}

function setCardsInteractive(interactive) {
  if (!canvas.drawings) return;
  for (const cardObject of canvas.drawings.placeables) {
    if (!isBoardCard(cardObject.document)) continue;
    if (interactive) {
      cardObject.eventMode = "static";
      cardObject.cursor = "pointer";
    } else {
      cardObject.eventMode = "auto";
      cardObject.cursor = null;
    }
    cardObject.interactiveChildren = true;
  }
}

function activateBoardMode() {
  if (BoardState.active) return;
  BoardState.active = true;
  setCardsInteractive(true);
  document.body.classList.add("detective-story-board-mode");
}

function deactivateBoardMode() {
  if (!BoardState.active) return;
  BoardState.active = false;
  resetConnectionState();
  setCardsInteractive(false);
  document.body.classList.remove("detective-story-board-mode");
}

export function registerBoardInit() {
  registerBoardSettings(refreshAllCards);
  CONFIG.Drawing.objectClass = CardDrawing;
}

/** Предзагрузка шрифтов, чтобы PIXI-текст сразу рисовался нужным шрифтом. */
export async function preloadBoardFonts() {
  const sample = "Улика Clue 123";
  await Promise.all(FONTS.map((font) => document.fonts.load(`16px "${font.family}"`, sample).catch(() => null)));
}

export function registerBoardHooks() {
  Hooks.on("activateCanvasLayer", (layer) => {
    if (layer === canvas.drawings && isBoardScene(canvas.scene)) {
      activateBoardMode();
    } else {
      deactivateBoardMode();
    }
  });

  let leavingBoard = false;
  Hooks.on("canvasTearDown", () => {
    leavingBoard = BoardState.active;
    deactivateBoardMode();
    cleanupBoardGraphics();
  });

  Hooks.on("canvasReady", () => {
    if (isBoardScene(canvas.scene)) {
      canvas.drawings.activate();
      activateBoardMode();
    } else if (leavingBoard) {
      canvas.tokens.activate();
    }
    leavingBoard = false;
    window.setTimeout(() => {
      updatePins();
      redrawAllThreads();
    }, 100);
  });

  Hooks.on("preCreateDrawing", (drawingDocument, data, options) => {
    if (!isBoardCard(drawingDocument)) return;
    if (!options.detectiveStoryCreation) {
      drawingDocument.updateSource({ [`flags.${MODULE_ID}.connections`]: [] });
    }
  });

  Hooks.on("createDrawing", (drawingDocument, options, userId) => {
    if (!isBoardCard(drawingDocument)) return;
    const cardData = getCardData(drawingDocument);
    const requesterId = options.requestingUserId ?? userId;
    const isFreeCard = !cardData.originId && !cardData.suspectId && cardData.type !== "pin";
    window.setTimeout(() => {
      if (BoardState.active) setCardsInteractive(true);
      const cardObject = canvas.drawings?.get(drawingDocument.id);
      if (cardObject) updatePinForCard(cardObject);
      redrawThreadsForCard(drawingDocument.id);
      if (requesterId === game.user.id && isFreeCard) openCardSheet(drawingDocument);
    }, 250);
  });

  Hooks.on("preUpdateDrawing", (drawingDocument, changes, options, userId) => {
    if (userId !== game.user.id || !isBoardCard(drawingDocument)) return true;
    if (game.user.isGM || drawingDocument.isOwner || options.detectiveStoryRelayed) return true;
    updateCard(drawingDocument.id, changes);
    return false;
  });

  Hooks.on("updateDrawing", async (drawingDocument, changes) => {
    if (!isBoardCard(drawingDocument)) return;
    const cardObject = canvas.drawings?.get(drawingDocument.id);
    if (!cardObject) return;
    // Нити хранятся во флагах карточки: если изменились только они, раскладывать карточку заново не нужно.
    const changedFlags = changes.flags?.[MODULE_ID];
    let layoutChanged = Boolean(changes.shape);
    if (changedFlags) {
      layoutChanged ||= Object.keys(changedFlags).some((flagKey) => flagKey !== "connections" && flagKey !== "-=connections");
    }
    if (layoutChanged) {
      await cardObject.refreshCard();
      return;
    }
    const moved = changes.x !== undefined || changes.y !== undefined || changes.hidden !== undefined;
    if (moved) {
      clearDragPreview([drawingDocument.id]);
      updatePinForCard(cardObject);
    }
    if (moved || changedFlags) redrawThreadsForCard(drawingDocument.id);
  });

  Hooks.on("preDeleteDrawing", (drawingDocument) => {
    if (!isBoardCard(drawingDocument) || game.user.isGM) return true;
    ui.notifications.warn(localize("Board.OnlyGameMasterDeletes"));
    return false;
  });

  Hooks.on("deleteDrawing", (drawingDocument) => {
    if (!isBoardCard(drawingDocument)) return;
    removeThreadsForCard(drawingDocument.id);
    if (isResponsibleGameMaster() && drawingDocument.parent) {
      cleanupThreadsToDeletedCard(drawingDocument.parent, drawingDocument.id);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") resetConnectionState();
  });

  Hooks.on("getSceneContextOptions", (application, menuOptions) => {
    menuOptions.push({
      name: localize("Board.MarkAsBoard"),
      icon: '<i class="fa-solid fa-chalkboard"></i>',
      condition: (listItem) => game.user.isGM && !isBoardScene(resolveScene(listItem)),
      callback: (listItem) => setBoardScene(resolveScene(listItem), true)
    });
    menuOptions.push({
      name: localize("Board.UnmarkBoard"),
      icon: '<i class="fa-solid fa-chalkboard"></i>',
      condition: (listItem) => game.user.isGM && isBoardScene(resolveScene(listItem)),
      callback: (listItem) => setBoardScene(resolveScene(listItem), false)
    });
  });
}

/** Сцена из элемента списка сцен. @param {HTMLElement} listItem */
function resolveScene(listItem) {
  let element = listItem?.[0];
  if (listItem instanceof HTMLElement) element = listItem;
  const sceneId = element?.dataset?.entryId ?? element?.dataset?.sceneId ?? element?.closest?.("[data-entry-id]")?.dataset.entryId;
  return game.scenes.get(sceneId);
}
