import { telegramPlan } from "./data/telegramPlan.js";

export const STORAGE_KEY = "design4sales-telegram-calendar-v3";
export const STORAGE_SCHEMA_VERSION = 3;
export const LEGACY_STORAGE_KEYS = ["design4sales-telegram-calendar-v2"];

const idMigrations = {
  "2026-09-12-remove-first": "2026-09-11-remove-first",
};

export function normalizeState(value) {
  const source = value?.state && typeof value.state === "object" ? value.state : value;
  const next = source && typeof source === "object" && !Array.isArray(source) ? { ...source } : {};

  Object.entries(idMigrations).forEach(([oldId, newId]) => {
    if (next[oldId] && !next[newId]) next[newId] = { ...next[oldId] };
  });

  telegramPlan.forEach((post) => {
    if (post.defaultStatus === "published") {
      next[post.id] = { ...(next[post.id] || {}), status: "published" };
    }
  });

  return next;
}

export function saveCalendarState(state, storage = window.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_SCHEMA_VERSION, state }));
}

export function loadCalendarState(storage = window.localStorage) {
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];

  for (const key of keys) {
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const state = normalizeState(JSON.parse(raw));
      saveCalendarState(state, storage);
      return state;
    } catch {
      // Повреждённый ключ не должен мешать загрузить предыдущую версию данных.
    }
  }

  const state = normalizeState({});
  saveCalendarState(state, storage);
  return state;
}
