import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { telegramPlan } from "./data/telegramPlan.js";
import { makeManifest, userPosts } from "./publicationSchedule.js";
import { normalizeState } from "./storage.js";
import { mac, nativeCall } from "./macBridge.js";

async function start() {
  let initial = mac ? await nativeCall("load").catch((error) => ({ error: error.message })) : null;
  if (mac && !initial.error) {
    const state = normalizeState(initial.state);
    try {
      const prepared = await nativeCall("prepare", {
        state,
        manifest: makeManifest([...telegramPlan, ...userPosts(state)], state),
        revision: initial.revision + 1,
        expectedRevision: initial.revision,
      });
      initial = { ...initial, ...prepared, state };
    } catch (error) {
      initial = { ...initial, error: "Не удалось подготовить сохранённый план. " + error.message };
    }
  }
  createRoot(document.getElementById("root")).render(
    <React.StrictMode><App initial={initial} /></React.StrictMode>,
  );
}
start();
