export const mac = globalThis.webkit?.messageHandlers?.calendar;

export function nativeCall(action, payload = {}) {
  return mac.postMessage({ action, ...payload });
}

export function downloadJSON(value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = "Design4Sales_calendar_progress.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
