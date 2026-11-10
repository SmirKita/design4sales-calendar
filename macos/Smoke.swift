#if D4S_SMOKE
import AppKit
import WebKit

extension CalendarApp {
    func runSmoke() {
        guard preview else { return }
        smokePass += 1
        let step = smokePass
        Task {
            do {
                let result = try await web.callAsyncJavaScript("""
                    const wait = async (get) => {
                      for (let i = 0; i < 100; i++) {
                        const value = get();
                        if (value) return value;
                        await new Promise(resolve => setTimeout(resolve, 30));
                      }
                      throw new Error("Not found: " + get);
                    };
                    const article = await wait(() => document.querySelector("#post-2026-11-11-packaging-shelf"));
                    const editor = article.querySelector(".placementEditor");
                    editor.open = true;
                    const telegram = editor.querySelector("fieldset");
                    if (step === 1) {
                      telegram.querySelector('input[type=checkbox]').click();
                      const next = await wait(() => telegram.querySelectorAll('input[type=checkbox]')[1]);
                      next.click();
                      await wait(() => editor.innerText.includes("Apple: задачи обновлены"));
                    }
                    const active = [...telegram.querySelectorAll('input[type=checkbox]')].slice(0, 2).every(box => box.checked);
                    return { active, display: getComputedStyle(article).display, pills: article.querySelector(".schedulePills")?.innerText || "", status: editor.innerText.split("\\n").slice(-3) };
                    """, arguments: ["step": step], in: nil, contentWorld: .page)
                let details = result as? [String: Any] ?? [:]
                let saved = try storage.read()
                let ids = saved?.manifest.reminders.map(\.id) ?? []
                guard details["active"] as? Bool == true, details["display"] as? String == "grid",
                      (details["pills"] as? String)?.contains("10:30") == true,
                      ids.contains("2026-11-11-packaging-shelf:tg"), ids.contains("morning:2026-11-11") else {
                    throw CalendarIssue("UI and persisted manifest did not agree. Step \(step), UI \(details), tasks \(ids).")
                }
                if step == 1 { web.reload(); return }
                try? FileManager.default.removeItem(at: storage.directory)
                print("WKWebView smoke passed: bundled styles, edit → native save → persisted manifest → reload.")
                exit(0)
            } catch {
                print("WKWebView smoke failed: \(error)")
                exit(1)
            }
        }
    }
}
#endif
