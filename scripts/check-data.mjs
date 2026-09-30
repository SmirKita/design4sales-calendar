import assert from "node:assert/strict";
import { telegramBacklog } from "../src/data/telegramBacklog.js";
import { telegramPlan } from "../src/data/telegramPlan.js";
import { loadCalendarState, STORAGE_KEY, STORAGE_SCHEMA_VERSION } from "../src/storage.js";

const publishedExpected = [
  ["2026-08-22", "Выбирай формат"],
  ["2026-08-27", "Дизайн изнутри"],
  ["2026-08-31", "Каждый макет снова с нуля?"],
  ["2026-09-07", "Один бизнес. Два впечатления"],
  ["2026-09-11", "Что убираем первым?"],
];

const archived = telegramPlan.filter((post) => post.cycle === "archive");
const active = telegramPlan.filter((post) => post.cycle === "oct-dec");
assert.deepEqual(archived.map((post) => [post.date, post.title]), publishedExpected);
assert.equal(archived.every((post) => post.defaultPhases.publication === "published"), true);
assert.equal(active[0].date, "2026-10-01");
assert.deepEqual(active.slice(0, 7).map((post) => post.date), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
assert.equal(active.some((post) => post.title.includes("Авторский ответ")), true);
assert.equal(active.some((post) => post.date.startsWith("2026-11")), true);
assert.equal(active.some((post) => post.date.startsWith("2026-12")), true);
assert.equal(new Set(telegramPlan.map((post) => post.id)).size, telegramPlan.length);
assert.deepEqual(telegramPlan.map((post) => post.date), [...telegramPlan].map((post) => post.date).sort());

for (const post of active) {
  for (const field of ["audience", "thought", "textVisual", "mainPlatform", "timeBudget", "checks"]) assert.ok(post[field], `${post.id}: ${field}`);
  assert.ok(Array.isArray(post.afterPublication) && post.afterPublication.length > 0, `${post.id}: afterPublication`);
  assert.deepEqual(Object.keys(post.defaultPhases).sort(), ["distribution", "measurement", "preparation", "publication"]);
}

assert.equal(telegramBacklog.length, 8);
assert.equal(telegramBacklog.every((idea) => idea.source && idea.title), true);

const values = new Map([
  ["design4sales-telegram-calendar-v3", JSON.stringify({
    "2026-08-22-channel-reset": { status: "planned", note: "сохранить заметку", metrics: { views: "321", comments: "4" } },
    "2026-09-12-remove-first": { status: "planned", note: "заметка к опросу" },
    "legacy-idea": { note: "не удалять" },
  })],
]);
const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
const migrated = loadCalendarState(storage);

assert.equal(migrated["2026-08-22-channel-reset"].phases.publication, "published");
assert.equal(migrated["2026-08-22-channel-reset"].note, "сохранить заметку");
assert.equal(migrated["2026-08-22-channel-reset"].metrics.v72, "321");
assert.equal(migrated["2026-08-22-channel-reset"].metrics.replies, "4");
assert.equal(migrated["2026-09-11-remove-first"].phases.publication, "published");
assert.equal(migrated["legacy-idea"].note, "не удалять");
assert.equal(JSON.parse(values.get(STORAGE_KEY)).version, STORAGE_SCHEMA_VERSION);

console.log(`Calendar checks passed: ${archived.length} published archive entries, ${active.length} active entries, schema v${STORAGE_SCHEMA_VERSION}.`);
