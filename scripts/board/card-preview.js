import { MODULE_ID, TEMPLATE_PATH, BOARD_ASSET_PATH, DEFAULT_FONT, FONT_REPLACEMENTS } from "../constants.js";
import { fullKey } from "../i18n.js";
import { DetectiveApplication } from "../apps/base-application.js";
import { getCardData } from "./board-scenes.js";
import { applyTapeEffectToElement } from "./audio-utils.js";
import { playAudioForEveryone, stopAudioForEveryone, isGlobalAudioPlaying, playVideoForEveryone, stopVideoForEveryone, isGlobalVideoPlaying } from "./board-relay.js";
import { startVideo } from "./video-player.js";
import { canStampKind, getStampSize } from "./stamps.js";
import { getCardSize } from "./clue-cards.js";

/** Флаги, которые не меняют вид карточки в просмотре: нити и цвет булавки. */
const PREVIEW_IGNORED_FLAGS = ["connections", "-=connections", "pinColor"];

/**
 * Просмотр карточки крупно (двойной клик): фото, текст, раздаточный материал, кассета с плеером.
 */
export class CardPreview extends DetectiveApplication {
  /** @param {DrawingDocument} drawingDocument */
  constructor(drawingDocument, options = {}) {
    super({ ...options, id: CardPreview.buildId(drawingDocument) });
    this.drawingDocument = drawingDocument;
    this.tapeEffect = null;
  }

  static buildId(drawingDocument) {
    return `detective-story-card-preview-${drawingDocument.id}`;
  }

  static DEFAULT_OPTIONS = {
    classes: ["card-preview"],
    window: { icon: "fa-solid fa-magnifying-glass-plus", title: fullKey("CardPreview.Title"), resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      toggleGlobalAudio: CardPreview.#onToggleGlobalAudio,
      toggleGlobalVideo: CardPreview.#onToggleGlobalVideo
    }
  };

  static PARTS = {
    preview: { template: `${TEMPLATE_PATH}/board/card-preview.hbs`, scrollable: [""] }
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const cardData = getCardData(this.drawingDocument);
    let font = cardData.font || DEFAULT_FONT;
    if (FONT_REPLACEMENTS[font]) font = FONT_REPLACEMENTS[font];
    let backgroundImage = `${BOARD_ASSET_PATH}/note_white.webp`;
    if (cardData.type === "index") backgroundImage = `${BOARD_ASSET_PATH}/note_index.webp`;
    let image = cardData.image;
    if (!image && cardData.type === "photo") image = `${BOARD_ASSET_PATH}/placeholder.webp`;
    if (!image && cardData.type === "handout") image = `${BOARD_ASSET_PATH}/newhandout.webp`;
    return Object.assign(context, {
      card: cardData,
      image,
      font,
      frameImage: `${BOARD_ASSET_PATH}/photoFrame.webp`,
      backgroundImage: foundry.utils.getRoute(backgroundImage),
      isPhoto: cardData.type === "photo",
      isHandout: cardData.type === "handout",
      isMedia: cardData.type === "media",
      isVideo: cardData.type === "video",
      videoUrl: cardData.videoPath,
      vhsEffect: cardData.audioEffectEnabled !== false,
      globalVideoPlaying: isGlobalVideoPlaying(cardData.videoPath),
      isPaper: cardData.type === "sticky" || cardData.type === "index",
      isSticky: cardData.type === "sticky",
      isGameMaster: game.user.isGM,
      globalPlaying: isGlobalAudioPlaying(cardData.audioPath),
      stamp: await this.#prepareStamp(cardData)
    });
  }

