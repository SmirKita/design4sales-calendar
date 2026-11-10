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
    var marker: String { "Design4Sales Calendar v1 | \(id) | \(fingerprint)" }

    func managedNotes(at fire: Date) -> String {
        let fields = id.split(separator: ":")
        guard fields.count == 2, fields.first != "morning", let dueDate else {
            return notes + "\n\n" + marker
        }
        return "Публикация: \(moscowLabel(dueDate))\nНапомнить: \(moscowLabel(fire))\nПроверь текст, визуал и ссылку.\n\n" + marker
    }
}

private let iso: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()
private var moscowCalendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Moscow")!
    return calendar
}

func setSchedule(on item: EKReminder, at fire: Date) {
    item.dueDateComponents = moscowCalendar.dateComponents([.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second], from: fire)
    item.alarms = [EKAlarm(absoluteDate: fire)]
    item.recurrenceRules = nil
}

func singleScheduledInstant(of item: EKReminder) -> Date? {
    guard let components = item.dueDateComponents, item.recurrenceRules?.isEmpty != false,
          let alarms = item.alarms, alarms.count == 1 else { return nil }
    var calendar = moscowCalendar
    if let zone = components.timeZone { calendar.timeZone = zone }
    guard let date = calendar.date(from: components) else { return nil }
    let alarm = alarms[0]
    if let absolute = alarm.absoluteDate { return absolute == date ? date : nil }
    return alarm.structuredLocation == nil && alarm.relativeOffset == 0 ? date : nil
}

private func moscowLabel(_ date: Date) -> String {
    let format = DateFormatter()
    format.locale = Locale(identifier: "ru_RU")
    format.timeZone = TimeZone(identifier: "Europe/Moscow")
    format.dateFormat = "dd.MM.yyyy, HH:mm"
    return format.string(from: date) + " МСК"
}

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
        let lines = notes?.split(whereSeparator: \.isNewline) ?? []
        // Earlier builds put the same ownership marker before the notes.
        let endpoints = [lines.last, lines.first].compactMap { $0 }
        guard let parts = endpoints.lazy.map({ String($0).components(separatedBy: " | ") }).first(where: {
            $0.count == 3 && $0[0] == "Design4Sales Calendar v1" && validID($0[1])
                && $0[2].range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
        }) else { return nil }
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

struct ReminderListBinding: Equatable {
    let calendarID: String
    let sourceID: String

    init(calendarID: String, sourceID: String) {
        self.calendarID = calendarID
        self.sourceID = sourceID
    }

    init(_ list: EKCalendar) {
        self.init(calendarID: list.calendarIdentifier, sourceID: list.source.sourceIdentifier)
    }
}

@MainActor
final class AppleReminders {
    private let store = EKEventStore()

    func authorize(requestAccess: Bool) async throws {
        if EKEventStore.authorizationStatus(for: .reminder) == .notDetermined, requestAccess {
            _ = try await store.requestFullAccessToReminders()
        }
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .fullAccess: return
        case .notDetermined:
            throw CalendarIssue("Нажми «Подключить список», чтобы дать приложению доступ к напоминаниям.")
        case .restricted:
            throw CalendarIssue("Доступ к напоминаниям ограничен настройками этого Mac.")
        default:
            throw CalendarIssue("Нет доступа к напоминаниям. Открой Системные настройки → Конфиденциальность и безопасность → Напоминания и разреши полный доступ.")
        }
    }

    private func isCandidate(_ list: EKCalendar) -> Bool {
        // EventKit describes iCloud as CalDAV but exposes no provider identifier.
        list.title == "Design4Sales" && list.allowsContentModifications && list.source.sourceType == .calDAV
    }

    func candidates() -> [EKCalendar] {
        store.refreshSourcesIfNecessary()
        return store.calendars(for: .reminder).filter(isCandidate).sorted {
            $0.source.title.localizedStandardCompare($1.source.title) == .orderedAscending
        }
    }

    func list(for binding: ReminderListBinding) throws -> EKCalendar {
        guard let list = store.calendar(withIdentifier: binding.calendarID),
              ReminderListBinding(list) == binding, isCandidate(list) else {
            throw CalendarIssue("Подключённый список недоступен. Проверь iCloud и список Design4Sales в «Напоминаниях». Если список был пересоздан, выбери его заново.")
        }
        return list
    }

    private func fetch(in list: EKCalendar) async throws -> [EKReminder] {
        let predicate = store.predicateForReminders(in: [list])
        return try await withCheckedThrowingContinuation { continuation in
            var finished = false
            let token = store.fetchReminders(matching: predicate) { rows in
                Task { @MainActor in
                    guard !finished else { return }
                    finished = true
                    if let rows { continuation.resume(returning: rows) }
                    else { continuation.resume(throwing: CalendarIssue("Apple не вернула задачи. Проверь доступность списка и повтори синхронизацию.")) }
                }
            }
            Task {
                try? await Task.sleep(for: .seconds(8))
                guard !finished else { return }
                finished = true
                store.cancelFetchRequest(token)
                continuation.resume(throwing: CalendarIssue("«Напоминания» не ответили. Календарь сохранён на Mac. Попробуй синхронизацию ещё раз."))
            }
        }
    }

    func sync(_ desired: Manifest, in list: EKCalendar, isCurrent: () -> Bool) async throws -> Bool {
        try validate(desired)
        let binding = ReminderListBinding(list)
        let found = try await fetch(in: list)
        try await authorize(requestAccess: false)
        guard isCurrent() else { return false }
        let destination = try self.list(for: binding)
        let byKey = Dictionary(found.map { ($0.calendarItemIdentifier, $0) }, uniquingKeysWith: { a, _ in a })
        let desiredByID = Dictionary(uniqueKeysWithValues: desired.reminders.map { ($0.id, $0) })
        let existing = byKey.values.compactMap { item -> ManagedReminder? in
            guard let mark = ManagedReminder(key: item.calendarItemIdentifier, notes: item.notes,
                                             completed: item.isCompleted, matchesFields: false) else { return nil }
            let row = desiredByID[mark.id]
            let match = row.map { row in
                guard let due = singleScheduledInstant(of: item),
                      due == row.alarmDate || due == row.dueDate else { return false }
                return item.title == row.title && (item.notes == row.managedNotes(at: due) || due <= Date())
            } ?? false
            return ManagedReminder(key: mark.key, notes: item.notes, completed: mark.completed, matchesFields: match)
        }
        let changes = planChanges(desired.reminders, existing: existing, now: Date())
        guard !changes.isEmpty else { return true }
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
                    item.calendar = destination
                    item.title = row.title
                    // One native scheduled instant. The real publication time remains in the notes.
                    let fire = atPublication ? due : alarm
                    item.notes = row.managedNotes(at: fire)
                    setSchedule(on: item, at: fire)
                    item.isCompleted = false
                    try store.save(item, commit: false)
                }
            }
            try store.commit()
            return true
        } catch {
            store.reset()
            throw error
        }
    }
}
