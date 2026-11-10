import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { mac, nativeCall } from "./macBridge.js";

async function start() {
  const initial = mac ? await nativeCall("load").catch((error) => ({ error: error.message })) : null;
  createRoot(document.getElementById("root")).render(
    <React.StrictMode><App initial={initial} /></React.StrictMode>,
  );
}
start();
