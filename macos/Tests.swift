import Foundation

@main
enum Tests {
    static func main() throws {
        let first = DesiredReminder(id: "post:tg", title: "Telegram | Тема", notes: "Проверить",
            due: "2026-11-11T07:30:00.000Z", alarm: "2026-11-11T07:15:00.000Z")
        let moved = DesiredReminder(id: first.id, title: first.title, notes: first.notes,
            due: "2026-11-12T07:30:00.000Z", alarm: "2026-11-12T07:15:00.000Z")
        let now = first.alarmDate!.addingTimeInterval(-60)
        let saved = ManagedReminder(key: "existing", notes: first.managedNotes, completed: false, matchesFields: true)!
        let duplicate = ManagedReminder(key: "zz-duplicate", notes: first.managedNotes, completed: false, matchesFields: true)!
        let completed = ManagedReminder(key: "finished", notes: first.managedNotes, completed: true, matchesFields: true)!
        precondition(ManagedReminder(key: "personal", notes: "Личная запись", completed: false, matchesFields: false) == nil)
        precondition(planChanges([first], existing: [], now: now) == [.upsert(id: first.id, key: nil, atPublication: false)])
        precondition(planChanges([first], existing: [saved], now: now).isEmpty)
        precondition(planChanges([first], existing: [saved, duplicate], now: now) == [.remove(key: duplicate.key)])
        precondition(planChanges([moved], existing: [saved], now: now) == [.upsert(id: first.id, key: saved.key, atPublication: false)])
        precondition(planChanges([], existing: [saved, completed], now: now) == [.remove(key: saved.key)])
        precondition(planChanges([first], existing: [completed], now: now).isEmpty)
        precondition(planChanges([first], existing: [], now: first.alarmDate!) == [.upsert(id: first.id, key: nil, atPublication: true)])
        precondition(planChanges([first], existing: [], now: first.dueDate!).isEmpty)
        precondition(planChanges([first], existing: [saved], now: first.alarmDate!).isEmpty)
        precondition(planChanges([first], existing: [ManagedReminder(key: saved.key, notes: first.managedNotes,
            completed: false, matchesFields: false)!], now: now) == [.upsert(id: first.id, key: saved.key, atPublication: false)])
        do {
            try validate(Manifest(version: 1, reminders: [first, moved]))
            fatalError("Accepted duplicate ID")
        } catch is CalendarIssue { }

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("d4s-tests-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = StateFile(directory: directory)
        let empty = try file.read()
        precondition(empty == nil)
        let raw: [String: Any] = ["state": ["test": ["note": "копия"]], "revision": 1,
                                  "manifest": ["version": 1, "reminders": [[
                                    "id": first.id, "title": first.title, "notes": first.notes, "due": first.due, "alarm": first.alarm
                                  ]]]]
        let snapshot = try Snapshot(raw)
        try file.write(snapshot, backup: nil)
        let reloaded = try file.read()
        precondition(reloaded?.manifest.reminders.first?.fingerprint == first.fingerprint)
        precondition(reloaded?.revision == 1)
        let reset = try Snapshot(["state": [:], "revision": 2, "manifest": ["version": 1, "reminders": []]])
        try file.write(reset, backup: reloaded)
        let previous = try JSONSerialization.jsonObject(with: Data(contentsOf: file.previous)) as? [String: Any]
        precondition(((previous?["state"] as? [String: Any])?["test"] as? [String: String])?["note"] == "копия")
        let restored = try file.read()
        precondition(restored?.revision == 2 && restored?.manifest.reminders.isEmpty == true)
        print("Mac checks passed: EventKit reconciliation plan, stable IDs, duplicate protection and state recovery.")
    }
}
