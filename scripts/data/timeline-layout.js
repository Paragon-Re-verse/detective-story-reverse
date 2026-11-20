/**
 * Таймлайн дела без зависимостей от Foundry: время событий, раскладка над и под линией «лесенкой», деления шкалы.
 * Проверяется в Node: tools/timeline-layout.test.mjs.
 */

/** Режим дат дела: обычные даты или «день N, время» без календаря. */
export const TIMELINE_MODES = { date: "date", day: "day" };
/** Шкала: по реальному времени или на равных расстояниях. */
export const TIMELINE_SCALES = { time: "time", even: "even" };

const MINUTES_PER_DAY = 1440;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const DAY_PATTERN = /^day:(\d+) (\d{1,2}):(\d{2})$/;
/** Шаги делений шкалы в минутах: выбирается первый, при котором деления не теснее minTickSpacing. */
const TICK_STEPS = [1, 5, 15, 30, 60, 180, 360, 720, 1440, 2880, 10080, 43200, 525600];

/**
 * Время события в минутах (для сравнения и шкалы). Даты считаются как UTC, чтобы переход на летнее время
 * не сдвигал события. null — время не задано или не разобрано.
 * @param {string} value - «2026-11-20T14:30» или «day:3 14:30»
 * @param {string} mode
 */
export function parseTimelineTime(value, mode) {
  const text = String(value ?? "").trim();
  if (mode === TIMELINE_MODES.day) {
    const match = DAY_PATTERN.exec(text);
    if (!match) return null;
    const day = Math.max(1, Number(match[1]));
    return (day - 1) * MINUTES_PER_DAY + Number(match[2]) * 60 + Number(match[3]);
  }
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const [, year, month, date, hours, minutes] = match.map(Number);
  return Date.UTC(year, month - 1, date, hours, minutes) / 60000;
}

/** Обратное преобразование минут в значение поля (после перетаскивания по шкале). */
export function minutesToTimelineValue(totalMinutes, mode) {
  const roundedMinutes = Math.round(totalMinutes);
  if (mode === TIMELINE_MODES.day) {
    const safeMinutes = Math.max(0, roundedMinutes);
    const day = Math.floor(safeMinutes / MINUTES_PER_DAY) + 1;
    return joinDayValue(day, formatClock(safeMinutes % MINUTES_PER_DAY));
  }
  return new Date(roundedMinutes * 60000).toISOString().slice(0, 16);
}

