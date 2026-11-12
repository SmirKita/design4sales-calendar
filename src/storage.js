import { telegramPlan, reviewWindows } from "./data/telegramPlan.js";
import { restorePlannedPlacements } from "./publicationActions.js";
import { SETTINGS_KEY } from "./publicationSchedule.js";

export const STORAGE_KEY = "design4sales-telegram-calendar-v4";
export const STORAGE_SCHEMA_VERSION = 5;
export const LEGACY_STORAGE_KEYS = ["design4sales-telegram-calendar-v3", "design4sales-telegram-calendar-v2"];

const DATA_UPDATES_KEY = "@design4sales/data-updates";
const COMPLETED_PHOTO_UPDATE = "2026-11-11-photo-post-completed";
const EMPTY_RESULTS_UPDATE = "2026-11-11-remove-old-empty-results";
const OLD_EMPTY_RESULT_IDS = [
  "2026-10-06-photo-not-ready-for-ads",
  "2026-10-20-specific-feedback",
  "2026-10-30-how-many-variants",
];
const hasStoredValue = (value) => value !== null && value !== undefined && String(value).trim() !== "";

const CONFIRMED_PHOTO_ID = "2026-10-27-photo-photoshop-ai";

const idMigrations = { "2026-09-12-remove-first": "2026-09-11-remove-first" };
const knownKeys = new Set([
  ...telegramPlan.map((post) => post.id),
  ...reviewWindows.map((window) => "note-" + window.id),
  ...Object.keys(idMigrations),
  SETTINGS_KEY,
  DATA_UPDATES_KEY,
]);

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
  if (!next[DATA_UPDATES_KEY]?.[COMPLETED_PHOTO_UPDATE]) {
    const post = next[CONFIRMED_PHOTO_ID];
    const placements = Object.fromEntries(Object.entries(post.placements || {}).map(([id, slot]) => {
      if (slot.status === "published") return [id, slot];
      return [id, { ...slot, enabled: false, reminder: false,
        status: id === "tg" ? "published" : "cancelled" }];
    }));
    next[CONFIRMED_PHOTO_ID] = {
      ...post,
      phases: { ...post.phases, preparation: "ready", publication: "published" },
      placements,
      publicationConfirmation: { confirmedOn: "2026-11-11", source: "user", allPlacementsClosed: true },
    };
    next[DATA_UPDATES_KEY] = { ...next[DATA_UPDATES_KEY], [COMPLETED_PHOTO_UPDATE]: true };
  }
  if (!next[DATA_UPDATES_KEY]?.[EMPTY_RESULTS_UPDATE]) {
    for (const id of OLD_EMPTY_RESULT_IDS) {
      const record = next[id];
      const published = record.phases?.publication === "published"
        || Object.values(record.placements || {}).some((slot) => slot.status === "published");
      const hasResults = Object.values(record.metrics || {}).some(hasStoredValue)
        || Object.values(record.links || {}).some(hasStoredValue);
      if (published && !hasResults) {
        next[id] = { ...record, trackingExcluded: { on: "2026-11-11", reason: "old-without-results" } };
      }
    }
    next[DATA_UPDATES_KEY] = { ...next[DATA_UPDATES_KEY], [EMPTY_RESULTS_UPDATE]: true };
  }
  const repairKey = "2026-11-12-restore-accidental-packaging-publication";
  if (!next[DATA_UPDATES_KEY]?.[repairKey]) {
    const id = "2026-11-11-packaging-shelf";
    const record = next[id];
    const slots = Object.values(record.placements || {}).filter((slot) => slot.enabled);
    // Restore only the exact bulk click reported by the user. Later genuine
    // publications or manually corrected schedules must not be reopened.
    if (slots.length === 4 && slots.every((slot) => slot.status === "published"
      && slot.publishedAt === "2026-11-12T13:15:27.030Z")) {
      const restored = restorePlannedPlacements(record);
      // The user also confirmed VK should move from Nov 12 to Nov 13 at 19:00.
      if (restored.placements.vk?.date === "2026-11-12") {
        restored.placements.vk = { ...restored.placements.vk, date: "2026-11-13" };
      }
      next[id] = restored;
    }
    next[DATA_UPDATES_KEY] = { ...next[DATA_UPDATES_KEY], [repairKey]: true };
  }
  return next;
}

export function readBackup(value, { fromBrowser = false } = {}) {
  const raw = value && Object.hasOwn(value, "state") ? value.state : value;
  const version = value?.schemaVersion ?? value?.version;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || (version != null && (![2, 3, 4, 5].includes(version)))
    || Object.values(raw).some((record) => !record || typeof record !== "object" || Array.isArray(record))
    || (!Object.keys(raw).length && version == null)) {
    throw new Error("Неверный формат резервной копии");
  }
  const keys = Object.keys(raw);
  if (!fromBrowser && keys.length && !keys.some((key) => knownKeys.has(key)
    || /^20\d{2}-\d{2}-\d{2}-[a-z0-9-]+$/.test(key)
    || (/^user-[a-f0-9]{32}$/.test(key) && raw[key].customPost))) {
    throw new Error("В файле нет записей календаря Design4Sales");
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
      const state = readBackup(JSON.parse(raw), { fromBrowser: true });
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
