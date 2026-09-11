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

assert.equal(telegramPlan.length, 14);
assert.deepEqual(
  telegramPlan.filter((post) => post.defaultStatus === "published").map((post) => [post.date, post.title]),
  publishedExpected,
);
assert.deepEqual([...telegramPlan].map((post) => post.date), [...telegramPlan].map((post) => post.date).sort());
assert.equal(new Set(telegramPlan.map((post) => post.id)).size, telegramPlan.length);
assert.equal(new Set(telegramPlan.map((post) => post.title)).size, telegramPlan.length);
assert.deepEqual(
  telegramPlan.find((post) => post.defaultStatus !== "published") && telegramPlan.find((post) => post.defaultStatus !== "published").title,
  "Клиент просит добавить ещё одну плашку. Что делать?",
);
assert.equal(telegramPlan.find((post) => post.defaultStatus !== "published")?.date, "2026-09-15");
assert.equal(telegramBacklog.length, 8);
assert.equal(telegramBacklog.some((idea) => telegramPlan.some((post) => post.title === idea.title)), false);

const values = new Map([
  ["design4sales-telegram-calendar-v2", JSON.stringify({
    "2026-08-22-channel-reset": { status: "planned", note: "сохранить заметку", metrics: { views: "321" } },
    "2026-09-12-remove-first": { status: "planned", note: "заметка к опросу" },
    "legacy-idea": { note: "не удалять" },
  })],
]);
const storage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
};
const migrated = loadCalendarState(storage);

assert.equal(migrated["2026-08-22-channel-reset"].status, "published");
assert.equal(migrated["2026-08-22-channel-reset"].note, "сохранить заметку");
assert.equal(migrated["2026-08-22-channel-reset"].metrics.views, "321");
assert.equal(migrated["2026-09-11-remove-first"].status, "published");
assert.equal(migrated["2026-09-11-remove-first"].note, "заметка к опросу");
assert.equal(migrated["legacy-idea"].note, "не удалять");
assert.equal(JSON.parse(values.get(STORAGE_KEY)).version, STORAGE_SCHEMA_VERSION);

console.log("Calendar data and localStorage migration checks passed.");
