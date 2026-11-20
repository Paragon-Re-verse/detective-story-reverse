import { TEMPLATE_PATH } from "../constants.js";
import { localize, format, fullKey } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import { getChangedSectionKeys } from "../data/user-flags.js";
import { listEventLog, clearEventLog, LOG_EVENTS } from "../data/event-log.js";
import { getUserCharacterName } from "../data/transfers.js";
import { formatDateTime } from "./view-helpers.js";

/**
 * Журнал событий для ГМ: одна лента из записей всех пользователей, новые сверху.
 * Фильтры по игроку и по виду события; лента обновляется сама, когда кто-то пишет событие.
 */

const EVENT_ICONS = {
  [LOG_EVENTS.found]: "fa-solid fa-magnifying-glass",
  [LOG_EVENTS.failed]: "fa-solid fa-circle-xmark",
  [LOG_EVENTS.transferSent]: "fa-solid fa-share",
  [LOG_EVENTS.transferAccepted]: "fa-solid fa-handshake",
  [LOG_EVENTS.transferDeclined]: "fa-solid fa-hand",
  [LOG_EVENTS.placedOnBoard]: "fa-solid fa-thumbtack",
  [LOG_EVENTS.shownInChat]: "fa-solid fa-comment",
  [LOG_EVENTS.granted]: "fa-solid fa-gift",
  [LOG_EVENTS.pinned]: "fa-solid fa-folder-plus",
  [LOG_EVENTS.caseClosed]: "fa-solid fa-lock",
  [LOG_EVENTS.caseReopened]: "fa-solid fa-lock-open",
  [LOG_EVENTS.levelOpened]: "fa-solid fa-layer-group"
};

/** Сколько записей показывать за раз: больше человек всё равно не прокрутит. */
const DISPLAY_LIMIT = 500;

export class EventLogApplication extends DetectiveApplication {
  constructor(options = {}) {
    super({ ...options, id: "detective-story-event-log" });
    this.userFilter = "";
    this.typeFilter = "";
  }

  static DEFAULT_OPTIONS = {
    classes: ["event-log"],
    window: { icon: "fa-solid fa-scroll", resizable: true, title: fullKey("EventLog.Title") },
    position: { width: 640, height: 600 },
    actions: {
      clearLog: EventLogApplication.#onClearLog
    }
  };

  static PARTS = {
    log: { template: `${TEMPLATE_PATH}/apps/event-log.hbs`, scrollable: [".event-list"] }
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const allEntries = listEventLog();
    const filteredEntries = allEntries.filter((entry) => {
      if (this.userFilter && entry.user.id !== this.userFilter) return false;
      if (this.typeFilter && entry.type !== this.typeFilter) return false;
      return true;
    });

    const userChoices = { "": localize("EventLog.AllPlayers") };
    for (const entry of allEntries) userChoices[entry.user.id] = entry.user.name;
    const typeChoices = { "": localize("EventLog.AllEvents") };
    for (const eventType of Object.values(LOG_EVENTS)) typeChoices[eventType] = localize(`EventLog.Types.${eventType}`);

    return Object.assign(context, {
      entries: filteredEntries.slice(0, DISPLAY_LIMIT).map((entry) => this.#toRow(entry)),
      hasEntries: allEntries.length > 0,
      userChoices,
      typeChoices,
      userFilter: this.userFilter,
      typeFilter: this.typeFilter
    });
  }

  /** Строка ленты: время, иконка, кто, что. */
  #toRow(entry) {
    const details = entry.details ?? {};
    const clueList = (details.clues ?? []).map((clueName) => format("Common.Quoted", { text: clueName })).join(", ");
    let caseLabel = details.case ?? "";
    if (details.caseNumber !== undefined) {
      caseLabel = `${format("Case.NumberLabel", { number: details.caseNumber })} ${format("Common.Quoted", { text: details.caseTitle ?? "" })}`;
    }
    let textKey = `EventLog.Text.${entry.type}`;
    if (entry.type === LOG_EVENTS.failed && !details.max) textKey = "EventLog.Text.failedUnlimited";
    let actorName = entry.user.name;
    const characterName = getUserCharacterName(entry.user);
    if (characterName && characterName !== actorName) actorName = `${actorName} (${characterName})`;
    return {
      time: formatDateTime(entry.at),
      type: entry.type,
      icon: EVENT_ICONS[entry.type] ?? "fa-solid fa-circle-info",
      actor: actorName,
      isGameMaster: entry.user.isGM,
      text: format(textKey, { ...details, clues: clueList, case: caseLabel })
    };
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.subscribe("updateUser", (user, changes) => {
      if (getChangedSectionKeys(changes, "log")) this.queuePartRender("log");
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const userSelect = this.element.querySelector("select[name='userFilter']");
    userSelect?.addEventListener("change", () => {
      this.userFilter = userSelect.value;
      this.render();
    });
    const typeSelect = this.element.querySelector("select[name='typeFilter']");
    typeSelect?.addEventListener("change", () => {
      this.typeFilter = typeSelect.value;
      this.render();
    });
  }

  static async #onClearLog() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("EventLog.ClearTitle") },
      content: `<p>${localize("EventLog.ClearConfirm")}</p>`,
      rejectClose: false
    });
    if (confirmed) await clearEventLog();
  }
}

export function openEventLog() {
  if (!game.user.isGM) return null;
  return openSingleton("detective-story-event-log", () => new EventLogApplication());
}
