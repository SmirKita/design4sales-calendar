import AppKit
import EventKit
import Network
import UniformTypeIdentifiers
import WebKit

@MainActor
final class CalendarApp: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    let preview = CommandLine.arguments.contains("--preview")
    lazy var storage = StateFile(directory: storageDirectory())
    private func storageDirectory() -> URL {
        #if D4S_SMOKE
        if preview, let path = ProcessInfo.processInfo.environment["D4S_SMOKE_STATE"] {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        #endif
        if preview {
            return FileManager.default.temporaryDirectory.appendingPathComponent("d4s-preview-" + UUID().uuidString)
        }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Design4Sales Calendar")
    }
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
    var preparedToSync = false
    var preparingQuit = false
    var quitApproved = false
    var binding: ReminderListBinding?
    var listDescription: String?
    var online: Bool?
    let network = NWPathMonitor()

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { snapshot = try storage.read() }
        catch { loadError = "Локальный план не открылся. Восстанови предыдущую версию или импортируй резервный JSON." }
        if !preview {
            let defaults = UserDefaults.standard
            if let calendarID = defaults.string(forKey: "reminderListID"),
               let sourceID = defaults.string(forKey: "reminderSourceID") {
                binding = ReminderListBinding(calendarID: calendarID, sourceID: sourceID)
                lastSuccess = defaults.string(forKey: "lastAppleWrite")
                syncedRevision = defaults.object(forKey: "syncedRevision") as? Int
            }
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
        if !preview {
            network.pathUpdateHandler = { [weak self] path in
                let available = path.status == .satisfied
                Task { @MainActor in
                    guard let self else { return }
                    let reconnected = self.online == false && available
                    self.online = available
                    self.sendStatus()
                    if reconnected { self.schedule() }
                }
            }
            network.start(queue: DispatchQueue(label: "studio.design4sales.network"))
        }
        schedule()
        retry = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.lastError != nil else { return }
                self.schedule()
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window?.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitApproved || web == nil { return .terminateNow }
        guard !preparingQuit else { return .terminateCancel }
        preparingQuit = true
        // AppKit runs a nested modal loop for terminateLater. Keep the normal loop
        // available for WebKit and EventKit, then issue a second terminate request.
        Task {
            let script = """
                if (!window.d4sFlush) return true;
                return await Promise.race([window.d4sFlush(), new Promise(resolve => setTimeout(() => resolve(false), 2500))]);
                """
            let saved = try? await web.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
            guard saved as? Bool == true else {
                let alert = NSAlert()
                alert.messageText = "Не удалось подтвердить сохранение"
                alert.informativeText = "Вернись в календарь, повтори сохранение или экспортируй прогресс в JSON."
                alert.addButton(withTitle: "Вернуться в календарь")
                alert.addButton(withTitle: "Выйти")
                window.makeKeyAndOrderFront(nil)
                alert.beginSheetModal(for: window) {
                    self.preparingQuit = false
                    if $0 == .alertSecondButtonReturn {
                        self.quitApproved = true
                        sender.terminate(nil)
                    }
                }
                return
            }
            // A successful disk write is enough to close safely. Any pending Apple update
            // will be retried on the next launch if this attempt cannot finish in time.
            if !preview, let snapshot, syncedRevision != snapshot.revision,
               binding != nil, EKEventStore.authorizationStatus(for: .reminder) == .fullAccess {
                if !busy { schedule() }
                let until = Date().addingTimeInterval(3)
                while syncedRevision != self.snapshot?.revision && Date() < until {
                    try? await Task.sleep(for: .milliseconds(100))
                }
            }
            quitApproved = true
            sender.terminate(nil)
        }
        return .terminateCancel
    }

    func status() -> [String: Any] {
        var info: [String: Any] = ["connected": isConnected, "busy": busy, "configured": binding != nil]
        if let listDescription { info["list"] = listDescription }
        if let online { info["online"] = online }
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
        guard preparedToSync, binding != nil, loadError == nil, !preview else { return }
        work?.cancel()
        work = Task {
            do { try await Task.sleep(for: .milliseconds(350)) }
            catch { return }
            work = nil
            await runSync()
        }
    }

    private func connectList() async throws -> EKCalendar? {
        let choices = apple.candidates()
        guard !choices.isEmpty else {
            throw CalendarIssue("Список Design4Sales не найден. В «Напоминаниях» на Mac создай его в разделе iCloud и проверь, что iCloud для напоминаний включён.")
        }
        let sourceNames = choices.map { $0.source.title }
        let picker = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 320, height: 28))
        picker.addItem(withTitle: "Выбери список из раздела iCloud")
        for (index, name) in sourceNames.enumerated() {
            let label = name.isEmpty ? "Источник без названия" : name
            picker.addItem(withTitle: "Design4Sales · \(label)")
            picker.lastItem?.tag = index + 1
        }
        let knownICloud = choices.indices.filter { index in
            sourceNames[index].localizedCaseInsensitiveContains("iCloud")
        }
        if knownICloud.count == 1 { picker.selectItem(at: knownICloud[0] + 1) }
        let alert = NSAlert()
        alert.messageText = "Подключить список Design4Sales"
        alert.informativeText = "Сверь источник с разделом iCloud в приложении «Напоминания». Если два источника называются одинаково, переименуй одноимённый список в другом аккаунте."
        alert.accessoryView = picker
        alert.addButton(withTitle: "Подключить")
        alert.addButton(withTitle: "Отмена")
        let response = await withCheckedContinuation { continuation in
            alert.beginSheetModal(for: window) { continuation.resume(returning: $0) }
        }
        guard response == .alertFirstButtonReturn else { return nil }
        let index = (picker.selectedItem?.tag ?? 0) - 1
        guard choices.indices.contains(index), sourceNames.filter({ $0 == sourceNames[index] }).count == 1 else {
            throw CalendarIssue("Нужно однозначно выбрать список Design4Sales из iCloud. Проверь названия источников в «Напоминаниях».")
        }
        let chosenBinding = ReminderListBinding(choices[index])
        let confirmed = try apple.list(for: chosenBinding)
        binding = chosenBinding
        lastSuccess = nil
        syncedRevision = nil
        let defaults = UserDefaults.standard
        defaults.set(chosenBinding.calendarID, forKey: "reminderListID")
        defaults.set(chosenBinding.sourceID, forKey: "reminderSourceID")
        defaults.removeObject(forKey: "lastAppleWrite")
        defaults.removeObject(forKey: "syncedRevision")
        return confirmed
    }

    func runSync(setup: Bool = false) async {
        if busy { queued = true; return }
        guard preparedToSync, !preview, loadError == nil else { return }
        busy = true
        sendStatus()
        defer {
            busy = false
            sendStatus()
            if queued { queued = false; schedule() }
        }
        do {
            try await apple.authorize(requestAccess: setup)
            let list: EKCalendar
            if let binding, let selected = try? apple.list(for: binding) {
                list = selected
            } else if setup {
                guard let chosen = try await connectList() else { return }
                list = chosen
            } else if let binding {
                list = try apple.list(for: binding)
            } else {
                throw CalendarIssue("Сначала подключи список Design4Sales в iCloud.")
            }
            isConnected = true
            listDescription = list.title + " · " + list.source.title
            if let snapshot {
                guard try await apple.sync(snapshot.manifest, in: list, isCurrent: { self.snapshot?.revision == snapshot.revision }) else {
                    queued = true
                    return
                }
                lastSuccess = isoString(Date())
                syncedRevision = snapshot.revision
                UserDefaults.standard.set(lastSuccess, forKey: "lastAppleWrite")
                UserDefaults.standard.set(syncedRevision, forKey: "syncedRevision")
            }
            lastError = nil
        } catch {
            let reason = (error as? CalendarIssue)?.localizedDescription
            lastError = reason ?? "Не удалось обновить задачи Apple. План сохранён на Mac. Проверь iCloud и повтори синхронизацию. (\(error.localizedDescription))"
            isConnected = false
            listDescription = nil
        }
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
            if let loadError {
                info["error"] = loadError
                info["canRecover"] = (try? storage.read(storage.lastGood)) != nil
            }
            replyHandler(info, nil)
        case "prepare":
            do {
                if let loadError { throw CalendarIssue(loadError) }
                guard let expected = body["expectedRevision"] as? Int, expected == (snapshot?.revision ?? 0) else {
                    throw CalendarIssue("План изменился во время открытия. Открой приложение ещё раз.")
                }
                let next = try Snapshot(body)
                if let current = snapshot, current.manifest != next.manifest || !NSDictionary(dictionary: current.state).isEqual(to: next.state) {
                    try storage.backupBeforeUpdate(current)
                    try storage.write(next, replacing: current, backup: false)
                    snapshot = next
                }
                preparedToSync = true
                schedule()
                replyHandler(["revision": snapshot?.revision ?? 0, "sync": status()], nil)
            } catch { replyHandler(nil, error.localizedDescription) }
        case "status": replyHandler(status(), nil)
        case "save":
            do {
                let recovering = loadError != nil && body["recover"] as? Bool == true
                if let loadError, !recovering { throw CalendarIssue(loadError) }
                let next = try Snapshot(body)
                if let snapshot, next.revision == snapshot.revision, next.data == snapshot.data {
                    replyHandler(true, nil)
                    return
                }
                guard next.revision > (snapshot?.revision ?? 0) else { throw CalendarIssue("Устаревшая запись календаря.") }
                try storage.write(next, replacing: snapshot, backup: body["backup"] as? Bool == true, recovering: recovering)
                snapshot = next
                if recovering { recoveryCompleted() }
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
                await runSync(setup: action == "check")
                replyHandler(status(), nil)
            }
        case "restoreLastGood":
            do {
                guard loadError != nil, let previous = try storage.read(storage.lastGood) else {
                    throw CalendarIssue("Предыдущая копия недоступна. Импортируй резервный JSON.")
                }
                try storage.write(previous, replacing: nil, backup: false, recovering: true)
                snapshot = previous
                recoveryCompleted()
                schedule()
                replyHandler(true, nil)
            } catch { replyHandler(nil, error.localizedDescription) }
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

    private func recoveryCompleted() {
        loadError = nil
        syncedRevision = nil
        lastSuccess = nil
        if !preview {
            UserDefaults.standard.removeObject(forKey: "syncedRevision")
            UserDefaults.standard.removeObject(forKey: "lastAppleWrite")
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
