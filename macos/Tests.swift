import EventKit
import Foundation

@main
enum Tests {
    @MainActor static func main() throws {
        let first = DesiredReminder(id: "post:tg", title: "Telegram | Тема", notes: "Проверить",
            due: "2026-11-11T07:30:00.000Z", alarm: "2026-11-11T07:15:00.000Z")
        let moved = DesiredReminder(id: first.id, title: first.title, notes: first.notes,
            due: "2026-11-12T07:30:00.000Z", alarm: "2026-11-12T07:15:00.000Z")
        let fire = first.alarmDate!
        let now = fire.addingTimeInterval(-60)
        let notes = first.managedNotes(at: fire)
        precondition(notes.contains("Публикация: 11.11.2026, 10:30 МСК"))
        precondition(notes.contains("Напомнить: 11.11.2026, 10:15 МСК"))
        precondition(first.managedNotes(at: first.dueDate!).contains("Напомнить: 11.11.2026, 10:30 МСК"))
        let oldNotes = first.marker + "\n" + first.notes
        precondition(ManagedReminder(key: "old", notes: oldNotes, completed: false, matchesFields: false)?.id == first.id)
        precondition(ManagedReminder(key: "personal", notes: "A note about calendar\n" + first.marker + "\nExtra", completed: false, matchesFields: false) == nil)

        let item = EKReminder(eventStore: EKEventStore())
        setSchedule(on: item, at: fire)
        precondition(item.dueDateComponents?.timeZone?.identifier == "Europe/Moscow")
        precondition(item.dueDateComponents?.hour == 10 && item.dueDateComponents?.minute == 15)
        precondition(singleScheduledInstant(of: item) == fire)
        item.addAlarm(EKAlarm(absoluteDate: fire.addingTimeInterval(300)))
        precondition(singleScheduledInstant(of: item) == nil)
        item.alarms = [EKAlarm(relativeOffset: 0)]
        precondition(singleScheduledInstant(of: item) == fire)

        let saved = ManagedReminder(key: "existing", notes: notes, completed: false, matchesFields: true)!
        let duplicate = ManagedReminder(key: "zz-duplicate", notes: notes, completed: false, matchesFields: true)!
        let completed = ManagedReminder(key: "finished", notes: notes, completed: true, matchesFields: true)!
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
        precondition(planChanges([first], existing: [ManagedReminder(key: saved.key, notes: notes,
            completed: false, matchesFields: false)!], now: now) == [.upsert(id: first.id, key: saved.key, atPublication: false)])
        let stats = DesiredReminder(id: "post:tg:v24", title: "Statistics", notes: "",
            due: first.due, alarm: first.due)
        let oldManifest = Manifest(version: 1, reminders: [first, stats])
        let oldStats = ManagedReminder(key: "stats", notes: stats.marker, completed: false, matchesFields: true)!
        precondition(planChanges(oldManifest.publicationReminders, existing: [saved, oldStats], now: now) == [.remove(key: "stats")])
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
        try file.write(snapshot, replacing: nil, backup: false)
        let reloaded = try file.read()
        precondition(reloaded?.manifest.reminders.first?.fingerprint == first.fingerprint)
        precondition(reloaded?.revision == 1)
        try file.backupBeforeUpdate(snapshot)
        let updateBackup = try JSONSerialization.jsonObject(with: Data(contentsOf: file.beforeUpdate)) as? [String: Any]
        precondition(((updateBackup?["state"] as? [String: Any])?["test"] as? [String: String])?["note"] == "копия")
        let reset = try Snapshot(["state": [:], "revision": 2, "manifest": ["version": 1, "reminders": []]])
        try file.write(reset, replacing: reloaded, backup: true)
        let previous = try JSONSerialization.jsonObject(with: Data(contentsOf: file.previous)) as? [String: Any]
        precondition(((previous?["state"] as? [String: Any])?["test"] as? [String: String])?["note"] == "копия")
        let restored = try file.read()
        precondition(restored?.revision == 2 && restored?.manifest.reminders.isEmpty == true)
        let broken = Data("broken JSON".utf8)
        try broken.write(to: file.file)
        do {
            _ = try file.read()
            fatalError("Accepted damaged data")
        } catch {}
        let lastGood = try file.read(file.lastGood)
        precondition(lastGood?.revision == 1)
        try file.write(lastGood!, replacing: nil, backup: false, recovering: true)
        let recovery = try file.read()
        precondition(recovery?.manifest.reminders.first?.id == first.id)
        let damagedCopy = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .first { $0.lastPathComponent.hasPrefix("damaged-") }
        let preserved = try Data(contentsOf: damagedCopy!)
        precondition(preserved == broken)
        print("Mac checks passed: in-memory EventKit alarm and dates, reconciliation, legacy marker, backups and corruption recovery.")
    }
}
