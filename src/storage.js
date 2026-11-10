import { telegramPlan } from "./data/telegramPlan.js";

export const STORAGE_KEY = "design4sales-telegram-calendar-v4";
export const STORAGE_SCHEMA_VERSION = 5;
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

export function readBackup(value) {
  const raw = value && Object.hasOwn(value, "state") ? value.state : value;
  const version = value?.schemaVersion ?? value?.version;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || (version != null && (![2, 3, 4, 5].includes(version)))
    || Object.values(raw).some((record) => !record || typeof record !== "object" || Array.isArray(record))
    || (!Object.keys(raw).length && version == null)) {
    throw new Error("Неверный формат резервной копии");
  }
  return normalizeState(value);
}

export function saveCalendarState(state, storage = window.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_SCHEMA_VERSION, state }));
}

export function loadCalendarState(storage = window.localStorage) {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const state = readBackup(JSON.parse(raw));
      if (key !== STORAGE_KEY && !storage.getItem(STORAGE_KEY)) {
        try { saveCalendarState(state, storage); } catch { /* The legacy copy is still readable. */ }
      }
      return state;
    } catch {
      // Повреждённый ключ не должен блокировать предыдущую версию данных.
    }
  }
  return normalizeState({});
}
