import Foundation

/// Client for the LocalRun community backend (server/ in the repo).
/// Best-effort everywhere: no URL, no network, or a slow server never breaks
/// the app — community data falls back to the last cached copy or nil.
/// Privacy: only place ids and run totals are sent.
enum CommunityAPI {
    private static let cacheTTL: TimeInterval = 30 * 60

    private static var runnerId: String {
        let key = "localrun.runnerid"
        if let id = UserDefaults.standard.string(forKey: key) { return id }
        let id = "r-\(UUID().uuidString.lowercased().prefix(18))"
        UserDefaults.standard.set(String(id), forKey: key)
        return String(id)
    }

    private static func cacheURL(_ cityId: String) -> URL {
        Stores.docs.appendingPathComponent("community-\(cityId).json")
    }

    private struct Cached: Codable {
        let ts: Double
        let data: CommunitySnapshot
    }

    static func submit(_ record: RunRecord) async {
        guard Config.hasAPI, let url = URL(string: "\(Config.apiURL)/api/runs") else { return }
        let body: [String: Any] = [
            "runnerId": runnerId,
            "cityId": record.cityId,
            "distM": Int(record.distM.rounded()),
            "elapsed": Int(record.elapsed.rounded()),
            "rating": record.rating,
            "seen": record.seen,
            "photoPlaceIds": record.photos.compactMap(\.placeId),
            "ts": record.ts,
        ]
        var req = URLRequest(url: url, timeoutInterval: 5)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
    }

    static func fetchCommunity(_ cityId: String) async -> CommunitySnapshot? {
        var cached: Cached?
        if let data = try? Data(contentsOf: cacheURL(cityId)) {
            cached = try? JSONDecoder().decode(Cached.self, from: data)
        }
        guard Config.hasAPI else { return cached?.data }
        if let c = cached, Date().timeIntervalSince1970 - c.ts < cacheTTL { return c.data }
        guard let url = URL(string: "\(Config.apiURL)/api/community/\(cityId)") else { return cached?.data }
        do {
            var req = URLRequest(url: url, timeoutInterval: 5)
            req.httpMethod = "GET"
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return cached?.data }
            let snap = try JSONDecoder().decode(CommunitySnapshot.self, from: data)
            let wrapped = Cached(ts: Date().timeIntervalSince1970, data: snap)
            if let out = try? JSONEncoder().encode(wrapped) {
                try? out.write(to: cacheURL(cityId), options: .atomic)
            }
            return snap
        } catch { return cached?.data }
    }

    /// Personal taste + the crowd's, in one boost map for the route builder.
    static func mergeBoosts(personal: [String: Double], community: CommunitySnapshot?) -> [String: Double] {
        var merged = personal
        if let places = community?.places {
            for (id, p) in places where p.boost > 0 {
                merged[id, default: 0] += p.boost
            }
        }
        return merged
    }
}
