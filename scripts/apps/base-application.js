import { getSetting, setSetting, SETTING_KEYS } from "../settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Базовое окно модуля: стандартное оформление Foundry, положение и размер запоминаются на клиенте,
 * подписки на хуки снимаются при закрытии.
 */
export class DetectiveApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["detective-story"],
    window: { resizable: true }
  };

  /** @type {[string, number][]} */
  #hookSubscriptions = [];

  /** @inheritDoc */
  _initializeApplicationOptions(options) {
    const applicationOptions = super._initializeApplicationOptions(options);
    const savedPosition = getSetting(SETTING_KEYS.windowPositions)?.[applicationOptions.id];
    if (savedPosition) Object.assign(applicationOptions.position, savedPosition);
    return applicationOptions;
  }

  /**
   * Подписка на хук на время жизни окна.
   * @param {string} hookName
   * @param {Function} handler
   */
  subscribe(hookName, handler) {
    const hookId = Hooks.on(hookName, handler);
    this.#hookSubscriptions.push([hookName, hookId]);
  }

  /** Части окна, ожидающие перерисовки. */
  #pendingParts = new Set();
  #flushPendingParts = foundry.utils.debounce(() => {
    const parts = [...this.#pendingParts];
    this.#pendingParts.clear();
    if (parts.length && this.rendered) this.render({ parts });
  }, 150);

  /**
   * Перерисовать только перечисленные части окна; изменения копятся 150 мс и уходят одним рендером.
   * @param {...string} partIds
   */
  queuePartRender(...partIds) {
    for (const partId of partIds) this.#pendingParts.add(partId);
    this.#flushPendingParts();
  }

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    for (const [hookName, hookId] of this.#hookSubscriptions) Hooks.off(hookName, hookId);
    this.#hookSubscriptions = [];
    if (this.options.window?.positioned !== false) this.#rememberPosition();
  }

  #rememberPosition() {
    const { left, top, width, height } = this.position;
    const savedPositions = foundry.utils.deepClone(getSetting(SETTING_KEYS.windowPositions) ?? {});
    const rememberedPosition = { left, top };
    if (this.options.window?.resizable) {
      rememberedPosition.width = width;
      if (typeof height === "number") rememberedPosition.height = height;
    }
    savedPositions[this.id] = rememberedPosition;
    setSetting(SETTING_KEYS.windowPositions, savedPositions);
  }
}

/**
 * Окно, которое можно показать внутри другого окна (вкладка дела): без рамки и собственного положения,
 * элемент вставляется в заданный контейнер. Тот же класс в обычном режиме — отдельное окно.
 * @param {typeof DetectiveApplication} BaseApplication
 */
export function EmbeddedMixin(BaseApplication) {
  return class EmbeddedApplication extends BaseApplication {
    static DEFAULT_OPTIONS = {
      classes: ["embedded-panel"],
      window: { frame: false, positioned: false }
    };

    /** Вставить (или переставить после перерисовки хозяина) в контейнер. @param {HTMLElement} hostElement */
    attachTo(hostElement) {
      this.hostElement = hostElement;
      if (this.rendered && this.element.parentElement !== hostElement) hostElement.replaceChildren(this.element);
    }

    /** @inheritDoc */
    _insertElement(element) {
      if (!this.hostElement) return super._insertElement(element);
      this.hostElement.replaceChildren(element);
    }
  };
}

/**
 * Каждое окно — в одном экземпляре: повторный вызов выводит уже открытое.
 * @param {string} applicationId
 * @param {() => ApplicationV2} createApplication
 * @returns {ApplicationV2}
 */
export function openSingleton(applicationId, createApplication) {
  const existingApplication = foundry.applications.instances.get(applicationId);
  if (existingApplication) {
    existingApplication.render({ force: true });
    existingApplication.bringToFront();
    return existingApplication;
  }
  const application = createApplication();
  application.render({ force: true });
  return application;
}
