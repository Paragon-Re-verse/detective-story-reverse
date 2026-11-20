import { TEMPLATE_PATH } from "../constants.js";
import { localize, format } from "../i18n.js";
import { DetectiveApplication, openSingleton } from "./base-application.js";
import { canManageCases } from "../permissions.js";
import {
  getCase,
  getCaseLabel,
  saveTimelineEvent,
  deleteTimelineEvent,
  moveTimelineEvent,
  setTimelineMode,
  isTimelineEventVisible,
  getArchivedSuspect,
  TIMELINE_VISIBILITY,
  CASE_STATUS
} from "../data/cases.js";
import {
  TIMELINE_MODES,
  TIMELINE_SCALES,
  parseTimelineTime,
  minutesToTimelineValue,
  splitDayValue,
  joinDayValue,
  chooseTickStep,
  layoutTimeline
} from "../data/timeline-layout.js";
import { listCaseClueIds } from "../data/case-progress.js";
import { getSuspect, listSuspects } from "../data/suspects.js";
import { userHasClue, getPlayerClue, getPlayerClues } from "../data/player-clues.js";
import { getClueTemplate } from "../data/clue-templates.js";
import { formatDateTime, enrichText } from "./view-helpers.js";
import { openClueView } from "./clue-view.js";
import { openSuspectDossier } from "./suspect-dossier.js";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

const CARD_WIDTH = 190;
const CARD_HEIGHT = 84;
/** Предельная ширина дорожки в пикселях: ограничивает увеличение на длинных делах. */
const MAX_TRACK_WIDTH = 60000;
const ZOOM_FACTOR = 1.6;
/** Шаг привязки времени при перетаскивании, в минутах. */
const DRAG_SNAP_MINUTES = 5;
/** Сдвиг меньше этого — клик, а не перетаскивание. */
const DRAG_THRESHOLD_PX = 4;
const DEFAULT_EVENT_COLOR = "#c9593f";

/**
 * Хронологическая карта дела. События раскладываются сами: по реальному времени (с масштабом) или на равных
 * расстояниях; над и под линией чередуются, одновременные — «лесенкой». Интервалы показаны полосой на линии.
 * ГМ и профайлер правят, перетаскивают события по шкале и бросают на неё улики из списка; скрытые события
 * видит только ГМ, события «по улике» — тот, у кого эта улика есть.
 */
export class TimelineApplication extends DetectiveApplication {
  /** @param {string} caseId */
  constructor(caseId, options = {}) {
    super({ ...options, id: TimelineApplication.buildId(caseId) });
    this.caseId = caseId;
    this.scale = TIMELINE_SCALES.time;
    /** Пикселей на минуту; null — вписать в окно. */
    this.pixelsPerMinute = null;
  }

  static buildId(caseId) {
    return `detective-story-timeline-${caseId}`;
  }

