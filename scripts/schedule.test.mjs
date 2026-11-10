import assert from "node:assert/strict";
import test from "node:test";
import { telegramPlan } from "../src/data/telegramPlan.js";
import { loadCalendarState, normalizeState, readBackup, saveCalendarState, STORAGE_KEY } from "../src/storage.js";
import { makeManifest, moscowInstant, todayInMoscow, PLATFORMS, SETTINGS_KEY, userPosts } from "../src/publicationSchedule.js";

const post = telegramPlan.find((row) => row.id === "2026-11-11-packaging-shelf");
const id = (platform) => post.id + ":" + platform;
const morning = "morning:2026-11-11";
const rows = (state, posts = telegramPlan) => new Map(makeManifest(posts, state).reminders.map((row) => [row.id, row]));
const enabled = { enabled: true, reminder: true };
const plan = (placements, settings) => normalizeState({
  [post.id]: { placements },
  [SETTINGS_KEY]: settings || {},
});

test("legacy published archive and preliminary directions do not schedule a single task", () => {
  assert.equal(rows(normalizeState({})).size, 0);
  const archive = telegramPlan.find((row) => row.cycle === "archive");
  assert.equal(rows(normalizeState({ [archive.id]: { placements: { tg: enabled } } })).size, 0);
  assert.equal(rows(plan({ tg: { enabled: true } })).size, 0);
});

test("one summary per occupied day, independent platform alarms and Moscow instants", () => {
  const result = rows(plan({ tg: enabled, vk: { ...enabled, lead: 0 } }));
  assert.equal(result.size, 3);
  assert.equal(result.get(id("tg")).due, "2026-11-11T07:30:00.000Z");
  assert.equal(result.get(id("tg")).alarm, "2026-11-11T07:15:00.000Z");
  assert.equal(result.get(id("vk")).alarm, "2026-11-11T16:00:00.000Z");
  assert.equal(result.get(morning).alarm, "2026-11-11T05:30:00.000Z");
  assert.match(result.get(morning).notes, /^10:30 — Telegram: .*\n19:00 — ВКонтакте: /);
  assert.equal(todayInMoscow(new Date("2026-11-10T22:59:00Z")), "2026-11-11");
  assert.equal(new Date(moscowInstant("2026-11-11", "00:05")).toISOString(), "2026-11-10T21:05:00.000Z");
  assert.equal(Number.isNaN(moscowInstant("2026-11-31", "12:00")), true);
});

test("moving a single platform retains its ID and updates the two summaries", () => {
  const result = rows(plan({ tg: enabled, vk: { ...enabled, date: "2026-11-12", mode: "custom", time: "18:25", status: "moved", lead: 30 } }));
  assert.equal(result.get(id("tg")).due, "2026-11-11T07:30:00.000Z");
  assert.equal(result.get(id("vk")).due, "2026-11-12T15:25:00.000Z");
  assert.equal(result.get(id("vk")).alarm, "2026-11-12T14:55:00.000Z");
  assert.doesNotMatch(result.get(morning).notes, /ВКонтакте/);
  assert.match(result.get("morning:2026-11-12").notes, /^18:25 — ВКонтакте/);
});

test("cancel, publish, disable one and disable all remove the correct alarms", () => {
  for (const patch of [{ enabled: false }, { reminder: false }, { status: "cancelled" }, { status: "published" }]) {
    const result = rows(plan({ tg: { ...enabled, ...patch }, vk: enabled }));
    assert.deepEqual([...result.keys()], [morning, id("vk")]);
  }
  assert.equal(rows(plan({ tg: enabled }, { enabled: false })).size, 0);
  assert.equal(rows(plan({ tg: enabled }, { morning: false })).size, 1);
});

test("optional measurement reminders start after actual publication, with independent switches", () => {
  const state = plan({ tg: { ...enabled, status: "published", publishedAt: "2026-11-12T05:00:00.000Z", v24: true, v72: true } });
  const result = rows(state);
  assert.deepEqual([...result.keys()], [id("tg") + ":v24", id("tg") + ":v72"]);
  assert.equal(result.get(id("tg") + ":v24").due, "2026-11-13T05:00:00.000Z");
  assert.equal(result.get(id("tg") + ":v72").due, "2026-11-15T05:00:00.000Z");
});

test("custom publication, preferences and existing notes survive backup/import and reload", () => {
  const key = "user-" + "a".repeat(32);
  const state = normalizeState({
    [key]: { customPost: { title: "Новая тема", date: "2026-11-14" }, placements: { ig: { ...enabled, format: "Reels" } } },
    [SETTINGS_KEY]: { lead: 5, platforms: { ig: { mode: "fixed", fixed: "11:47" } } },
    [post.id]: { resultNote: "сохранить" },
  });
  const values = new Map();
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  saveCalendarState(state, storage);
  const restored = readBackup(JSON.parse(values.get(STORAGE_KEY)));
  assert.deepEqual(loadCalendarState(storage), restored);
  assert.equal(restored[post.id].resultNote, "сохранить");
  assert.equal(restored[key].placements.ig.format, "Reels");
  assert.equal(rows(restored, userPosts(restored)).get(key + ":ig").alarm, "2026-11-14T08:42:00.000Z");
  assert.throws(() => readBackup({ message: "not a backup" }));
  assert.throws(() => readBackup({ schemaVersion: 4, state: { unrelated: {} } }));
  const archived = telegramPlan.find((row) => row.cycle === "archive");
  const legacy = readBackup({ schemaVersion: 4, state: {
    [archived.id]: { phases: { publication: "published", distribution: "done" }, metrics: { v24: 41, v72: 52 },
      resultNote: "итог", links: { post: "https://example.com" } },
    "2026-10-02-author-answer": { resultNote: "история" },
  } });
  assert.equal(legacy[archived.id].metrics.v72, 52);
  assert.equal(legacy[archived.id].phases.distribution, "done");
  assert.equal(legacy[archived.id].resultNote, "итог");
  assert.equal(legacy["2026-10-02-author-answer"].resultNote, "история");
  assert.equal(rows(legacy).size, 0);
  assert.throws(() => readBackup({ schemaVersion: 99, state: {} }));
});

test("all eight placements keep separate hours and switches after reopening the saved plan", () => {
  const placements = Object.fromEntries(PLATFORMS.map((platform, index) => [
    platform.id, { ...enabled, mode: "custom", time: `1${index}:42`, reminder: index % 2 === 0 },
  ]));
  const state = plan(placements, { morning: false, lead: 30 });
  const values = new Map();
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  saveCalendarState(state, storage);
  const reloaded = loadCalendarState(storage);
  assert.deepEqual(reloaded[post.id].placements, placements);
  assert.equal(reloaded[SETTINGS_KEY].lead, 30);
  const actual = rows(reloaded);
  assert.deepEqual([...actual.keys()], PLATFORMS.filter((_, index) => index % 2 === 0).map((platform) => id(platform.id)));
  assert.equal(actual.get(id("tg")).alarm, "2026-11-11T07:12:00.000Z");
});
