import { isDate, moscowInstant, scheduledSlots } from "./publicationSchedule.js";

export function publicationEntry(post, record, settings, now) {
  const slots = scheduledSlots(post, record, settings);
  const active = slots.filter((slot) => !["published", "cancelled"].includes(slot.status));
  let section = "ideas";
  if (active.length) section = "plan";
  else if (slots.length || post.cycle === "archive" || record.phases.publication === "published") section = "archive";
  const future = active.map((slot) => moscowInstant(slot.date, slot.time)).filter((time) => time > now);
  const targetDate = isDate(record.targetDate) ? record.targetDate : post.date;
  return { post, record, slots, active, section, targetDate, next: future.length ? Math.min(...future) : Infinity };
}

export function planningTimeline(entries, today) {
  return entries.flatMap((entry) => {
    if (entry.section === "ideas") {
      return entry.targetDate >= today ? [{ id: entry.post.id, post: entry.post, date: entry.targetDate, tentative: true }] : [];
    }
    if (entry.section !== "plan") return [];
    return entry.active.filter((slot) => slot.date >= today).map((slot) => ({
      id: entry.post.id + ":" + slot.platform.id, post: entry.post,
      date: slot.date, time: slot.time, platform: slot.platform.name, tentative: false,
    }));
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "23:59").localeCompare(b.time || "23:59") || a.id.localeCompare(b.id));
}
