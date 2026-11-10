export const MOSCOW = "Europe/Moscow";
export const SETTINGS_KEY = "@design4sales/schedule";
export const PLATFORMS = [
  { id: "tg", name: "Telegram", icon: "➤", format: "Пост", primary: "10:30", spare: "19:30" },
  { id: "vk", name: "ВКонтакте", icon: "ВК", format: "Пост", primary: "19:00", spare: "13:00" },
  { id: "setka", name: "Сетка", icon: "▦", format: "Пост", primary: "10:00", spare: "14:00" },
  { id: "ig", name: "Instagram", icon: "◎", format: "Публикация", primary: "12:00", spare: "19:00" },
  { id: "dzen", name: "Дзен", icon: "✦", format: "Статья", primary: "09:00", spare: "19:00" },
  { id: "tg-story", name: "Telegram Stories", icon: "➤", format: "Stories", primary: "18:30", spare: "13:00" },
  { id: "vk-story", name: "ВК Stories", icon: "ВК", format: "Stories", primary: "20:00", spare: "13:00" },
  { id: "ig-story", name: "Instagram Stories", icon: "◎", format: "Stories", primary: "19:30", spare: "10:00" },
];
export const STATUSES = [
  ["planned", "Запланировано"], ["ready", "Готово"], ["published", "Опубликовано"],
  ["moved", "Перенесено"], ["cancelled", "Отменено"],
];
export const LEADS = [0, 5, 15, 30, 60];
export const FORMATS = ["Публикация", "Карусель", "Reels"];
export const MODES = [["primary", "Рекомендуемое"], ["spare", "Запасное"], ["fixed", "Постоянное"]];
const minute = 60_000;
const validId = /^[a-z0-9][a-z0-9-]{0,95}$/;
const clock = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const calendarDate = /^20[2-9][0-9]-\d{2}-\d{2}$/;
const moscowDay = new Intl.DateTimeFormat("sv-SE", { timeZone: MOSCOW, year: "numeric", month: "2-digit", day: "2-digit" });

export function todayInMoscow(now = new Date()) {
  return moscowDay.format(now);
}

export function isDate(value) {
  if (typeof value !== "string" || !calendarDate.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}

export function moscowInstant(date, time) {
  // Since 2014 Moscow has used UTC+03 without seasonal changes; dates here start in 2020.
  return isDate(date) && typeof time === "string" && clock.test(time)
    ? Date.parse(date + "T" + time + ":00+03:00") : NaN;
}

export function settingsFor(state) {
  const raw = state[SETTINGS_KEY] || {};
  return {
    enabled: raw.enabled !== false,
    morning: raw.morning !== false,
    lead: LEADS.includes(raw.lead) ? raw.lead : 15,
    platforms: Object.fromEntries(PLATFORMS.map((p) => {
      const saved = raw.platforms?.[p.id] || {};
      return [p.id, {
        mode: MODES.some(([key]) => key === saved.mode) ? saved.mode : "primary",
        primary: clock.test(saved.primary) ? saved.primary : p.primary,
        spare: clock.test(saved.spare) ? saved.spare : p.spare,
        fixed: clock.test(saved.fixed) ? saved.fixed : p.primary,
      }];
    })),
  };
}

export function platformSlot(post, record, platform, settings) {
  const saved = record.placements?.[platform.id] || {};
  const prefs = settings.platforms[platform.id];
  const mode = [...MODES.map(([key]) => key), "custom"].includes(saved.mode) ? saved.mode : "default";
  const time = mode === "custom" && clock.test(saved.time) ? saved.time : prefs[mode === "custom" || mode === "default" ? prefs.mode : mode];
  return {
    enabled: saved.enabled === true,
    date: isDate(saved.date) ? saved.date : post.date,
    time,
    mode,
    status: STATUSES.some(([key]) => key === saved.status) ? saved.status
      : platform.id === "tg" && record.phases?.publication === "published" ? "published" : "planned",
    format: platform.id === "ig" && FORMATS.includes(saved.format) ? saved.format : platform.format,
    reminder: saved.reminder === true,
    lead: LEADS.includes(saved.lead) ? saved.lead : null,
    v24: saved.v24 === true,
    v72: saved.v72 === true,
    publishedAt: typeof saved.publishedAt === "string" ? saved.publishedAt : null,
  };
}

export function isSchedulable(post) {
  return post.kind === "publication" && post.cycle !== "archive";
}

export function scheduledSlots(post, record, settings) {
  if (!isSchedulable(post)) return [];
  return PLATFORMS.map((platform) => ({ platform, ...platformSlot(post, record, platform, settings) })).filter((slot) => slot.enabled);
}

export function userPosts(state) {
  return Object.entries(state).flatMap(([id, record]) => {
    const meta = record?.customPost;
    if (!/^user-[a-f0-9]{32}$/.test(id) || !meta || !isDate(meta.date) || typeof meta.title !== "string" || !meta.title.trim() || meta.title.length > 180) return [];
    return [{
      id, date: meta.date, title: meta.title, week: 0, cycle: "oct-dec", kind: "publication", type: "practical",
      thought: meta.thought || "", audience: "—", mainPlatform: "По расписанию", timeBudget: "—",
      afterPublication: ["Сохранить ссылку и проверить результат."],
      defaultPhases: { preparation: "planned", publication: "planned", distribution: "planned", measurement: "planned" },
    }];
  });
}

export function makeManifest(posts, state) {
  const settings = settingsFor(state);
  const reminders = [];
  if (!settings.enabled) return { version: 1, reminders };
  const mornings = new Map();
  const add = (id, title, notes, due, alarm = due) => {
    if (Number.isFinite(due) && Number.isFinite(alarm)) reminders.push({
      id, title, notes, due: new Date(due).toISOString(), alarm: new Date(alarm).toISOString(),
    });
  };
  for (const post of posts) {
    if (!validId.test(post.id)) continue;
    for (const slot of scheduledSlots(post, state[post.id] || {}, settings)) {
      if (!slot.reminder || slot.status === "cancelled") continue;
      const platform = slot.platform.name;
      const id = post.id + ":" + slot.platform.id;
      const due = moscowInstant(slot.date, slot.time);
      if (slot.status === "published") {
        const actual = Date.parse(slot.publishedAt);
        if (!Number.isFinite(actual)) continue;
        for (const hours of [24, 72]) if (slot["v" + hours]) {
          add(id + ":v" + hours, `Статистика ${hours} ч · ${platform} | ${post.title}`, "Сохрани результаты публикации в карточке календаря.", Math.ceil(actual / minute) * minute + hours * 60 * minute);
        }
        continue;
      }
      const lead = slot.lead ?? settings.lead;
      add(id, `${platform} | ${post.title}`, `Проверь текст, визуал и ссылку. Выход: ${slot.date}, ${slot.time} МСК.`, due, due - lead * minute);
      if (settings.morning && Number.isFinite(due)) {
        const day = mornings.get(slot.date) || [];
        day.push(`${slot.time} — ${platform}: ${post.title}`);
        mornings.set(slot.date, day);
      }
    }
  }
  for (const [date, lines] of mornings) {
    add("morning:" + date, "Сегодня публикации Design4Sales", lines.sort().join("\n"), moscowInstant(date, "08:30"));
  }
  return { version: 1, reminders: reminders.sort((a, b) => a.alarm.localeCompare(b.alarm) || a.id.localeCompare(b.id)) };
}
