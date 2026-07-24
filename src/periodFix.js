const replacements = new Map([
  ["Рабочий дашборд публикаций на 27.04.2026 – 25.07.2026", "Рабочий дашборд публикаций на 28.07.2026 – 24.10.2026"],
  ["27.04.2026 — 25.07.2026", "28.07.2026 — 24.10.2026"],
]);

function updatePeriodLabels() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const replacement = replacements.get(node.nodeValue.trim());
    if (replacement) node.nodeValue = replacement;
  }
}

const observer = new MutationObserver(updatePeriodLabels);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("DOMContentLoaded", updatePeriodLabels);
updatePeriodLabels();