  static DEFAULT_OPTIONS = {
    classes: ["timeline"],
    window: { icon: "fa-solid fa-timeline", resizable: true },
    position: { width: 980, height: 560 },
    actions: {
      addEvent: TimelineApplication.#onAddEvent,
      editEvent: TimelineApplication.#onEditEvent,
      deleteEvent: TimelineApplication.#onDeleteEvent,
      setScale: TimelineApplication.#onSetScale,
      zoomIn: TimelineApplication.#onZoomIn,
      zoomOut: TimelineApplication.#onZoomOut,
      zoomFit: TimelineApplication.#onZoomFit
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

  get canEdit() {
    const caseData = getCase(this.caseId);
    return Boolean(caseData) && canManageCases() && caseData.status !== CASE_STATUS.closed;
  }

  /** Видимые пользователю события с разобранным временем. */
  #collectEvents(caseData) {
    const mode = caseData.timeline.mode;
    return Object.values(caseData.timeline.events)
      .filter((timelineEvent) => isTimelineEventVisible(timelineEvent, (originId) => userHasClue(game.user, originId)))
      .map((timelineEvent) => ({
        ...timelineEvent,
        startMinutes: parseTimelineTime(timelineEvent.start, mode),
        endMinutes: parseTimelineTime(timelineEvent.end, mode)
      }));
  }

  /** Масштаб «вписать»: весь диапазон в видимую ширину окна, но не уже предела дорожки. */
  #resolvePixelsPerMinute(events) {
    const times = events.flatMap((timelineEvent) => [timelineEvent.startMinutes, timelineEvent.endMinutes]).filter((minutes) => minutes !== null);
    let range = 1;
    if (times.length) range = Math.max(1, Math.max(...times) - Math.min(...times));
    const visibleWidth = Math.max(300, (this.position.width ?? 980) - CARD_WIDTH - 60);
    const fitPixelsPerMinute = visibleWidth / range;
    const maximum = MAX_TRACK_WIDTH / range;
    let pixelsPerMinute = this.pixelsPerMinute ?? fitPixelsPerMinute;
    pixelsPerMinute = Math.min(Math.max(pixelsPerMinute, fitPixelsPerMinute / 4), Math.max(maximum, fitPixelsPerMinute));
    this.fitPixelsPerMinute = fitPixelsPerMinute;
    return pixelsPerMinute;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const caseData = getCase(this.caseId);
    if (!caseData) return Object.assign(context, { missing: true });
    const mode = caseData.timeline.mode;
    const events = this.#collectEvents(caseData);
    const pixelsPerMinute = this.#resolvePixelsPerMinute(events);
    this.currentPixelsPerMinute = pixelsPerMinute;
    const layout = layoutTimeline(
      events.map((timelineEvent) => ({ id: timelineEvent.id, start: timelineEvent.startMinutes, end: timelineEvent.endMinutes })),
      { scale: this.scale, pixelsPerMinute, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT }
    );
    this.layout = layout;
    const eventsById = new Map(events.map((timelineEvent) => [timelineEvent.id, timelineEvent]));
    const items = layout.items.map((item) => {
      const timelineEvent = eventsById.get(item.id);
      let visibilityIcon = "";
      let visibilityLabel = "";
      if (game.user.isGM && timelineEvent.visibility === TIMELINE_VISIBILITY.hidden) {
        visibilityIcon = "fa-solid fa-eye-slash";
        visibilityLabel = localize("Timeline.VisibilityChoices.hidden");
      } else if (game.user.isGM && timelineEvent.visibility === TIMELINE_VISIBILITY.onClue) {
        visibilityIcon = "fa-solid fa-link";
        visibilityLabel = localize("Timeline.VisibilityChoices.onClue");
      }
      return {
        ...item,
        title: timelineEvent.title,
        image: timelineEvent.image,
        location: timelineEvent.location,
        approximate: timelineEvent.approximate,
        color: timelineEvent.color || DEFAULT_EVENT_COLOR,
        dateLabel: describeEventTime(timelineEvent, mode),
        clueCount: listVisibleClueIds(timelineEvent).length,
        suspectCount: timelineEvent.suspectIds.length,
        visibilityIcon,
        visibilityLabel,
        isHiddenForPlayers: Boolean(visibilityIcon)
      };
    });
    const ticks = layout.ticks.map((tick) => ({ ...tick, label: describeTick(tick.minutes, mode, chooseTickStep(pixelsPerMinute)) }));
    return Object.assign(context, {
      items,
      ticks,
      layout,
      cardWidth: CARD_WIDTH,
      cardHeight: CARD_HEIGHT,
      hasEvents: items.length > 0,
      canEdit: this.canEdit,
      mode,
      modeChoices: { [TIMELINE_MODES.date]: "DETECTIVE_STORY.Timeline.Modes.date", [TIMELINE_MODES.day]: "DETECTIVE_STORY.Timeline.Modes.day" },
      isTimeScale: this.scale === TIMELINE_SCALES.time
    });
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.subscribe("updateJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.caseId) this.queuePartRender("timeline");
    });
    this.subscribe("deleteJournalEntry", (journalEntry) => {
      if (journalEntry.id === this.caseId) this.close();
    });
    // События «по улике» появляются, как только у игрока появилась улика.
    this.subscribe("updateUser", (user) => {
      if (user.id === game.user.id) this.queuePartRender("timeline");
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector("select[name='timelineMode']")?.addEventListener("change", async (event) => {
      await setTimelineMode(this.caseId, event.target.value);
    });
    for (const cardElement of this.element.querySelectorAll(".timeline-card")) this.#attachCardPointer(cardElement);
    const trackElement = this.element.querySelector(".timeline-track.droppable");
    if (!trackElement) return;
    trackElement.addEventListener("dragover", (event) => {
      event.preventDefault();
      trackElement.classList.add("drag-over");
    });
    trackElement.addEventListener("dragleave", (event) => {
      if (!trackElement.contains(event.relatedTarget)) trackElement.classList.remove("drag-over");
    });
    trackElement.addEventListener("drop", (event) => this.#onDropClue(event, trackElement));
  }

  /** Время в точке дорожки (по шкале времени); null — шкала равных расстояний или пустая дорожка. */
  #timeAtTrackX(trackX) {
    if (this.scale !== TIMELINE_SCALES.time || !this.layout || !this.currentPixelsPerMinute) return null;
    const minutes = this.layout.origin + (trackX - this.layout.padding) / this.currentPixelsPerMinute;
    return Math.round(minutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
  }

  /**
   * Карточка: короткий клик открывает подробности, перетаскивание вдоль шкалы меняет время (ГМ и профайлер,
   * только на шкале времени и только у событий со временем).
   * @param {HTMLElement} cardElement
   */
  #attachCardPointer(cardElement) {
    cardElement.addEventListener("pointerdown", (pointerDownEvent) => {
      if (pointerDownEvent.button !== 0 || pointerDownEvent.target.closest("button")) return;
      const startX = pointerDownEvent.clientX;
      const canDrag = this.canEdit && this.scale === TIMELINE_SCALES.time && !cardElement.classList.contains("untimed");
      let movedBy = 0;
      const onMove = (moveEvent) => {
        movedBy = moveEvent.clientX - startX;
        if (canDrag && Math.abs(movedBy) > DRAG_THRESHOLD_PX) {
          cardElement.classList.add("dragging");
          cardElement.style.transform = `translateX(${movedBy}px)`;
        }
      };
      const onUp = async () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        cardElement.classList.remove("dragging");
        cardElement.style.transform = "";
        const eventId = cardElement.dataset.eventId;
        if (Math.abs(movedBy) <= DRAG_THRESHOLD_PX) {
          await this.#showDetails(eventId);
          return;
        }
        if (canDrag) await this.#moveEventBy(eventId, movedBy);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  /** Сдвинуть событие на столько пикселей шкалы; интервал сдвигается целиком. */
  async #moveEventBy(eventId, deltaPixels) {
    const caseData = getCase(this.caseId);
    const timelineEvent = caseData?.timeline.events[eventId];
    if (!timelineEvent || !this.currentPixelsPerMinute) return;
    const mode = caseData.timeline.mode;
    const startMinutes = parseTimelineTime(timelineEvent.start, mode);
    if (startMinutes === null) return;
    let deltaMinutes = Math.round(deltaPixels / this.currentPixelsPerMinute / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
    if (mode === TIMELINE_MODES.day) deltaMinutes = Math.max(deltaMinutes, -startMinutes);
    if (!deltaMinutes) return;
    const endMinutes = parseTimelineTime(timelineEvent.end, mode);
    let end = "";
    if (endMinutes !== null) end = minutesToTimelineValue(endMinutes + deltaMinutes, mode);
    await moveTimelineEvent(this.caseId, eventId, minutesToTimelineValue(startMinutes + deltaMinutes, mode), end);
  }

  /** Улику бросили на шкалу: новое событие с этой уликой, временем в точке броска, названием и картинкой улики. */
  async #onDropClue(event, trackElement) {
    event.preventDefault();
    trackElement.classList.remove("drag-over");
    let dropData;
    try {
      dropData = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (dropData?.type !== "DetectiveStoryClue") return;
    const ownerUser = game.users.get(dropData.ownerUserId) ?? game.user;
    const clue = getPlayerClue(ownerUser, dropData.originId) ?? getClueTemplate(dropData.originId);
    if (!clue) return;
    const canvasElement = trackElement.querySelector(".timeline-canvas");
    const trackX = event.clientX - canvasElement.getBoundingClientRect().left;
    const minutes = this.#timeAtTrackX(trackX);
    const caseData = getCase(this.caseId);
    let start = "";
    if (minutes !== null && caseData) start = minutesToTimelineValue(minutes, caseData.timeline.mode);
    await editTimelineEventDialog(this.caseId, null, { title: clue.name, image: clue.img, clueIds: [dropData.originId], start });
  }

  async #showDetails(eventId) {
    const caseData = getCase(this.caseId);
    const timelineEvent = caseData?.timeline.events[eventId];
    if (!timelineEvent) return;
    const content = await renderTemplate(`${TEMPLATE_PATH}/apps/timeline-details.hbs`, {
      event: timelineEvent,
      color: timelineEvent.color || DEFAULT_EVENT_COLOR,
      dateLabel: describeEventTime(timelineEvent, caseData.timeline.mode),
      description: await enrichText(timelineEvent.description.replace(/\n/g, "<br>")),
      suspects: timelineEvent.suspectIds.map((suspectId) => {
        const suspect = getSuspect(suspectId) ?? getArchivedSuspect(suspectId);
        return { id: suspectId, name: suspect?.name ?? "?", portrait: suspect?.portrait ?? "" };
      }),
      clues: listVisibleClueIds(timelineEvent).map((originId) => {
        const clue = getPlayerClue(game.user, originId) ?? getClueTemplate(originId);
        return { id: originId, name: clue?.name ?? "?", img: clue?.img ?? "", canOpen: userHasClue(game.user, originId) };
      })
    });
    await DialogV2.prompt({
      window: { title: timelineEvent.title, icon: "fa-solid fa-calendar-day" },
      classes: ["detective-story", "timeline-details-dialog"],
      position: { width: 420 },
      content,
      ok: { label: localize("Common.Ok"), icon: "fa-solid fa-check" },
      render: (renderEvent, dialog) => {
        dialog.element.addEventListener("click", (clickEvent) => {
          const suspectLink = clickEvent.target.closest("[data-suspect-id]");
          if (suspectLink) openSuspectDossier(suspectLink.dataset.suspectId);
          const clueLink = clickEvent.target.closest("a[data-origin-id]");
          if (clueLink) openClueView(game.user, clueLink.dataset.originId);
        });
      },
      rejectClose: false
    });
  }

  static async #onAddEvent() {
    await editTimelineEventDialog(this.caseId, null);
  }

  static async #onEditEvent(event, target) {
    const eventId = target.closest("[data-event-id]").dataset.eventId;
    const timelineEvent = getCase(this.caseId)?.timeline.events[eventId];
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

  static #onSetScale(event, target) {
    this.scale = TIMELINE_SCALES.time;
    if (target.dataset.scale === TIMELINE_SCALES.even) this.scale = TIMELINE_SCALES.even;
    this.render({ parts: ["timeline"] });
  }

  static #onZoomIn() {
    this.pixelsPerMinute = (this.currentPixelsPerMinute ?? 1) * ZOOM_FACTOR;
    this.render({ parts: ["timeline"] });
  }

