import { MODULE_ID, TEMPLATE_PATH, THREAD_COLORS, DEFAULT_FONT, FONT_REPLACEMENTS } from "../constants.js";
import { localize, fullKey } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "../apps/base-application.js";
import { getFontChoices, getInkSwatches, getTintSwatches } from "../apps/view-helpers.js";
import { getCardData } from "./board-scenes.js";
import { updateCard } from "./board-relay.js";
import { startThreadAnimation, stopThreadAnimation, removeThread } from "./threads.js";

/**
 * Правка карточки доски: текст, цвета, шрифт, изображение или аудио, нити из этой карточки.
 * Открывают ГМ и автор карточки.
 */
export class CardSheet extends DetectiveApplication {
  /** @param {DrawingDocument} drawingDocument */
  constructor(drawingDocument, options = {}) {
    super({ ...options, id: CardSheet.buildId(drawingDocument) });
    this.drawingDocument = drawingDocument;
  }

  static buildId(drawingDocument) {
    return `detective-story-card-sheet-${drawingDocument.id}`;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["card-sheet"],
    window: { icon: "fa-solid fa-note-sticky", title: fullKey("CardSheet.Title"), resizable: false, contentClasses: ["standard-form"] },
    position: { width: 420, height: "auto" },
    form: {
      handler: CardSheet.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      removeThread: CardSheet.#onRemoveThread
    }
  };

  static PARTS = {
    form: { template: `${TEMPLATE_PATH}/board/card-sheet.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const cardData = getCardData(this.drawingDocument);
    const cardType = cardData.type;
    let font = cardData.font || DEFAULT_FONT;
    if (FONT_REPLACEMENTS[font]) font = FONT_REPLACEMENTS[font];
    const threadColorChoices = {};
    for (const [colorKey, colorValue] of Object.entries(THREAD_COLORS)) {
      threadColorChoices[colorValue] = localize(`ThreadColors.${colorKey}`);
    }
    const connections = (cardData.connections ?? []).map((connection, index) => {
      const targetDocument = this.drawingDocument.parent?.drawings.get(connection.targetId);
      let targetLabel = localize("CardSheet.DeletedCard");
      if (targetDocument) {
        const targetData = getCardData(targetDocument);
        targetLabel = targetData.snapshot?.name || targetData.text || localize(`Kind.${targetData.type}`);
      }
      return { index, targetId: connection.targetId, targetLabel, color: connection.color };
    });
    return Object.assign(context, {
      card: { ...cardData, font },
      hasText: ["sticky", "photo", "index"].includes(cardType),
      hasTint: cardType === "sticky",
      hasImage: ["photo", "handout"].includes(cardType),
      hasAudio: cardType === "media",
      hasVideo: cardType === "video",
      hasTapeEffect: cardType === "media" || cardType === "video",
      fontChoices: getFontChoices(),
      inkSwatches: getInkSwatches(cardData.textColor),
      tintSwatches: getTintSwatches(cardData.tint),
      threadColorChoices,
      connections,
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: fullKey("Common.Save") }]
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    startThreadAnimation(this.drawingDocument.id);
    this.subscribe("updateDrawing", (drawingDocument, changes) => {
      if (drawingDocument.id === this.drawingDocument.id && changes.flags?.[MODULE_ID]?.connections) this.render();
    });
    this.subscribe("deleteDrawing", (drawingDocument) => {
      if (drawingDocument.id === this.drawingDocument.id) this.close();
    });
  }

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    stopThreadAnimation(this.drawingDocument.id);
  }

  /** @this {CardSheet} */
  static async #onSubmit(event, form, formData) {
    const submitted = foundry.utils.expandObject(formData.object);
    const cardData = getCardData(this.drawingDocument);
    const changes = {};
    const setFlag = (field, value) => {
      if (value === undefined) return;
      changes[`flags.${MODULE_ID}.${field}`] = value;
    };
    setFlag("text", submitted.text);
    setFlag("tint", submitted.tint);
    setFlag("textColor", submitted.textColor);
    setFlag("font", submitted.font);
    if (submitted.fontSize !== undefined) setFlag("fontSize", Number(submitted.fontSize) || 16);
    setFlag("image", submitted.image);
    setFlag("audioPath", submitted.audioPath);
    setFlag("videoPath", submitted.videoPath);
    if (cardData.type === "media" || cardData.type === "video") setFlag("audioEffectEnabled", Boolean(submitted.audioEffectEnabled));
    if (submitted.connections) {
      const updatedConnections = (cardData.connections ?? []).map((connection, index) => {
        const submittedColor = submitted.connections[index]?.color;
        return { ...connection, color: submittedColor || connection.color };
      });
      setFlag("connections", updatedConnections);
    }
    await updateCard(this.drawingDocument.id, changes);
  }

  static async #onRemoveThread(event, target) {
    const targetId = target.closest("[data-target-id]").dataset.targetId;
    await removeThread(this.drawingDocument.id, targetId);
  }
}

/** @param {DrawingDocument} drawingDocument */
export function openCardSheet(drawingDocument) {
  return openSingleton(CardSheet.buildId(drawingDocument), () => new CardSheet(drawingDocument));
}
