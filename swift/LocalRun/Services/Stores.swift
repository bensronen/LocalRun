import Foundation
import UIKit

/// JSON-file persistence in Documents — port of the AsyncStorage stores
/// (settings, plan draft, run history, place boosts) plus photo storage.
enum Stores {
    static var docs: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    static var photosDir: URL {
        let dir = docs.appendingPathComponent("localrun-photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func load<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        let url = docs.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private static func save<T: Encodable>(_ value: T, to name: String) {
        let url = docs.appendingPathComponent(name)
        if let data = try? JSONEncoder().encode(value) {
            try? data.write(to: url, options: .atomic)
        }
    }

    // MARK: Settings

    static func loadSettings() -> AppSettings { load("settings.json", as: AppSettings.self) ?? AppSettings() }
    static func saveSettings(_ s: AppSettings) { save(s, to: "settings.json") }

    // MARK: Plan draft

    static func loadDraft() -> PlanDraft { load("plandraft.json", as: PlanDraft.self) ?? PlanDraft() }
    static func saveDraft(_ d: PlanDraft) { save(d, to: "plandraft.json") }

    // MARK: Run history

    static func loadRuns() -> [RunRecord] { load("runs.json", as: [RunRecord].self) ?? [] }

    static func appendRun(_ r: RunRecord) {
        var runs = loadRuns()
        runs.insert(r, at: 0)
        save(runs, to: "runs.json")
    }

    static func deleteRun(id: String) -> [RunRecord] {
        var runs = loadRuns()
        runs.removeAll { $0.id == id }
        save(runs, to: "runs.json")
        return runs
    }

    static func updateRun(_ updated: RunRecord) {
        var runs = loadRuns()
        if let i = runs.firstIndex(where: { $0.id == updated.id }) { runs[i] = updated }
        save(runs, to: "runs.json")
    }

    static func updatePhotoCaption(runId: String, photoTs: Double, caption: String) {
        var runs = loadRuns()
        guard let i = runs.firstIndex(where: { $0.id == runId }) else { return }
        for j in runs[i].photos.indices where runs[i].photos[j].ts == photoTs {
            runs[i].photos[j].caption = caption
        }
        save(runs, to: "runs.json")
    }

    // MARK: Place boosts (your photos + loved runs teach the route builder)

    static func loadBoosts() -> [String: Double] { load("boosts.json", as: [String: Double].self) ?? [:] }

    static func applyBoosts(from record: RunRecord) {
        var boosts = loadBoosts()
        for p in record.photos {
            if let id = p.placeId { boosts[id, default: 0] += 2 }
        }
        if record.rating >= 4 {
            for id in record.seen { boosts[id, default: 0] += 1 }
        }
        save(boosts, to: "boosts.json")
    }

    // MARK: Photos

    static func persistPhoto(_ image: UIImage) -> String? {
        let name = "\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
        guard let data = image.jpegData(compressionQuality: 0.6) else { return nil }
        do {
            try data.write(to: photosDir.appendingPathComponent(name), options: .atomic)
            return name
        } catch { return nil }
    }
}

/// Light wrappers so call sites stay one-liners.
enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func thump() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}

/// Time estimates come from the runner's OWN recorded pace — no generic
/// "easy run" guesses. Until there's at least one real saved run, there is
/// no estimate at all.
enum PaceModel {
    /// Personal pace in seconds per km, distance-weighted over the most
    /// recent 5 saved runs (ignoring sub-800m fragments). nil = no data yet.
    static func personalSecPerKm() -> Double? {
        let runs = Stores.loadRuns().filter { $0.distM > 800 && $0.elapsed > 60 }
        guard !runs.isEmpty else { return nil }
        let recent = runs.prefix(5)
        let dist = recent.reduce(0.0) { $0 + $1.distM }
        let time = recent.reduce(0.0) { $0 + $1.elapsed }
        guard dist > 0 else { return nil }
        return time / (dist / 1000)
    }

    /// "38 min" / "1h 12m" at your pace, or nil before your first run.
    static func estimate(meters: Double) -> String? {
        guard let p = personalSecPerKm() else { return nil }
        let mins = Int((meters / 1000 * p / 60).rounded())
        return mins < 60 ? "\(mins) min" : "\(mins / 60)h \(mins % 60)m"
    }
}
