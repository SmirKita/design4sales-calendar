import { isDate, moscowInstant, scheduledSlots, todayInMoscow } from "./publicationSchedule.js";

// Этапы подготовки хранятся в существующем поле phases.preparation, поэтому старые планы читаются без миграции.
export const STAGES = [
  { id: "idea", name: "Тема", hint: "Есть замысел и бриф" },
  { id: "text", name: "Текст", hint: "Пишу текст" },
  { id: "visual", name: "Визуал", hint: "Готовлю визуал" },
  { id: "ready", name: "Готово", hint: "Можно выпускать" },
  { id: "published", name: "Вышло", hint: "Опубликовано" },
];
const preparationByStage = { idea: "planned", text: "draft", visual: "visual", ready: "ready" };

export function preparationFor(stage) {
  return preparationByStage[stage] || "planned";
}

export function stageOf(entry) {
  if (entry.section === "archive") return "published";
  const prep = entry.record.phases?.preparation;
  if (prep === "draft") return "text";
  if (prep === "visual") return "visual";
  if (prep === "ready" || prep === "skip") return "ready";
  return "idea";
}

export function publicationEntry(post, record, settings, now) {
  const slots = scheduledSlots(post, record, settings);
  const active = slots.filter((slot) => !["published", "cancelled"].includes(slot.status));
  let section = "ideas";
  if (active.length) section = "plan";
  else if (slots.some((slot) => slot.status === "published") || post.cycle === "archive" || record.phases.publication === "published") section = "archive";
  const future = active.map((slot) => moscowInstant(slot.date, slot.time)).filter((time) => time > now);
  const targetDate = isDate(record.targetDate) ? record.targetDate : post.date;
  const cancelled = slots.length > 0 && slots.every((slot) => slot.status === "cancelled");
  const shelved = section === "ideas" && (record.shelved === true || cancelled);
  const today = todayInMoscow(new Date(now));
  const overdue = section === "ideas" && !shelved && post.kind === "publication" && targetDate < today;
  const entry = { post, record, slots, active, section, targetDate, shelved, overdue, next: future.length ? Math.min(...future) : Infinity };
  entry.stage = stageOf(entry);
  return entry;
}

export function planningTimeline(entries, today) {
  return entries.flatMap((entry) => {
    if (entry.section === "ideas") {
      return !entry.shelved && entry.targetDate >= today ? [{ id: entry.post.id, post: entry.post, entry, date: entry.targetDate, tentative: true }] : [];
    }
    if (entry.section !== "plan") return [];
    return entry.active.filter((slot) => slot.date >= today).map((slot) => ({
      id: entry.post.id + ":" + slot.platform.id, post: entry.post, entry,
      date: slot.date, time: slot.time, platform: slot.platform.name, tentative: false,
    }));
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "23:59").localeCompare(b.time || "23:59") || a.id.localeCompare(b.id));
}

const day = 86_400_000;
export function addDays(date, days) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * day).toISOString().slice(0, 10);
}
export function weekday(date) {
  return (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
}
export function weekStart(date) {
  return addDays(date, -weekday(date));
}

function busyWeeks(entries) {
  const weeks = new Set();
  for (const entry of entries) {
    if (entry.section === "ideas" && !entry.shelved) weeks.add(weekStart(entry.targetDate));
    if (entry.section === "plan") entry.active.forEach((slot) => weeks.add(weekStart(slot.date)));
  }
  return weeks;
}

// Ритм канала: одна тема в неделю, выход по средам.
export function nextFreeWednesday(entries, today, ignoreId = "") {
  const taken = busyWeeks(entries.filter((entry) => entry.post.id !== ignoreId));
  let date = addDays(today, ((2 - weekday(today) + 7) % 7) || 7);
  for (let i = 0; i < 104 && taken.has(weekStart(date)); i += 1) date = addDays(date, 7);
  return date;
}

export function weeksCovered(entries, today, count = 4) {
  const taken = busyWeeks(entries);
  const first = weekStart(today);
  return Array.from({ length: count }, (_, index) => taken.has(addDays(first, index * 7)));
}