  static #onZoomOut() {
    this.pixelsPerMinute = (this.currentPixelsPerMinute ?? 1) / ZOOM_FACTOR;
    this.render({ parts: ["timeline"] });
  }

  static #onZoomFit() {
    this.pixelsPerMinute = null;
    this.render({ parts: ["timeline"] });
  }
}

/** Связанные улики, которые можно показать: ГМ — все, остальным — только свои (без спойлеров). */
function listVisibleClueIds(timelineEvent) {
  if (game.user.isGM) return timelineEvent.clueIds;
  return timelineEvent.clueIds.filter((originId) => userHasClue(game.user, originId));
}

/** Подпись одного момента: дата и время или «День N, 14:30». */
function describeMoment(value, mode) {
  if (!value) return "";
  if (mode === TIMELINE_MODES.day) {
    if (parseTimelineTime(value, mode) === null) return "";
    const { day, time } = splitDayValue(value);
    return format("Timeline.DayLabel", { day, time });
  }
  return formatDateTime(value);
}

/** Подпись события: момент или интервал «начало – конец»; без времени — «Время не указано». */
function describeEventTime(timelineEvent, mode) {
  const startLabel = describeMoment(timelineEvent.start, mode);
  if (!startLabel) return localize("Timeline.NoTime");
  const endLabel = describeMoment(timelineEvent.end, mode);
  if (!endLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

/** Подпись деления шкалы: при шаге от суток — только дата (день), иначе время. */
function describeTick(minutes, mode, step) {
  if (mode === TIMELINE_MODES.day) {
    const { day, time } = splitDayValue(minutesToTimelineValue(minutes, mode));
    if (step >= 1440) return format("Timeline.DayShort", { day });
    return format("Timeline.DayLabel", { day, time });
  }
  // Минуты шкалы посчитаны как UTC (см. parseTimelineTime), поэтому и подпись — в UTC: это то же «настенное» время.
  const date = new Date(minutes * 60000);
  if (step >= 1440) return date.toLocaleDateString(game.i18n.lang, { timeZone: "UTC", dateStyle: "short" });
  return date.toLocaleString(game.i18n.lang, { timeZone: "UTC", dateStyle: "short", timeStyle: "short" });
}

/**
 * Редактор события: название, описание, начало и конец (дата или «день N»), «примерно», место, цвет, фото,
 * подозреваемые и улики; у ГМ — видимость.
 * @param {string} caseId
 * @param {object|null} timelineEvent
 * @param {object} [prefill] - для нового события (улика, брошенная на шкалу)
 */
async function editTimelineEventDialog(caseId, timelineEvent, prefill = {}) {
  const caseData = getCase(caseId);
  if (!caseData || !canManageCases()) return;
  const mode = caseData.timeline.mode;
  const eventData = timelineEvent ?? { id: "", title: "", description: "", start: "", end: "", approximate: false, location: "", color: "", image: "", clueIds: [], suspectIds: [], visibility: TIMELINE_VISIBILITY.visible, ...prefill };
  const selectedSuspects = new Set(eventData.suspectIds);
  const selectedClues = new Set(eventData.clueIds);
  let suspects = caseData.suspectIds.map((suspectId) => getSuspect(suspectId)).filter(Boolean);
  if (!suspects.length) suspects = listSuspects();
  for (const suspectId of selectedSuspects) {
    if (!suspects.some((suspect) => suspect.id === suspectId)) {
      const suspect = getSuspect(suspectId) ?? getArchivedSuspect(suspectId);
      if (suspect) suspects.push(suspect);
    }
  }
  const content = await renderTemplate(`${TEMPLATE_PATH}/apps/timeline-event.hbs`, {
    event: eventData,
    isDayMode: mode === TIMELINE_MODES.day,
    start: splitDayValue(eventData.start),
    end: splitDayValue(eventData.end),
    colorValue: eventData.color || DEFAULT_EVENT_COLOR,
    hasColor: Boolean(eventData.color),
    isGameMaster: game.user.isGM,
    visibilityChoices: Object.fromEntries(Object.values(TIMELINE_VISIBILITY).map((visibility) => [visibility, `DETECTIVE_STORY.Timeline.VisibilityChoices.${visibility}`])),
    suspects: suspects.map((suspect) => ({ id: suspect.id, name: suspect.name, portrait: suspect.portrait, selected: selectedSuspects.has(suspect.id) })),
    clues: listEventClueChoices(caseData, selectedClues)
  });
  let title = localize("Timeline.NewEvent");
  if (timelineEvent) title = localize("Timeline.EditEvent");
  const formValues = await DialogV2.wait({
    window: { title, icon: "fa-solid fa-calendar-plus" },
    classes: ["detective-story", "timeline-event-dialog"],
    position: { width: 520 },
    content,
    buttons: [
      {
        action: "save",
        label: localize("Common.Save"),
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (event, button) => readEventForm(button.form, mode)
      },
      { action: "cancel", label: localize("Common.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (!formValues || typeof formValues !== "object") return;
  if (!formValues.title.trim()) {
    ui.notifications.warn(localize("Timeline.TitleRequired"));
    return;
  }
  // Видимость меняет только ГМ: профайлер сохраняет то, что уже стояло.
  if (!game.user.isGM) formValues.visibility = eventData.visibility;
  await saveTimelineEvent(caseId, { ...formValues, id: eventData.id });
}

/** Улики для выбора: прикреплённые к делу, у ГМ — ещё и все улики дела из прогресса; уже выбранные — всегда. */
function listEventClueChoices(caseData, selectedClues) {
  const clueIds = new Set(Object.keys(caseData.pinned));
  if (game.user.isGM) {
    for (const templateId of listCaseClueIds(caseData)) clueIds.add(templateId);
  }
  for (const originId of selectedClues) clueIds.add(originId);
  const ownClues = getPlayerClues(game.user);
  return [...clueIds].map((originId) => {
    const clue = ownClues[originId] ?? caseData.pinned[originId] ?? getClueTemplate(originId);
    return { id: originId, name: clue?.name ?? "?", img: clue?.img ?? "", selected: selectedClues.has(originId) };
  }).sort((first, second) => first.name.localeCompare(second.name, game.i18n.lang));
}

/** @param {HTMLFormElement} form @param {string} mode */
function readEventForm(form, mode) {
  const elements = form.elements;
  let start = "";
  let end = "";
  if (mode === TIMELINE_MODES.day) {
    start = joinDayValue(elements.startDay?.value, elements.startTime?.value);
    end = joinDayValue(elements.endDay?.value, elements.endTime?.value);
  } else {
    start = elements.start?.value ?? "";
    end = elements.end?.value ?? "";
  }
  let color = "";
  if (elements.useColor?.checked) color = elements.color?.value ?? "";
  const checkedValues = (name) => [...form.querySelectorAll(`input[name='${name}']:checked`)].map((input) => input.value);
  return {
    title: elements.title?.value ?? "",
    description: elements.description?.value ?? "",
    start,
    end,
    approximate: Boolean(elements.approximate?.checked),
    location: elements.location?.value ?? "",
    color,
    image: elements.image?.value ?? "",
    visibility: elements.visibility?.value ?? TIMELINE_VISIBILITY.visible,
    suspectIds: checkedValues("suspect"),
    clueIds: checkedValues("clue")
  };
}

/** @param {string} caseId */
export function openTimeline(caseId) {
  return openSingleton(TimelineApplication.buildId(caseId), () => new TimelineApplication(caseId));
}
