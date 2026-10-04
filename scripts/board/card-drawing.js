import { MODULE_ID, BOARD_ASSET_PATH, PIN_IMAGES, DEFAULT_FONT, FONT_REPLACEMENTS, VIDEO_CASSETTE_IMAGE, VIDEO_CASSETTE_RATIO } from "../constants.js";
import { localize } from "../i18n.js";
import { BoardState } from "./board-state.js";
import { getCardData } from "./board-scenes.js";
import { getEffectiveScale, getBoardSetting, BOARD_SETTING_KEYS } from "./board-settings.js";
import { deleteCard, playAudioForEveryone, stopAudioForEveryone, isGlobalAudioPlaying, playVideoForEveryone, stopVideoForEveryone, isGlobalVideoPlaying } from "./board-relay.js";
import { removeAllThreadsOfCard, showBoardContextMenu, updatePinForCard, redrawThreadsForCard, updateDragPreview, clearDragPreview } from "./threads.js";
import { canStampKind, listStamps, applyStamp, removeStamp, getStampSize, getStampColor } from "./stamps.js";

const Drawing = foundry.canvas.placeables.Drawing;

/**
 * Карточка доски на канвасе (движок прототипа): фон-бумага, фото, булавка, текст.
 * Перемещать и соединять может любой; удалять — только ГМ.
 */
export class CardDrawing extends Drawing {
  constructor(...args) {
    super(...args);
    this.backgroundSprite = null;
    this.backgroundShadow = null;
    this.pinSprite = null;
    this.noteText = null;
    this.photoSprite = null;
    this.photoMask = null;
    this.stampSprite = null;
  }

  get isCard() {
    return Boolean(getCardData(this.document).type);
  }

  /** @override */
  _canControl(user, event) {
    if (this.isCard) return true;
    return super._canControl(user, event);
  }

  /** @override */
  _canDrag(user, event) {
    if (this.isCard) return !this.document.locked;
    return super._canDrag(user, event);
  }

  /** @override */
  _canView(user, event) {
    if (this.isCard) return !this.document.hidden || user.isGM;
    return super._canView(user, event);
  }

  /** @override */
  _canConfigure(user, event) {
    if (this.isCard) return true;
    return super._canConfigure(user, event);
  }

  /** @override */
  _getTargetAlpha() {
    if (this.isCard && this.document.hidden && game.user.isGM) return 0.4;
    return super._getTargetAlpha();
  }

  /** Рамка и ручка размера — только у раздаточного материала (его можно растягивать). @override */
  _refreshFrame() {
    super._refreshFrame();
    const cardType = getCardData(this.document).type;
    if (!cardType || !this.frame) return;
    this.frame.visible = cardType === "handout";
  }

  /** @override */
  activateListeners() {
    super.activateListeners();
    if (this.isCard && this.mouseInteractionManager) {
      this.mouseInteractionManager.permissions.clickRight = () => true;
      this.mouseInteractionManager.permissions.clickRight2 = () => true;
      this.mouseInteractionManager.permissions.clickLeft2 = () => true;
    }
  }

  /** Нити тянутся за карточкой прямо во время перетаскивания. @override */
  _onDragLeftMove(event) {
    super._onDragLeftMove(event);
    if (this.isCard) updateDragPreview(event.interactionData.clones ?? []);
  }

  /**
   * После отпускания нити держатся у превью, пока не придёт обновление документа
   * (через ГМ это может занять мгновение); страховка — снять превью через 2 секунды.
   * @override
   */
  _onDragLeftDrop(event) {
    const draggedIds = (event.interactionData.clones ?? []).map((clone) => clone._original?.document.id).filter(Boolean);
    window.setTimeout(() => clearDragPreview(draggedIds), 2000);
    return super._onDragLeftDrop(event);
  }

  /** @override */
  _onDragLeftCancel(event) {
    clearDragPreview();
    return super._onDragLeftCancel(event);
  }

  /** Двойной клик — просмотр карточки. @override */
  _onClickLeft2(event) {
    const cardType = getCardData(this.document).type;
    if (cardType === "pin") return undefined;
    if (cardType) {
      import("./card-preview.js").then(({ openCardPreview }) => openCardPreview(this.document));
      return undefined;
    }
    return super._onClickLeft2(event);
  }

