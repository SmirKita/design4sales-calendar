import AppKit
import EventKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class CalendarApp: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    let preview = CommandLine.arguments.contains("--preview")
    lazy var storage = StateFile(directory: preview
        ? FileManager.default.temporaryDirectory.appendingPathComponent("d4s-preview-" + UUID().uuidString)
        : FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Design4Sales Calendar"))
    let apple = AppleReminders()
    var snapshot: Snapshot?
    var loadError: String?
    var window: NSWindow!
    var web: WKWebView!
    var entry: URL!
    var work: Task<Void, Never>?
    var busy = false
    var queued = false
    var isConnected = false
    var lastError: String?
    var lastSuccess: String?
    var syncedRevision: Int?
    var retry: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { snapshot = try storage.read() }
        catch { loadError = "Локальная копия не открылась. Восстанови файл в Finder. " + error.localizedDescription }
        if !preview {
            lastSuccess = UserDefaults.standard.string(forKey: "lastAppleWrite")
            syncedRevision = UserDefaults.standard.object(forKey: "syncedRevision") as? Int
        }

        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "calendar")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *), preview { web.isInspectable = true }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = preview ? "Design4Sales Calendar — проверка" : "Design4Sales Calendar"
        window.contentMinSize = NSSize(width: 360, height: 480)
        window.isReleasedWhenClosed = false
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)

        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Завершить Design4Sales Calendar", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Правка")
        for (title, selector, key) in [("Вырезать", "cut:", "x"), ("Копировать", "copy:", "c"), ("Вставить", "paste:", "v"), ("Выделить всё", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: NSSelectorFromString(selector), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
        NSApp.activate(ignoringOtherApps: true)

        entry = Bundle.main.resourceURL!.appendingPathComponent("Web/index.html")
        web.loadFileURL(entry, allowingReadAccessTo: entry.deletingLastPathComponent())
        schedule()
        retry = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.snapshot != nil, self.lastError != nil else { return }
                self.schedule()
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window?.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !preview, let snapshot, syncedRevision != snapshot.revision,
              EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { return .terminateNow }
        Task {
            let until = Date().addingTimeInterval(4)
            while busy && Date() < until { try? await Task.sleep(for: .milliseconds(100)) }
            if !busy && syncedRevision != self.snapshot?.revision { await runSync() }
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func status() -> [String: Any] {
        var info: [String: Any] = ["connected": isConnected]
        if let lastSuccess { info["lastSuccess"] = lastSuccess }
        if let syncedRevision { info["syncedRevision"] = syncedRevision }
        if let lastError { info["error"] = lastError }
        return info
    }

    func sendStatus() {
        guard let data = try? JSONSerialization.data(withJSONObject: status()),
              let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('d4s-sync', {detail: " + json + "}));")
    }

    func schedule() {
        guard snapshot != nil, loadError == nil, !preview,
              EKEventStore.authorizationStatus(for: .reminder) != .notDetermined else { return }
        work?.cancel()
        work = Task {
            try? await Task.sleep(for: .milliseconds(400))
            if !Task.isCancelled { await runSync() }
        }
    }

    func runSync() async {
        if busy { queued = true; return }
        guard let snapshot, !preview, loadError == nil else { return }
        busy = true
        defer {
            busy = false
            if queued { queued = false; schedule() }
        }
        do {
            let list = try await apple.list(requestAccess: false)
            isConnected = true
            _ = try await apple.sync(snapshot.manifest, in: list)
            lastError = nil
            lastSuccess = isoString(Date())
            syncedRevision = snapshot.revision
            UserDefaults.standard.set(lastSuccess, forKey: "lastAppleWrite")
            UserDefaults.standard.set(syncedRevision, forKey: "syncedRevision")
        } catch {
            lastError = error.localizedDescription
            isConnected = false
        }
        sendStatus()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.standardizedFileURL.path == entry.standardizedFileURL.path,
              let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, "Недопустимая команда."); return
        }
        switch action {
        case "load":
            var info: [String: Any] = ["state": snapshot?.state ?? [:], "revision": snapshot?.revision ?? 0, "sync": status()]
            if let loadError { info["error"] = loadError }
            replyHandler(info, nil)
        case "status": replyHandler(status(), nil)
        case "save":
            do {
                if let loadError { throw CalendarIssue(loadError) }
                let next = try Snapshot(body)
                guard next.revision > (snapshot?.revision ?? 0) else { throw CalendarIssue("Устаревшая запись календаря.") }
                try storage.write(next, backup: body["backup"] as? Bool == true ? snapshot : nil)
                snapshot = next
                if preview {
                    isConnected = true
                    lastSuccess = isoString(Date())
                    syncedRevision = next.revision
                    sendStatus()
                } else { schedule() }
                replyHandler(true, nil)
            } catch { replyHandler(nil, error.localizedDescription) }
        case "check", "sync":
            Task {
                guard !preview else { replyHandler(status(), nil); return }
                if busy { queued = true; replyHandler(status(), nil); return }
                do {
                    _ = try await apple.list(requestAccess: true)
                    isConnected = true
                    lastError = nil
                    if action == "sync" { await runSync() }
                    else { schedule() }
                } catch {
                    isConnected = false
                    lastError = error.localizedDescription
                }
                replyHandler(status(), nil)
            }
        case "export":
            guard let data = body["data"] as? [String: Any] else { replyHandler(nil, "Нет данных для экспорта."); return }
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.json]
            panel.nameFieldStringValue = "Design4Sales_calendar_progress.json"
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let url = panel.url else { replyHandler(false, nil); return }
                do {
                    try JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: [.atomic])
                    replyHandler(true, nil)
                } catch { replyHandler(nil, error.localizedDescription) }
            }
        default: replyHandler(nil, "Неизвестная команда.")
        }
    }

    #if D4S_SMOKE
    var smokePass = 0
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { runSmoke() }
    #endif

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, url.isFileURL, url.standardizedFileURL.path == entry.standardizedFileURL.path else {
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "Продолжить")
        alert.addButton(withTitle: "Отмена")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = CalendarApp()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}
