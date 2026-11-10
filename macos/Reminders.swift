import CryptoKit
import EventKit
import Foundation

struct CalendarIssue: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

struct Manifest: Decodable {
    let version: Int
    let reminders: [DesiredReminder]
}

struct DesiredReminder: Decodable {
    let id: String
    let title: String
    let notes: String
    let due: String
    let alarm: String

    var dueDate: Date? { iso.date(from: due) }
    var alarmDate: Date? { iso.date(from: alarm) }
    var fingerprint: String {
        let fields = [id, title, notes, due, alarm]
        let data = (try? JSONEncoder().encode(fields)) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    var managedNotes: String { "Design4Sales Calendar v1 | \(id) | \(fingerprint)\n\(notes)" }
}

private let iso: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()
private let idPattern = #"^(?:morning:20[2-9][0-9]-[0-9]{2}-[0-9]{2}|[a-z0-9][a-z0-9-]{0,95}:(?:tg|vk|setka|ig|dzen|tg-story|vk-story|ig-story)(?::v(?:24|72))?)$"#
private func validID(_ id: String) -> Bool { id.range(of: idPattern, options: .regularExpression) != nil }
func isoString(_ date: Date) -> String { iso.string(from: date) }

func validate(_ manifest: Manifest) throws {
    guard manifest.version == 1, Set(manifest.reminders.map(\.id)).count == manifest.reminders.count else {
        throw CalendarIssue("Неверная версия или повтор идентификаторов в списке задач.")
    }
    for row in manifest.reminders {
        guard validID(row.id), !row.title.isEmpty, row.title.count <= 350,
              let due = row.dueDate, let alarm = row.alarmDate, due.timeIntervalSince(alarm) >= 0,
              due.timeIntervalSince(alarm) <= 3600 else {
            throw CalendarIssue("Неверные данные задачи Apple: \(row.id).")
        }
    }
}

struct ManagedReminder {
    let key: String
    let id: String
    let fingerprint: String
    let completed: Bool
    let matchesFields: Bool

    init?(key: String, notes: String?, completed: Bool, matchesFields: Bool) {
        let header = notes?.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first
        let parts = header.map(String.init)?.components(separatedBy: " | ") ?? []
        guard parts.count == 3, parts[0] == "Design4Sales Calendar v1", validID(parts[1]),
              parts[2].range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else { return nil }
        self.key = key
        id = parts[1]
        fingerprint = parts[2]
        self.completed = completed
        self.matchesFields = matchesFields
    }
}

enum ReminderChange: Equatable {
    case upsert(id: String, key: String?, atPublication: Bool)
    case remove(key: String)
}

func planChanges(_ desired: [DesiredReminder], existing: [ManagedReminder], now: Date) -> [ReminderChange] {
    var changes: [ReminderChange] = []
    let byID = Dictionary(grouping: existing, by: \.id)
    let desiredIDs = Set(desired.map(\.id))
    for item in existing where !item.completed && !desiredIDs.contains(item.id) {
        changes.append(.remove(key: item.key))
    }
    for row in desired {
        let matches = byID[row.id, default: []].sorted { $0.key < $1.key }
        let same = matches.filter { $0.fingerprint == row.fingerprint }
        let incomplete = matches.filter { !$0.completed }
        if same.contains(where: \.completed) {
            // A task completed in Apple stays completed for this exact schedule.
            changes.append(contentsOf: incomplete.map { .remove(key: $0.key) })
        } else if let canonical = same.first(where: { !$0.completed && $0.matchesFields }) {
            changes.append(contentsOf: incomplete.filter { $0.key != canonical.key }.map { .remove(key: $0.key) })
        } else if let alarm = row.alarmDate, let due = row.dueDate, due > now {
            let canonical = incomplete.first ?? matches.first
            changes.append(.upsert(id: row.id, key: canonical?.key, atPublication: alarm <= now))
            changes.append(contentsOf: incomplete.filter { $0.key != canonical?.key }.map { .remove(key: $0.key) })
        } else {
            // The publication, summary or statistics window has already passed.
            changes.append(contentsOf: incomplete.map { .remove(key: $0.key) })
        }
    }
    return changes
}

@MainActor
final class AppleReminders {
    private let store = EKEventStore()

