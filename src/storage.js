import { telegramPlan } from "./data/telegramPlan.js";

export const STORAGE_KEY = "design4sales-telegram-calendar-v4";
export const STORAGE_SCHEMA_VERSION = 4;
export const LEGACY_STORAGE_KEYS = ["design4sales-telegram-calendar-v3", "design4sales-telegram-calendar-v2"];

const idMigrations = { "2026-09-12-remove-first": "2026-09-11-remove-first" };

function phasesFromLegacy(status, defaults) {
  if (!status) return defaults;
  if (status === "published") return { ...defaults, preparation: "ready", publication: "published" };
  if (status === "moved") return { ...defaults, publication: "moved" };
  if (["materials", "draft", "visual", "ready"].includes(status)) return { ...defaults, preparation: status, publication: "planned" };
  return defaults;
}

export function normalizeState(value) {
  const source = value?.state && typeof value.state === "object" ? value.state : value;
  const next = source && typeof source === "object" && !Array.isArray(source) ? { ...source } : {};

  Object.entries(idMigrations).forEach(([oldId, newId]) => {
    if (next[oldId] && !next[newId]) next[newId] = { ...next[oldId] };
  });

  telegramPlan.forEach((post) => {
    const saved = next[post.id] || {};
    const phases = { ...post.defaultPhases, ...phasesFromLegacy(saved.status, post.defaultPhases), ...(saved.phases || {}) };
    if (post.cycle === "archive") phases.publication = "published";
    const legacyMetrics = saved.metrics || {};
    next[post.id] = {
      ...saved,
      phases,
      metrics: {
        ...legacyMetrics,
        v72: legacyMetrics.v72 ?? legacyMetrics.views ?? "",
        replies: legacyMetrics.replies ?? legacyMetrics.comments ?? "",
        clicks: legacyMetrics.clicks ?? "",
      },
    };
  });
  return next;
}

export function saveCalendarState(state, storage = window.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_SCHEMA_VERSION, state }));
}

export function loadCalendarState(storage = window.localStorage) {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const state = normalizeState(JSON.parse(raw));
      saveCalendarState(state, storage);
      return state;
    } catch {
      // Повреждённый ключ не должен блокировать предыдущую версию данных.
    }
  }
  const state = normalizeState({});
  saveCalendarState(state, storage);
  return state;
}