  /** @override */
  _onClickRight(event) {
    if (!BoardState.active || !this.isCard) return super._onClickRight(event);
    event.stopPropagation();
    this.#showCardMenu(event);
    return undefined;
  }

  /** @override */
  _onClickRight2(event) {
    if (!BoardState.active || !this.isCard) return super._onClickRight2(event);
    event.stopPropagation();
    return undefined;
  }

  /** Может ли пользователь править содержимое карточки: ГМ или автор. */
  canEditContent(user = game.user) {
    if (user.isGM) return true;
    const cardData = getCardData(this.document);
    return cardData.createdBy === user.id || this.document.author?.id === user.id;
  }

  #showCardMenu(event) {
    const cardData = getCardData(this.document);
    const originalEvent = event.data?.originalEvent ?? event.nativeEvent ?? event;
    const menuItems = [];

    if (cardData.type !== "pin") {
      menuItems.push({
        icon: "fa-solid fa-circle-info",
        label: localize("Board.Menu.Details"),
        callback: () => import("./card-details.js").then(({ openCardDetails }) => openCardDetails(this.document))
      });
      menuItems.push({
        icon: "fa-solid fa-magnifying-glass",
        label: localize("Board.Menu.View"),
        callback: () => import("./card-preview.js").then(({ openCardPreview }) => openCardPreview(this.document))
      });
    }

    if (cardData.type === "media" && cardData.audioPath) {
      menuItems.push({
        icon: "fa-solid fa-volume-high",
        label: localize("Board.Menu.PlayForMe"),
        callback: () => import("./card-preview.js").then(({ openCardPreview }) => openCardPreview(this.document, { autoplay: true }))
      });
      if (game.user.isGM) {
        if (isGlobalAudioPlaying(cardData.audioPath)) {
          menuItems.push({ icon: "fa-solid fa-stop", label: localize("Board.Menu.StopForAll"), callback: () => stopAudioForEveryone(cardData.audioPath) });
        } else {
          menuItems.push({
            icon: "fa-solid fa-tower-broadcast",
            label: localize("Board.Menu.PlayForAll"),
            callback: () => playAudioForEveryone(cardData.audioPath, cardData.audioEffectEnabled !== false, 0)
          });
        }
      }
    }

    if (cardData.type === "video" && cardData.videoPath) {
      menuItems.push({
        icon: "fa-solid fa-film",
        label: localize("Board.Menu.Watch"),
        callback: () => import("./card-preview.js").then(({ openCardPreview }) => openCardPreview(this.document, { autoplay: true }))
      });
      if (game.user.isGM) {
        if (isGlobalVideoPlaying(cardData.videoPath)) {
          menuItems.push({ icon: "fa-solid fa-stop", label: localize("Board.Menu.StopForAll"), callback: () => stopVideoForEveryone(cardData.videoPath) });
        } else {
          menuItems.push({
            icon: "fa-solid fa-tower-broadcast",
            label: localize("Board.Menu.ShowForAll"),
            callback: () => playVideoForEveryone({ videoPath: cardData.videoPath, title: cardData.text, applyEffect: cardData.audioEffectEnabled !== false, offset: 0 })
          });
        }
      }
    }

    if (this.canEditContent() && cardData.type !== "pin") {
      menuItems.push({ icon: "fa-solid fa-pen", label: localize("Board.Menu.Edit"), callback: () => import("./card-sheet.js").then(({ openCardSheet }) => openCardSheet(this.document)) });
    }

    // Штамп ставят все — и игроки, и ГМ: туда, где щёлкнули правой кнопкой.
    if (canStampKind(cardData.type)) {
      const localPoint = event.getLocalPosition(this);
      menuItems.push({
        icon: "fa-solid fa-stamp",
        label: localize("Stamps.Menu"),
        callback: () => this.#showStampMenu(originalEvent.clientX, originalEvent.clientY, localPoint)
      });
    }