  /**
   * Штамп в окне просмотра: то же место и размер в долях карточки, что и на доске.
   * Цвет даёт CSS-маска по белой картинке штампа.
   * @param {object} cardData
   */
  async #prepareStamp(cardData) {
    const stamp = cardData.stamp;
    if (!stamp?.image || !canStampKind(cardData.type)) return null;
    const texture = await foundry.canvas.loadTexture(stamp.image);
    if (!texture) return null;
    const cardSize = canvas.drawings?.get(this.drawingDocument.id)?.getCardSize() ?? getCardSize(cardData.type);
    const imageRatio = texture.width / texture.height;
    const stampSize = getStampSize(stamp.key, cardSize, imageRatio);
    return {
      imageUrl: foundry.utils.getRoute(stamp.image),
      color: stamp.color,
      left: Number(stamp.x) * 100,
      top: Number(stamp.y) * 100,
      width: (stampSize.width / cardSize.width) * 100,
      imageRatio,
      rotation: Number(stamp.rotation) || 0
    };
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.subscribe("updateDrawing", (drawingDocument, changes) => {
      if (drawingDocument.id !== this.drawingDocument.id) return;
      const changedFlags = Object.keys(changes.flags?.[MODULE_ID] ?? {});
      const contentChanged = changedFlags.some((flagKey) => !PREVIEW_IGNORED_FLAGS.includes(flagKey));
      if (contentChanged) this.render();
    });
    this.subscribe("deleteDrawing", (drawingDocument) => {
      if (drawingDocument.id === this.drawingDocument.id) this.close();
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const videoElement = this.element.querySelector(".vhs-screen video");
    if (videoElement) {
      this.tapeEffect?.disconnect();
      this.tapeEffect = null;
      if (getCardData(this.drawingDocument).audioEffectEnabled !== false) this.tapeEffect = applyTapeEffectToElement(videoElement);
      if (options.autoplay) startVideo(videoElement);
      return;
    }
    const audioElement = this.element.querySelector("audio");
    const cassetteElement = this.element.querySelector(".cassette");
    if (!audioElement || !cassetteElement) return;
    this.tapeEffect?.disconnect();
    this.tapeEffect = null;
    if (getCardData(this.drawingDocument).audioEffectEnabled !== false) {
      this.tapeEffect = applyTapeEffectToElement(audioElement);
    }
    audioElement.addEventListener("play", () => cassetteElement.classList.add("playing"));
    audioElement.addEventListener("pause", () => cassetteElement.classList.remove("playing"));
    audioElement.addEventListener("ended", () => cassetteElement.classList.remove("playing"));
    if (options.autoplay) audioElement.play().catch(() => null);
  }

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    this.tapeEffect?.disconnect();
    this.tapeEffect = null;
  }

  /** Показать видео всем с того места, где оно сейчас у ГМ, или остановить общий показ. */
  static async #onToggleGlobalVideo() {
    const cardData = getCardData(this.drawingDocument);
    if (!cardData.videoPath) return;
    if (isGlobalVideoPlaying(cardData.videoPath)) {
      await stopVideoForEveryone(cardData.videoPath);
    } else {
      const videoElement = this.element.querySelector(".vhs-screen video");
      let offset = 0;
      if (videoElement) {
        offset = videoElement.currentTime;
        videoElement.pause();
      }
      await playVideoForEveryone({ videoPath: cardData.videoPath, title: cardData.text, applyEffect: cardData.audioEffectEnabled !== false, offset });
    }
    this.render();
  }

  static async #onToggleGlobalAudio() {
    const cardData = getCardData(this.drawingDocument);
    if (!cardData.audioPath) return;
    if (isGlobalAudioPlaying(cardData.audioPath)) {
      await stopAudioForEveryone(cardData.audioPath);
    } else {
      const audioElement = this.element.querySelector("audio");
      let offset = 0;
      if (audioElement && !audioElement.paused) {
        offset = audioElement.currentTime;
        audioElement.pause();
      }
      await playAudioForEveryone(cardData.audioPath, cardData.audioEffectEnabled !== false, offset);
    }
    this.render();
  }
}

/**
 * @param {DrawingDocument} drawingDocument
 * @param {{autoplay?: boolean}} [renderOptions]
 */
export function openCardPreview(drawingDocument, { autoplay = false } = {}) {
  const applicationId = CardPreview.buildId(drawingDocument);
  const existingApplication = foundry.applications.instances.get(applicationId);
  if (existingApplication) {
    existingApplication.render({ force: true, autoplay });
    existingApplication.bringToFront();
    return existingApplication;
  }
  const application = new CardPreview(drawingDocument);
  application.render({ force: true, autoplay });
  return application;
}