/** «HH:MM» из минут от начала суток. */
export function formatClock(minutesOfDay) {
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** «day:3 14:30» → {day: 3, time: "14:30"}; пустое значение → день 1 без времени. */
export function splitDayValue(value) {
  const match = DAY_PATTERN.exec(String(value ?? "").trim());
  if (!match) return { day: 1, time: "" };
  return { day: Number(match[1]), time: `${match[2].padStart(2, "0")}:${match[3]}` };
}

/** День и время из формы → «day:3 14:30». Без времени — пустая строка (событие без времени). */
export function joinDayValue(day, time) {
  const clock = String(time ?? "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(clock)) return "";
  const dayNumber = Math.max(1, Number.parseInt(day, 10) || 1);
  return `day:${dayNumber} ${clock}`;
}

/** Выбрать шаг делений шкалы. */
export function chooseTickStep(pixelsPerMinute, minTickSpacing = 110) {
  return TICK_STEPS.find((step) => step * pixelsPerMinute >= minTickSpacing) ?? TICK_STEPS.at(-1);
}

/**
 * Раскладка событий.
 *  - Шкала «по времени»: x пропорционален времени; «равные расстояния»: события идут подряд с шагом в ширину карточки.
 *  - Сторона и уровень выбираются сами: события чередуются над и под линией, а карточки, которые не помещаются
 *    рядом (одно и то же или близкое время), уходят «лесенкой» на следующий уровень от линии.
 *  - События без времени стоят в конце.
 * @param {{id: string, start: number|null, end: number|null}[]} events
 * @param {object} options
 * @param {string} options.scale
 * @param {number} options.pixelsPerMinute
 * @param {number} options.cardWidth
 * @param {number} options.cardHeight
 * @param {number} [options.gap] - между карточками по горизонтали
 * @param {number} [options.rowGap] - между уровнями
 * @param {number} [options.stemLength] - от линии до ближайшего уровня
 */
export function layoutTimeline(events, { scale, pixelsPerMinute, cardWidth, cardHeight, gap = 12, rowGap = 14, stemLength = 26 }) {
  const timedEvents = events.filter((event) => event.start !== null).sort((first, second) => first.start - second.start || String(first.id).localeCompare(String(second.id)));
  const untimedEvents = events.filter((event) => event.start === null);
  const padding = cardWidth / 2 + 16;
  const evenStep = cardWidth + gap;
  const minimum = timedEvents[0]?.start ?? 0;

  const positioned = [];
  let lastX = padding - evenStep;
  timedEvents.forEach((event, index) => {
    let x = padding + index * evenStep;
    let barWidth = 0;
    if (scale === TIMELINE_SCALES.time) {
      x = padding + (event.start - minimum) * pixelsPerMinute;
      if (event.end !== null && event.end > event.start) barWidth = (event.end - event.start) * pixelsPerMinute;
    }
    positioned.push({ event, x, barWidth });
    lastX = Math.max(lastX, x + barWidth);
  });
  for (const event of untimedEvents) {
    lastX += evenStep;
    positioned.push({ event, x: lastX, barWidth: 0 });
  }

  // Лесенка: на каждой стороне — правый край последней карточки каждого уровня.
  const rightEdges = { above: [], below: [] };
  const items = positioned.map(({ event, x, barWidth }, index) => {
    const left = x - cardWidth / 2;
    let preferredSide = "above";
    if (index % 2 === 1) preferredSide = "below";
    let otherSide = "below";
    if (preferredSide === "below") otherSide = "above";
    const freeLevel = (side) => {
      const edges = rightEdges[side];
      const level = edges.findIndex((rightEdge) => rightEdge + gap <= left);
      if (level < 0) return edges.length;
      return level;
    };
    let side = preferredSide;
    let level = freeLevel(preferredSide);
    const otherLevel = freeLevel(otherSide);
    if (otherLevel < level) {
      side = otherSide;
      level = otherLevel;
    }
    rightEdges[side][level] = x + cardWidth / 2;
    return { id: event.id, x, left, barWidth, side, level, untimed: event.start === null };
  });

  const aboveLevels = rightEdges.above.length;
  const belowLevels = rightEdges.below.length;
  const rowHeight = cardHeight + rowGap;
  const lineY = stemLength + aboveLevels * rowHeight + 8;
  for (const item of items) {
    if (item.side === "above") {
      item.top = lineY - stemLength - item.level * rowHeight - cardHeight;
      item.stemTop = item.top + cardHeight;
    } else {
      item.top = lineY + stemLength + item.level * rowHeight;
      item.stemTop = lineY;
    }
    item.stemHeight = stemLength + item.level * rowHeight;
  }

  const ticks = [];
  if (scale === TIMELINE_SCALES.time && timedEvents.length) {
    const maximum = Math.max(...timedEvents.map((event) => Math.max(event.start, event.end ?? event.start)));
    const step = chooseTickStep(pixelsPerMinute);
    for (let minutes = Math.ceil(minimum / step) * step; minutes <= maximum; minutes += step) {
      ticks.push({ minutes, x: padding + (minutes - minimum) * pixelsPerMinute });
    }
  }

  return {
    items,
    ticks,
    lineY,
    width: lastX + cardWidth / 2 + 24,
    height: lineY + stemLength + belowLevels * rowHeight + 8,
    origin: minimum,
    padding
  };
}
