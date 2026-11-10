import Foundation

struct Snapshot {
    let state: [String: Any]
    let manifest: Manifest
    let revision: Int
    let data: Data

    init(_ raw: [String: Any]) throws {
        guard let state = raw["state"] as? [String: Any], let payload = raw["manifest"] as? [String: Any],
              let revision = raw["revision"] as? Int, revision > 0 else { throw CalendarIssue("Неверный формат локального состояния.") }
        let manifest = try JSONDecoder().decode(Manifest.self, from: JSONSerialization.data(withJSONObject: payload))
        try validate(manifest)
        self.state = state
        self.manifest = manifest
        self.revision = revision
        self.data = try JSONSerialization.data(withJSONObject: ["state": state, "manifest": payload, "revision": revision], options: [.sortedKeys])
    }
}

struct StateFile {
    let directory: URL
    var file: URL { directory.appendingPathComponent("calendar-state.json") }
    var previous: URL { directory.appendingPathComponent("before-restore.json") }

    func read() throws -> Snapshot? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let data = try Data(contentsOf: file)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CalendarIssue("Повреждена локальная копия календаря.")
        }
        return try Snapshot(json)
    }

    func write(_ snapshot: Snapshot, backup: Snapshot?) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if let backup {
            let export: [String: Any] = ["schemaVersion": 5, "state": backup.state]
            let data = try JSONSerialization.data(withJSONObject: export, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: previous, options: [.atomic])
        }
        try snapshot.data.write(to: file, options: [.atomic])
    }
}
