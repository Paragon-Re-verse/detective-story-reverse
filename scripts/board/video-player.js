import { TEMPLATE_PATH } from "../constants.js";
import { localize } from "../i18n.js";
import { DetectiveApplication } from "../apps/base-application.js";
import { applyTapeEffectToElement } from "./audio-utils.js";

/**
 * Окно видео для общего показа: ГМ включает видеокассету «для всех», и у каждого клиента
 * открывается это окно и играет с того же места. Окно не привязано к карточке — игрок может быть на другой сцене.
 */
export class VideoPlayerWindow extends DetectiveApplication {
  /**
   * @param {{videoPath: string, title: string, applyEffect: boolean, offset: number}} playback
   */
  constructor(playback, options = {}) {
    super({ ...options, id: VideoPlayerWindow.buildId(playback.videoPath) });
    this.playback = playback;
    this.tapeEffect = null;
  }

  /** id окна из пути к файлу (в id нельзя слэши и точки). @param {string} videoPath */
  static buildId(videoPath) {
    let hash = 0;
    for (const character of String(videoPath)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return `detective-story-video-${hash.toString(36)}`;
  }

  static DEFAULT_OPTIONS = {
    classes: ["video-player"],
    window: { icon: "fa-solid fa-film", resizable: true },
    position: { width: 640, height: "auto" }
  };

  static PARTS = {
    player: { template: `${TEMPLATE_PATH}/board/video-player.hbs` }
  };

  get title() {
    return this.playback.title || localize("VideoPlayer.Title");
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      videoUrl: this.playback.videoPath,
      vhsEffect: this.playback.applyEffect
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const videoElement = this.element.querySelector("video");
    if (!videoElement) return;
    this.tapeEffect?.disconnect();
    this.tapeEffect = null;
    if (this.playback.applyEffect) this.tapeEffect = applyTapeEffectToElement(videoElement);
    startVideo(videoElement, this.playback.offset);
  }

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    this.element?.querySelector("video")?.pause();
    this.tapeEffect?.disconnect();
    this.tapeEffect = null;
  }
}

/**
 * Запустить видео с нужного места. Если браузер запретил автозапуск со звуком, видео идёт без звука,
 * а игрок включает звук сам.
 * @param {HTMLVideoElement} videoElement
 * @param {number} [offset] - секунда, с которой начать
 */
export function startVideo(videoElement, offset = 0) {
  const play = () => {
    if (offset) videoElement.currentTime = offset;
    videoElement.play().catch(() => {
      videoElement.muted = true;
      videoElement.play().catch(() => null);
      ui.notifications.info(localize("VideoPlayer.Muted"));
    });
  };
  if (videoElement.readyState >= 1) {
    play();
  } else {
    videoElement.addEventListener("loadedmetadata", play, { once: true });
  }
}

/** Открыть (или перезапустить) общее видео у себя. */
export async function openVideoPlayer(playback) {
  const existingWindow = foundry.applications.instances.get(VideoPlayerWindow.buildId(playback.videoPath));
  if (existingWindow) await existingWindow.close();
  const playerWindow = new VideoPlayerWindow(playback);
  await playerWindow.render({ force: true });
  return playerWindow;
}

/** Закрыть общее видео у себя. @param {string} videoPath */
export async function closeVideoPlayer(videoPath) {
  await foundry.applications.instances.get(VideoPlayerWindow.buildId(videoPath))?.close();
}