    if (game.user.isGM) {
      let visibilityLabel = localize("Board.Menu.Hide");
      let visibilityIcon = "fa-solid fa-eye-slash";
      if (this.document.hidden) {
        visibilityLabel = localize("Board.Menu.Reveal");
        visibilityIcon = "fa-solid fa-eye";
      }
      menuItems.push({ icon: visibilityIcon, label: visibilityLabel, callback: () => this.document.update({ hidden: !this.document.hidden }) });
    }

    menuItems.push({
      icon: "fa-solid fa-scissors",
      label: localize("Board.Menu.RemoveThreads"),
      callback: async () => {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: localize("Board.Menu.RemoveThreads") },
          content: `<p>${localize("Board.RemoveThreadsConfirm")}</p>`,
          rejectClose: false
        });
        if (confirmed) await removeAllThreadsOfCard(this.document.id);
      }
    });

    if (game.user.isGM) {
      menuItems.push({
        icon: "fa-solid fa-trash",
        label: localize("Board.Menu.Delete"),
        callback: async () => {
          const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: localize("Board.Menu.Delete") },
            content: `<p>${localize("Board.DeleteConfirm")}</p>`,
            rejectClose: false
          });
          if (confirmed) await deleteCard(this.document.id);
        }
      });
    }

    showBoardContextMenu(originalEvent.clientX, originalEvent.clientY, menuItems);
  }

  /**
   * Подменю штампов: картинки из папки штампов (с превью в цвете наложения) и «Убрать штамп».
   * @param {number} screenX
   * @param {number} screenY
   * @param {{x: number, y: number}} localPoint - точка карточки под курсором
   */
  #showStampMenu(screenX, screenY, localPoint) {
    const cardSize = this.getCardSize();
    const menuItems = listStamps().map((stamp) => ({
      icon: "fa-solid fa-stamp",
      label: stamp.label,
      maskImage: stamp.image,
      maskColor: getStampColor(stamp.key),
      callback: () => applyStamp(this.document, stamp, localPoint, cardSize)
    }));
    if (getCardData(this.document).stamp) {
      menuItems.push({ icon: "fa-solid fa-eraser", label: localize("Stamps.Remove"), callback: () => removeStamp(this.document) });
    }
    showBoardContextMenu(screenX, screenY, menuItems);
  }

  /** @override */
  async _draw(options) {
    await super._draw(options);
    await this.#applyCardLayout();
    updatePinForCard(this);
  }

  /** Булавка живёт в общем контейнере доски, поэтому уничтожается вместе с карточкой явно. @override */
  _destroy(options) {
    if (this.pinSprite && !this.pinSprite.destroyed && this.pinSprite.parent !== this) {
      this.pinSprite.parent?.removeChild(this.pinSprite);
      this.pinSprite.destroy();
    }
    this.pinSprite = null;
    super._destroy(options);
  }

  /** Перерисовать спрайты после изменения флагов карточки. */
  async refreshCard() {
    await this.#applyCardLayout();
    updatePinForCard(this);
    redrawThreadsForCard(this.document.id);
  }

  async #applyCardLayout() {
    if (!this.isCard) {
      this.scale.set(1, 1);
      return;
    }
    this.scale.set(getEffectiveScale());
    if (this.layoutRunning) {
      this.layoutQueued = true;
      return;
    }
    this.layoutRunning = true;
    try {
      await this.#updateSprites();
      await this.#updateStamp();
    } finally {
      this.layoutRunning = false;
      if (this.layoutQueued) {
        this.layoutQueued = false;
        this.#applyCardLayout();
      }
    }
  }

  /** Ширина карточки без масштаба (для булавки и центра). */
  getCardWidth() {
    const cardType = getCardData(this.document).type;
    if (cardType === "photo") return getBoardSetting(BOARD_SETTING_KEYS.photoWidth) || 225;
    if (cardType === "index") return getBoardSetting(BOARD_SETTING_KEYS.indexWidth) || 600;
    if (cardType === "sticky") return getBoardSetting(BOARD_SETTING_KEYS.stickyWidth) || 200;
    return this.document.shape.width || 400;
  }

  /** Размер карточки без масштаба доски (для штампа и превью). @returns {{width: number, height: number}} */
  getCardSize() {
    const cardType = getCardData(this.document).type;
    const width = this.getCardWidth();
    if (cardType === "photo") return { width, height: Math.round(width / (225 / 290)) };
    if (cardType === "index") return { width, height: Math.round(width / (600 / 400)) };
    if (cardType === "sticky") return { width, height: width };
    if (cardType === "media") return { width, height: this.document.shape.height || Math.round(width * 0.74) };
    if (cardType === "video") return { width, height: this.document.shape.height || Math.round(width / VIDEO_CASSETTE_RATIO) };
    return { width, height: this.document.shape.height || 400 };
  }

  /** Штамп поверх содержимого карточки: белая картинка в цвете наложения, с наклоном. */
  async #updateStamp() {
    const cardData = getCardData(this.document);
    const stamp = cardData.stamp;
    if (!stamp?.image || !canStampKind(cardData.type)) {
      this.#destroyChild("stampSprite");
      return;
    }
    const texture = await foundry.canvas.loadTexture(stamp.image);
    if (!texture) {
      this.#destroyChild("stampSprite");
      return;
    }
    if (!this.stampSprite || this.stampSprite.destroyed) {
      this.stampSprite = new PIXI.Sprite();
      this.stampSprite.anchor.set(0.5);
      this.stampSprite.eventMode = "none";
    }
    // Каждый раз наверх: фото и текст карточки могли пересоздаться поверх штампа.
    this.addChild(this.stampSprite);
    const cardSize = this.getCardSize();
    const stampSize = getStampSize(stamp.key, cardSize, texture.width / texture.height);
    this.stampSprite.texture = texture;
    this.stampSprite.width = stampSize.width;
    this.stampSprite.height = stampSize.height;
    this.stampSprite.position.set(Number(stamp.x) * cardSize.width, Number(stamp.y) * cardSize.height);
    this.stampSprite.angle = Number(stamp.rotation) || 0;
    this.stampSprite.alpha = 0.88;
    try {
      this.stampSprite.tint = stamp.color || "#b3261e";
    } catch {
      this.stampSprite.tint = 0xb3261e;
    }
  }

  /** Точка булавки в мировых координатах (сюда крепятся нити). */
  _getPinPosition() {
    const cardType = getCardData(this.document).type;
    const sceneScale = getEffectiveScale();
    const width = this.getCardWidth() * sceneScale;
    if (cardType === "pin") {
      const height = (this.document.shape.height || 40) * sceneScale;
      return { x: this.document.x + width / 2, y: this.document.y + height / 2 };
    }
    if (cardType === "handout") {
      const height = (this.document.shape.height || 400) * sceneScale;
      return { x: this.document.x + width / 2, y: this.document.y + height * 0.05 + 20 * sceneScale };
    }
    return { x: this.document.x + width / 2, y: this.document.y + 23 * sceneScale };
  }

  /** Цвет булавки: сохранённый на карточке или из настройки (случайный пишется один раз). */
  async #resolvePinImage() {
    const pinSetting = getBoardSetting(BOARD_SETTING_KEYS.pinColor);
    const cardData = getCardData(this.document);
    if (pinSetting === "none" && cardData.type !== "pin") return null;
    let pinImage = cardData.pinColor;
    if (!pinImage) {
      if (pinSetting === "random") {
        pinImage = PIN_IMAGES[Math.floor(Math.random() * PIN_IMAGES.length)];
      } else if (pinSetting === "none") {
        pinImage = "redPin.webp";
      } else {
        pinImage = `${pinSetting}Pin.webp`;
      }
      if (this.document.isOwner) this.document.update({ [`flags.${MODULE_ID}.pinColor`]: pinImage });
    }
    return `${BOARD_ASSET_PATH}/${pinImage}`;
  }

  #destroyChild(propertyName) {
    const child = this[propertyName];
    if (!child) return;
    child.parent?.removeChild(child);
    if (!child.destroyed) child.destroy();
    this[propertyName] = null;
  }

  async #updatePin(width, pinY) {
    const pinImage = await this.#resolvePinImage();
    if (!pinImage) {
      this.#destroyChild("pinSprite");
      return;
    }
    if (!this.pinSprite || this.pinSprite.destroyed) {
      this.pinSprite = new PIXI.Sprite();
      this.addChild(this.pinSprite);
    }
    const texture = await foundry.canvas.loadTexture(pinImage);
    if (!texture || this.pinSprite.destroyed) return;
    this.pinSprite.texture = texture;
    this.pinSprite.width = 40;
    this.pinSprite.height = 40;
    this.pinSprite.position.set(width / 2 - 20, pinY);
  }

  #ensureShadow(texture, width, height, blur) {
    if (!this.backgroundShadow || this.backgroundShadow.destroyed) {
      this.backgroundShadow = new PIXI.Sprite();
      this.addChildAt(this.backgroundShadow, 0);
    }
    this.backgroundShadow.texture = texture;
    this.backgroundShadow.width = width;
    this.backgroundShadow.height = height;
    this.backgroundShadow.tint = 0x000000;
    this.backgroundShadow.alpha = 0.4;
    this.backgroundShadow.position.set(6, 6);
    this.backgroundShadow.filters = [new PIXI.BlurFilter(blur)];
  }

  async #updateSprites() {
    const cardData = getCardData(this.document);
    if (cardData.type === "media" || cardData.type === "video") return this.#layoutMedia(cardData);
    if (cardData.type === "pin") return this.#layoutPin();
    if (cardData.type === "handout") return this.#layoutHandout(cardData);
    return this.#layoutPaper(cardData);
  }

  async #layoutMedia(cardData) {
    const width = this.document.shape.width || 400;
    const isVideo = cardData.type === "video";
    let height = this.document.shape.height || Math.round(width * 0.74);
    let fallbackImage = `${BOARD_ASSET_PATH}/cassette1.webp`;
    if (isVideo) {
      height = this.document.shape.height || Math.round(width / VIDEO_CASSETTE_RATIO);
      fallbackImage = VIDEO_CASSETTE_IMAGE;
    }
    this.#destroyChild("backgroundSprite");
    this.#destroyChild("noteText");
    if (this.photoMask) this.photoMask.visible = false;
    if (!this.photoSprite || this.photoSprite.destroyed) {
      this.photoSprite = new PIXI.Sprite();
      this.addChild(this.photoSprite);
    }
    const texture = await foundry.canvas.loadTexture(cardData.image || fallbackImage, { fallback: fallbackImage });
    if (texture && !this.photoSprite.destroyed) {
      this.#ensureShadow(texture, width, height, 2);
      this.photoSprite.texture = texture;
      this.photoSprite.width = width;
      this.photoSprite.height = height;
      this.photoSprite.mask = null;
      this.photoSprite.visible = true;
    }
    if (isVideo) this.#layoutVideoLabel(cardData, width, height);
    await this.#updatePin(width, 3);
  }

  /**
   * Название видео — от руки на этикетке посередине кассеты (этикетка занимает 29–71 % ширины и 31–76 % высоты картинки).
   * @param {object} cardData
   * @param {number} width
   * @param {number} height
   */
  #layoutVideoLabel(cardData, width, height) {
    const labelText = String(cardData.text ?? "").trim();
    if (!labelText) return;
    let fontFamily = cardData.font || DEFAULT_FONT;
    if (FONT_REPLACEMENTS[fontFamily]) fontFamily = FONT_REPLACEMENTS[fontFamily];
    const labelWidth = width * 0.4;
    const textStyle = new PIXI.TextStyle({
      fontFamily,
      fontSize: Math.round(height * 0.12),
      fill: "#efe8d6",
      align: "center",
      wordWrap: true,
      wordWrapWidth: labelWidth,
      breakWords: true
    });
    this.noteText = new PIXI.Text(truncateText(labelText, textStyle, 2), textStyle);
    this.noteText.anchor.set(0.5);
    this.noteText.position.set(width / 2, height * 0.47);
    this.noteText.eventMode = "none";
    this.addChild(this.noteText);
  }

  async #layoutPin() {
    this.#destroyChild("backgroundSprite");
    this.#destroyChild("backgroundShadow");
    this.#destroyChild("photoSprite");
    this.#destroyChild("noteText");
    const width = this.document.shape.width || 40;
    const height = this.document.shape.height || 40;
    await this.#updatePin(width, 0);
    if (this.pinSprite) {
      this.pinSprite.width = width;
      this.pinSprite.height = height;
      this.pinSprite.position.set(0, 0);
    }
  }

  async #layoutHandout(cardData) {
    const width = this.document.shape.width || 400;
    const height = this.document.shape.height || 400;
    this.#destroyChild("backgroundSprite");
    this.#destroyChild("backgroundShadow");
    this.#destroyChild("noteText");
    if (this.photoMask) this.photoMask.visible = false;
    if (!this.photoSprite || this.photoSprite.destroyed) {
      this.photoSprite = new PIXI.Sprite();
      this.addChild(this.photoSprite);
    }
    const fallbackImage = `${BOARD_ASSET_PATH}/newhandout.webp`;
    const texture = await foundry.canvas.loadTexture(cardData.image || fallbackImage, { fallback: fallbackImage });
    if (texture && !this.photoSprite.destroyed) {
      this.photoSprite.texture = texture;
      const textureRatio = texture.width / texture.height;
      if (textureRatio > width / height) {
        this.photoSprite.width = width;
        this.photoSprite.height = width / textureRatio;
      } else {
        this.photoSprite.height = height;
        this.photoSprite.width = height * textureRatio;
      }
      this.photoSprite.position.set((width - this.photoSprite.width) / 2, (height - this.photoSprite.height) / 2);
      this.photoSprite.mask = null;
      this.photoSprite.visible = true;
    }
    await this.#updatePin(width, height * 0.05);
  }

  async #layoutPaper(cardData) {
    const isPhoto = cardData.type === "photo";
    const isIndex = cardData.type === "index";
    const width = this.getCardWidth();
    let height = width;
    if (isPhoto) height = Math.round(width / (225 / 290));
    if (isIndex) height = Math.round(width / (600 / 400));

    let backgroundImage = `${BOARD_ASSET_PATH}/note_white.webp`;
    if (isPhoto) backgroundImage = `${BOARD_ASSET_PATH}/photoFrame.webp`;
    if (isIndex) backgroundImage = `${BOARD_ASSET_PATH}/note_index.webp`;

    if (!this.backgroundSprite || this.backgroundSprite.destroyed) {
      this.backgroundSprite = new PIXI.Sprite();
      this.addChild(this.backgroundSprite);
    }
    const backgroundTexture = await foundry.canvas.loadTexture(backgroundImage);
    if (backgroundTexture && !this.backgroundSprite.destroyed) {
      this.#ensureShadow(backgroundTexture, width, height, 3);
      this.backgroundSprite.texture = backgroundTexture;
      this.backgroundSprite.width = width;
      this.backgroundSprite.height = height;
      this.backgroundSprite.tint = 0xffffff;
      if (cardData.type === "sticky") {
        try {
          this.backgroundSprite.tint = cardData.tint || "#ffffff";
        } catch {
          this.backgroundSprite.tint = 0xffffff;
        }
      }
    }

    if (isPhoto) {
      await this.#layoutPhotoImage(cardData, width, height);
    } else if (this.photoSprite) {
      this.photoSprite.visible = false;
      if (this.photoMask) this.photoMask.visible = false;
    }

    await this.#updatePin(width, 3);
    this.#layoutText(cardData, width, height, isPhoto, isIndex);
  }

  async #layoutPhotoImage(cardData, width, height) {
    const fallbackImage = `${BOARD_ASSET_PATH}/placeholder.webp`;
    if (!this.photoSprite || this.photoSprite.destroyed) {
      this.photoSprite = new PIXI.Sprite();
      this.addChild(this.photoSprite);
    }
    const texture = await foundry.canvas.loadTexture(cardData.image || fallbackImage, { fallback: fallbackImage });
    if (!texture || this.photoSprite.destroyed) return;
    this.photoSprite.texture = texture;
    const widthOffset = width * 0.13333;
    const heightOffset = height * 0.30246;
    const frameWidth = width - widthOffset;
    const frameHeight = height - heightOffset;
    const textureRatio = texture.width / texture.height;
    let spriteWidth = frameWidth;
    let spriteHeight = frameWidth / textureRatio;
    let offsetX = 0;
    if (textureRatio > frameWidth / frameHeight) {
      spriteHeight = frameHeight;
      spriteWidth = frameHeight * textureRatio;
      offsetX = (frameWidth - spriteWidth) / 2;
    }
    this.photoSprite.width = spriteWidth;
    this.photoSprite.height = spriteHeight;
    this.photoSprite.position.set(widthOffset / 2 + offsetX, heightOffset / 2);
    if (!this.photoMask || this.photoMask.destroyed) {
      this.photoMask = new PIXI.Graphics();
      this.addChild(this.photoMask);
    }
    this.photoMask.clear();
    this.photoMask.beginFill(0xffffff);
    this.photoMask.drawRect(widthOffset / 2, heightOffset / 2, frameWidth, frameHeight);
    this.photoMask.endFill();
    this.photoMask.visible = true;
    this.photoSprite.mask = this.photoMask;
    this.photoSprite.visible = true;
  }

  #layoutText(cardData, width, height, isPhoto, isIndex) {
    let fontFamily = cardData.font || DEFAULT_FONT;
    if (FONT_REPLACEMENTS[fontFamily]) fontFamily = FONT_REPLACEMENTS[fontFamily];
    let defaultFontSize = getBoardSetting(BOARD_SETTING_KEYS.baseFontSize) || 16;
    if (isIndex) defaultFontSize = 9;
    const baseFontSize = cardData.fontSize || defaultFontSize;
    let fontBoost = 1;
    if (fontFamily === "Caveat" || fontFamily === "Amatic SC") fontBoost = 1.6;
    const fontSize = (width / 200) * baseFontSize * fontBoost;
    const textStyle = new PIXI.TextStyle({
      fontFamily: [fontFamily, "Signika", "sans-serif"],
      fontSize,
      fill: cardData.textColor || "#000000",
      wordWrap: true,
      wordWrapWidth: width - 8,
      align: "center"
    });
    let maxLines = 6;
    if (isPhoto) maxLines = 1;
    if (isIndex) maxLines = 14;
    const displayText = truncateText(cardData.text || "", textStyle, maxLines);
    if (!this.noteText || this.noteText.destroyed) {
      this.noteText = new PIXI.Text(displayText, textStyle);
      this.noteText.anchor.set(0.5);
      this.addChild(this.noteText);
    } else {
      this.noteText.style = textStyle;
      this.noteText.text = displayText;
    }
    this.noteText.visible = true;
    let textY = height / 2;
    if (isPhoto) textY = height - 25;
    this.noteText.position.set(width / 2, textY);
  }
}

