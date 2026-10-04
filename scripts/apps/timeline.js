import { TEMPLATE_PATH } from "../constants.js";
import { localize, format } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import { canManageCases } from "../permissions.js";
import { getCase, getCaseLabel, getSortedTimelineEvents, saveTimelineEvent, deleteTimelineEvent, TIMELINE_SIDES, CASE_STATUS } from "../data/cases.js";
import { formatDateTime } from "./view-helpers.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Таймлайн дела: горизонтальная линия, события выше и ниже неё, сами выстраиваются по дате.
 * Читают все, правят ГМ и профайлер.
 */
export class TimelineApplication extends DetectiveApplication {
  /** @param {string} caseId */
  constructor(caseId, options = {}) {
    super({ ...options, id: TimelineApplication.buildId(caseId) });
    this.caseId = caseId;
  }

  static buildId(caseId) {
    return `detective-story-timeline-${caseId}`;
  }

  static DEFAULT_OPTIONS = {
    classes: ["timeline"],
    window: { icon: "fa-solid fa-timeline", resizable: true },
    position: { width: 980, height: 520 },
    actions: {
      addEvent: TimelineApplication.#onAddEvent,
      editEvent: TimelineApplication.#onEditEvent,
      deleteEvent: TimelineApplication.#onDeleteEvent
    }
  };

  static PARTS = {
    timeline: { template: `${TEMPLATE_PATH}/apps/timeline.hbs`, scrollable: [".timeline-track"] }
  };

  get title() {
    const caseData = getCase(this.caseId);
    if (!caseData) return localize("Timeline.Title");
    return format("Timeline.TitleFor", { label: getCaseLabel(caseData) });
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const caseData = getCase(this.caseId);
    if (!caseData) return Object.assign(context, { missing: true });
    const timelineEvents = getSortedTimelineEvents(caseData).map((timelineEvent, index) => ({
      ...timelineEvent,
      dateLabel: formatDateTime(timelineEvent.dateTime),
      isAbove: timelineEvent.side !== TIMELINE_SIDES.below,
      column: index + 1
    }));
    return Object.assign(context, {
      events: timelineEvents,
      columnCount: Math.max(timelineEvents.length, 1),
      hasEvents: timelineEvents.length > 0,
      canEdit: canManageCases() && caseData.status !== CASE_STATUS.closed
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.subscribe("updateJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.caseId) this.render();
    });
    this.subscribe("deleteJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.caseId) this.close();
    });
  }

  static async #onAddEvent() {
    await editTimelineEventDialog(this.caseId, null);
  }

  static async #onEditEvent(event, target) {
    const eventId = target.closest("[data-event-id]").dataset.eventId;
    const caseData = getCase(this.caseId);
    const timelineEvent = caseData?.timeline.events[eventId];
    if (timelineEvent) await editTimelineEventDialog(this.caseId, timelineEvent);
  }

  static async #onDeleteEvent(event, target) {
    const eventId = target.closest("[data-event-id]").dataset.eventId;
    const confirmed = await DialogV2.confirm({
      window: { title: localize("Timeline.DeleteTitle") },
      content: `<p>${localize("Timeline.DeleteConfirm")}</p>`,
      rejectClose: false
    });
    if (confirmed) await deleteTimelineEvent(this.caseId, eventId);
  }
}

/**
 * Редактор события: название, дата и время, фотография, сторона линии.
 * @param {string} caseId
 * @param {object|null} timelineEvent
 */
async function editTimelineEventDialog(caseId, timelineEvent) {
  if (!canManageCases()) return;
  let eventData = timelineEvent;
  if (!eventData) eventData = { id: "", title: "", dateTime: "", image: "", side: TIMELINE_SIDES.above };
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/timeline-event.hbs`, {
    event: eventData,
    isAbove: eventData.side !== TIMELINE_SIDES.below
  });
  let title = localize("Timeline.NewEvent");
  if (timelineEvent) title = localize("Timeline.EditEvent");
  const formValues = await DialogV2.input({
    window: { title, icon: "fa-solid fa-calendar-plus" },
    classes: ["detective-story"],
    content,
    ok: { label: localize("Common.Save"), icon: "fa-solid fa-floppy-disk" },
    rejectClose: false
  });
  if (!formValues) return;
  if (!String(formValues.title ?? "").trim()) {
    ui.notifications.warn(localize("Timeline.TitleRequired"));
    return;
  }
  await saveTimelineEvent(caseId, { ...formValues, id: eventData.id });
}

/** @param {string} caseId */
export function openTimeline(caseId) {
  return openSingleton(TimelineApplication.buildId(caseId), () => new TimelineApplication(caseId));
}