    func list(requestAccess: Bool) async throws -> EKCalendar {
        if EKEventStore.authorizationStatus(for: .reminder) == .notDetermined, requestAccess {
            _ = try await store.requestFullAccessToReminders()
        }
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw CalendarIssue("Apple: разреши Design4Sales Calendar полный доступ к «Напоминаниям» в настройках macOS.")
        }
        let matches = store.calendars(for: .reminder).filter {
            $0.title == "Design4Sales" && $0.allowsContentModifications
        }
        let iCloud = matches.filter { $0.source.title.caseInsensitiveCompare("iCloud") == .orderedSame }
        guard iCloud.count == 1, let target = iCloud.first else {
            throw CalendarIssue("Apple: нужен один доступный для записи список Design4Sales в разделе iCloud на Mac.")
        }
        return target
    }

    func sync(_ desired: Manifest, in list: EKCalendar) async throws -> Int {
        try validate(desired)
        let predicate = store.predicateForReminders(in: [list])
        let found: [EKReminder] = try await withCheckedThrowingContinuation { continuation in
            store.fetchReminders(matching: predicate) { rows in
                if let rows { continuation.resume(returning: rows) }
                else { continuation.resume(throwing: CalendarIssue("Apple не вернула задачи. Список не изменён.")) }
            }
        }
        let byKey = Dictionary(found.map { ($0.calendarItemIdentifier, $0) }, uniquingKeysWith: { a, _ in a })
        let desiredByID = Dictionary(uniqueKeysWithValues: desired.reminders.map { ($0.id, $0) })
        var moscow = Calendar(identifier: .gregorian)
        moscow.timeZone = TimeZone(identifier: "Europe/Moscow")!
        let existing = byKey.values.compactMap { item -> ManagedReminder? in
            guard let mark = ManagedReminder(key: item.calendarItemIdentifier, notes: item.notes,
                                             completed: item.isCompleted, matchesFields: false) else { return nil }
            let row = desiredByID[mark.id]
            let match = row.map { row in
                let components = item.dueDateComponents
                let due = components.flatMap { fields -> Date? in
                    var calendar = moscow
                    if let zone = fields.timeZone { calendar.timeZone = zone }
                    return calendar.date(from: fields)
                }
                let alarm = item.alarms ?? []
                return item.title == row.title && item.notes == row.managedNotes && due != nil
                    && (due == row.alarmDate || due == row.dueDate)
                    && alarm.count == 1 && alarm[0].absoluteDate == due && item.recurrenceRules?.isEmpty != false
            } ?? false
            return ManagedReminder(key: mark.key, notes: item.notes, completed: mark.completed, matchesFields: match)
        }
        let changes = planChanges(desired.reminders, existing: existing, now: Date())
        guard !changes.isEmpty else { return 0 }
        do {
            for change in changes {
                switch change {
                case let .remove(key):
                    if let item = byKey[key] { try store.remove(item, commit: false) }
                case let .upsert(id, key, atPublication):
                    guard let row = desiredByID[id], let due = row.dueDate, let alarm = row.alarmDate else {
                        throw CalendarIssue("Не удалось прочитать время задачи.")
                    }
                    let item = key.flatMap { byKey[$0] } ?? EKReminder(eventStore: store)
                    item.calendar = list
                    item.title = row.title
                    item.notes = row.managedNotes
                    // One native scheduled instant. The real publication time remains in the notes.
                    let fire = atPublication ? due : alarm
                    item.dueDateComponents = moscow.dateComponents([.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second], from: fire)
                    item.alarms = [EKAlarm(absoluteDate: fire)]
                    item.recurrenceRules = nil
                    item.isCompleted = false
                    try store.save(item, commit: false)
                }
            }
            try store.commit()
            return changes.count
        } catch {
            store.reset()
            throw error
        }
    }
}
