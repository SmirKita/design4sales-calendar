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
const october = active.filter((post) => post.date.startsWith("2026-10"));
assert.deepEqual(archived.map((post) => [post.date, post.title]), publishedExpected);
assert.equal(archived.every((post) => post.defaultPhases.publication === "published"), true);
assert.equal(active[0].date, "2026-10-01");
assert.deepEqual(october.map((post) => post.date), [
  "2026-10-01",
  "2026-10-03",
  "2026-10-06",
  "2026-10-09",
  "2026-10-13",
  "2026-10-16",
  "2026-10-20",
  "2026-10-23",
  "2026-10-27",
  "2026-10-30",
]);
assert.equal(october.length, 10);
assert.equal(october.every((post) => post.kind === "publication"), true);
assert.equal(active.some((post) => post.title.includes("Авторский ответ") || post.title.includes("Что убираем первым?")), false);
assert.equal(archived.some((post) => post.title === "Что убираем первым?"), true);
for (const week of [1, 2, 3, 4, 5]) assert.equal(october.filter((post) => post.week === week).length, 2);
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

values.set(STORAGE_KEY, JSON.stringify({
  version: STORAGE_SCHEMA_VERSION,
  state: {
    "2026-10-02-author-answer": {
      phases: { preparation: "ready", publication: "planned", distribution: "planned", measurement: "planned" },
      resultNote: "сохранить скрытые данные удалённой карточки",
    },
  },
}));
const preservedCurrentState = loadCalendarState(storage);
assert.equal(preservedCurrentState["2026-10-02-author-answer"].phases.preparation, "ready");
assert.equal(preservedCurrentState["2026-10-02-author-answer"].resultNote, "сохранить скрытые данные удалённой карточки");

console.log(`Calendar checks passed: ${archived.length} published archive entries, ${active.length} active entries, schema v${STORAGE_SCHEMA_VERSION}.`);
