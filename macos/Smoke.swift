#if D4S_SMOKE
import AppKit
import WebKit

extension CalendarApp {
    func runSmoke() {
        guard preview else { return }
        smokePass += 1
        guard smokePass == 1 else { return }
        let stage = ProcessInfo.processInfo.environment["D4S_SMOKE_STAGE"] ?? "create"
        Task {
            do {
                let result = try await web.callAsyncJavaScript("""
                    const wait = async (get) => {
                      for (let i = 0; i < 100; i++) {
                        const value = await get();
                        if (value) return value;
                        await new Promise(resolve => setTimeout(resolve, 30));
                      }
                      throw new Error("Not found: " + get);
                    };
                    const bridge = window.webkit.messageHandlers.calendar;
                    const load = () => bridge.postMessage({ action: "load" });
                    const archiveID = "2026-08-22-channel-reset";
                    const topic = "Проверка WebKit";
                    const checkPlan = (saved, expectLead) => {
                      const entry = Object.entries(saved.state).find(([id, row]) => row.customPost?.title === topic);
                      if (!entry) return false;
                      const [id, row] = entry;
                      const archive = saved.state[archiveID];
                      return archive?.metrics?.v72 === 52 && archive.resultNote === "Архивная заметка"
                        && row.phases?.preparation === "ready" && row.placements?.tg?.time === "11:42" && row.placements.tg.reminder === true
                        && (expectLead === undefined || row.placements.tg.lead === expectLead)
                        && id.startsWith("user-");
                    };
                    await wait(() => document.querySelector(".viewTabs"));
                    if (stage === "create") {
                      const source = { schemaVersion: 4, state: {
                        [archiveID]: { metrics: { v72: 52 }, resultNote: "Архивная заметка", phases: { publication: "published" } }
                      }};
                      const transfer = new DataTransfer();
                      transfer.items.add(new File([JSON.stringify(source)], "legacy-v4.json", { type: "application/json" }));
                      const input = document.querySelector('input[type="file"]');
                      window.confirm = () => true;
                      input.files = transfer.files;
                      input.dispatchEvent(new Event("change", { bubbles: true }));
                      await wait(async () => (await load()).state[archiveID]?.metrics?.v72 === 52);
                      [...document.querySelectorAll(".appHeader button")].find(button => button.textContent.includes("Новая публикация")).click();
                      const form = await wait(() => document.querySelector("form.newPublication"));
                      form.elements.title.value = topic;
                      form.elements.date.value = "2027-02-20";
                      form.requestSubmit();
                      const article = await wait(() => [...document.querySelectorAll(".publicationCard")].find(node => node.querySelector("h3")?.textContent === topic));
                      if (article.querySelectorAll(".slot").length !== 1) throw new Error("Unexpected platform list");
                      article.querySelector(".readyToggle input").click();
                      const telegram = article.querySelector(".slot");
                      [...telegram.querySelectorAll("button")].find(button => button.textContent === "Изменить").click();
                      const time = await wait(() => telegram.querySelector('input[type="time"]'));
                      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(time, "11:42");
                      time.dispatchEvent(new Event("input", { bubbles: true }));
                      time.dispatchEvent(new Event("change", { bubbles: true }));
                      await wait(async () => checkPlan(await load()));
                      if (getComputedStyle(article).display !== "grid" || !article.querySelector(".slotTime").innerText.includes("11:42")) {
                        throw new Error("Missing style or visible time");
                      }
                      const lead = telegram.querySelector('select:has(option[value="60"])');
                      lead.value = "30";
                      lead.dispatchEvent(new Event("change", { bubbles: true }));
                      return true;
                    }
                    if (stage === "reopen") return checkPlan(await load(), 30);
                    const damaged = await load();
                    if (!damaged.error || !damaged.canRecover || !document.querySelector('[role="alert"]')) return false;
                    await bridge.postMessage({ action: "restoreLastGood" });
                    return checkPlan(await load());
                    """, arguments: ["stage": stage], in: nil, contentWorld: .page)
                guard result as? Bool == true else { throw CalendarIssue("Unexpected UI or saved state in stage \(stage).") }
                if stage != "create" {
                    let saved = try storage.read()
                    let ids = saved?.manifest.reminders.map(\.id) ?? []
                    guard ids.contains(where: { $0.hasPrefix("user-") && $0.hasSuffix(":tg") }),
                          ids.contains("morning:2027-02-20") else {
                        throw CalendarIssue("The saved Apple manifest did not match the plan.")
                    }
                }
                print("WKWebView smoke passed: \(stage)")
                if stage == "create" { NSApp.terminate(nil) }
                else { exit(0) }
            } catch {
                print("WKWebView smoke failed: \(error)")
                exit(1)
            }
        }
    }
}
#endif
