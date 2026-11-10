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

    var lastGood: URL { directory.appendingPathComponent("last-good.json") }

    func read(_ source: URL? = nil) throws -> Snapshot? {
        let file = source ?? self.file
        let data: Data
        do { data = try Data(contentsOf: file) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CalendarIssue("Повреждена локальная копия календаря.")
        }
        return try Snapshot(json)
    }

    func write(_ snapshot: Snapshot, replacing current: Snapshot?, backup: Bool, recovering: Bool = false) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if recovering && FileManager.default.fileExists(atPath: file.path) {
            let damaged = directory.appendingPathComponent("damaged-" + UUID().uuidString + ".json")
            try FileManager.default.copyItem(at: file, to: damaged)
        }
        if let current {
            try current.data.write(to: lastGood, options: [.atomic])
            if backup {
                let export: [String: Any] = ["schemaVersion": 5, "state": current.state]
                let data = try JSONSerialization.data(withJSONObject: export, options: [.prettyPrinted, .sortedKeys])
                try data.write(to: previous, options: [.atomic])
            }
        }
        try snapshot.data.write(to: file, options: [.atomic])
    }
}