/**
 * Результаты подрезки текста: одинаковые текст, шрифт и размер на доске встречаются постоянно,
 * а измерение строк дорогое. Ключ учитывает, загрузился ли шрифт, чтобы не закешировать замеры запасного шрифта.
 */
const truncatedTextCache = new Map();
const TRUNCATE_CACHE_LIMIT = 2000;

/**
 * Обрезать текст, чтобы он поместился в заданное число строк.
 * @param {string} text
 * @param {PIXI.TextStyle} textStyle
 * @param {number} maxLines
 */
function truncateText(text, textStyle, maxLines) {
  if (!text) return text;
  const fontFamily = [textStyle.fontFamily].flat()[0];
  const fontLoaded = document.fonts.check(`16px "${fontFamily}"`);
  const cacheKey = `${fontFamily}|${textStyle.fontSize}|${textStyle.wordWrapWidth}|${maxLines}|${fontLoaded}|${text}`;
  const cachedText = truncatedTextCache.get(cacheKey);
  if (cachedText !== undefined) return cachedText;
  const truncatedText = measureAndTruncate(text, textStyle, maxLines);
  if (truncatedTextCache.size >= TRUNCATE_CACHE_LIMIT) truncatedTextCache.clear();
  truncatedTextCache.set(cacheKey, truncatedText);
  return truncatedText;
}

/** Подбор длины текста поиском половинным делением (каждый шаг — измерение строк PIXI). */
function measureAndTruncate(text, textStyle, maxLines) {
  const measure = (candidate) => PIXI.TextMetrics.measureText(candidate, textStyle).lines.length;
  if (measure(text) <= maxLines) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, middle).trim()}…`) <= maxLines) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${text.slice(0, low).trim()}…`;
}
