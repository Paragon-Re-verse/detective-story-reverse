// Самопроверка раскладки таймлайна: node tools/timeline-layout.test.mjs
import assert from "node:assert/strict";
import {
  parseTimelineTime, minutesToTimelineValue, splitDayValue, joinDayValue, chooseTickStep, layoutTimeline, TIMELINE_SCALES
} from "../scripts/data/timeline-layout.js";

assert.equal(parseTimelineTime("day:1 00:00", "day"), 0);
assert.equal(parseTimelineTime("day:3 14:30", "day"), 2 * 1440 + 870);
assert.equal(parseTimelineTime("", "day"), null);
assert.equal(parseTimelineTime("2026-11-20T14:30", "date") - parseTimelineTime("2026-11-20T14:00", "date"), 30);
assert.equal(parseTimelineTime("2026-03-29T03:00", "date") - parseTimelineTime("2026-03-29T01:00", "date"), 120);
assert.equal(minutesToTimelineValue(parseTimelineTime("2026-11-20T14:30", "date"), "date"), "2026-11-20T14:30");
assert.equal(minutesToTimelineValue(2 * 1440 + 870, "day"), "day:3 14:30");
assert.deepEqual(splitDayValue("day:3 9:05"), { day: 3, time: "09:05" });
assert.equal(joinDayValue("2", "08:15"), "day:2 08:15");
assert.equal(joinDayValue("2", ""), "");
assert.equal(chooseTickStep(1), 180);
assert.equal(chooseTickStep(0.01), 43200);

const options = { pixelsPerMinute: 1, cardWidth: 100, cardHeight: 50 };
// Три события в одно время: над, под, затем лесенкой — второй уровень над линией.
const sameTime = layoutTimeline([
  { id: "a", start: 0, end: null }, { id: "b", start: 0, end: null }, { id: "c", start: 0, end: null }
], { ...options, scale: TIMELINE_SCALES.time });
assert.deepEqual(sameTime.items.map((item) => [item.id, item.side, item.level]), [["a", "above", 0], ["b", "below", 0], ["c", "above", 1]]);
assert.ok(sameTime.items[2].top < sameTime.items[0].top);
assert.ok(sameTime.items[1].top > sameTime.lineY);

// Далеко разнесённые события остаются на нулевом уровне и чередуются.
const spread = layoutTimeline([
  { id: "a", start: 0, end: null }, { id: "b", start: 500, end: 700 }, { id: "c", start: 1000, end: null }, { id: "x", start: null, end: null }
], { ...options, scale: TIMELINE_SCALES.time });
assert.deepEqual(spread.items.map((item) => item.level), [0, 0, 0, 0]);
assert.equal(spread.items[1].barWidth, 200);
assert.equal(spread.items[1].x - spread.items[0].x, 500);
assert.ok(spread.items[3].untimed && spread.items[3].x > spread.items[2].x);
assert.ok(spread.ticks.length > 0);

// Равные расстояния: шаг — ширина карточки с зазором, без лесенки.
const even = layoutTimeline([{ id: "a", start: 0, end: null }, { id: "b", start: 0, end: null }, { id: "c", start: 5, end: null }], { ...options, scale: TIMELINE_SCALES.even });
assert.deepEqual(even.items.map((item) => item.level), [0, 0, 0]);
assert.equal(even.ticks.length, 0);

console.log("timeline-layout: ok");
