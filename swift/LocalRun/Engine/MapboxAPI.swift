import Foundation

/// Thin client over Mapbox REST (Directions + Map Matching + Geocoding) —
/// port of src/lib/mapbox.js.
enum MapboxAPI {
    static let base = "https://api.mapbox.com"

    struct Maneuver {
        var lat: Double
        var lng: Double
        var instruction: String
        var type: String
        var modifier: String
        var said = false
        var ll: LL { LL(lat: lat, lng: lng) }
    }

    enum APIError: LocalizedError {
        case noToken, noRoute, http(Int, String)
        var errorDescription: String? {
            switch self {
            case .noToken: return "Add your Mapbox token in Config.swift to build routes."
            case .noRoute: return "No route found."
            case let .http(code, body): return "Mapbox \(code): \(String(body.prefix(120)))"
            }
        }
    }

    /// coords: ordered points (max 25). Returns geometry + real distance.
    static func getRoute(_ coords: [LL], profile: String = "walking") async throws -> RouteGeometry {
        guard Config.hasMapboxToken else { throw APIError.noToken }
        guard coords.count >= 2 else { throw APIError.noRoute }
        let path = coords.map { "\($0.lng),\($0.lat)" }.joined(separator: ";")
        let url = URL(string:
            "\(base)/directions/v5/mapbox/\(profile)/\(path)?geometries=geojson&overview=full&steps=false&access_token=\(Config.mapboxToken)"
        )!
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.http(code, String(data: data, encoding: .utf8) ?? "")
        }
        struct Resp: Decodable {
            struct Route: Decodable {
                struct Geom: Decodable { let coordinates: [[Double]] }
                let geometry: Geom
                let distance: Double
                let duration: Double
            }
            let routes: [Route]
        }
        let parsed = try JSONDecoder().decode(Resp.self, from: data)
        guard let r = parsed.routes.first else { throw APIError.noRoute }
        return RouteGeometry(
            coordinates: r.geometry.coordinates.map { LL(lat: $0[1], lng: $0[0]) },
            distanceMeters: r.distance,
            durationSec: r.duration
        )
    }

    /// Turn-by-turn maneuvers for a built geometry via Map Matching ([] on failure).
    static func getManeuvers(_ routeCoords: [LL], profile: String = "walking") async -> [Maneuver] {
        guard Config.hasMapboxToken, routeCoords.count >= 2 else { return [] }
        var coords = routeCoords
        let maxPts = 90
        if coords.count > maxPts {
            let stride = Int(ceil(Double(coords.count) / Double(maxPts)))
            var sampled = coords.enumerated().filter { $0.offset % stride == 0 }.map(\.element)
            if let last = coords.last { sampled.append(last) }
            coords = sampled
        }
        let path = coords.map { "\($0.lng),\($0.lat)" }.joined(separator: ";")
        guard let url = URL(string:
            "\(base)/matching/v5/mapbox/\(profile)/\(path)?steps=true&geometries=geojson&overview=false&tidy=true&access_token=\(Config.mapboxToken)"
        ) else { return [] }
        do {
            let (data, resp) = try await URLSession.shared.data(from: url)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return [] }
            struct Resp: Decodable {
                struct Matching: Decodable {
                    struct Leg: Decodable { let steps: [Step]? }
                    let legs: [Leg]?
                }
                struct Step: Decodable {
                    struct Man: Decodable {
                        let location: [Double]
                        let instruction: String?
                        let type: String?
                        let modifier: String?
                    }
                    let maneuver: Man
                }
                let matchings: [Matching]?
            }
            let parsed = try JSONDecoder().decode(Resp.self, from: data)
            guard let m = parsed.matchings?.first else { return [] }
            let steps = (m.legs ?? []).flatMap { $0.steps ?? [] }
            return steps.compactMap { s in
                guard let instr = s.maneuver.instruction, !instr.isEmpty else { return nil }
                return Maneuver(
                    lat: s.maneuver.location[1], lng: s.maneuver.location[0],
                    instruction: instr, type: s.maneuver.type ?? "", modifier: s.maneuver.modifier ?? ""
                )
            }
        } catch { return [] }
    }

    /// Mapbox's bbox param hard-filters; pad generously, proximity keeps it local.
    private static func paddedBbox(_ bbox: [Double], pad: Double = 0.15) -> String {
        "\(bbox[0] - pad),\(bbox[1] - pad),\(bbox[2] + pad),\(bbox[3] + pad)"
    }

    /// Free-text -> up to `limit` candidates, biased to a city. [] on failure.
    static func geocodeSuggest(
        _ query: String, proximity: LL?, bbox: [Double], limit: Int = 5, autocomplete: Bool = true
    ) async -> [StartPoint] {
        guard Config.hasMapboxToken, !query.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
        var comps = URLComponents(string: "\(base)/geocoding/v5/mapbox.places/q.json")!
        comps.path = "/geocoding/v5/mapbox.places/\(query).json"
        var items = [
            URLQueryItem(name: "access_token", value: Config.mapboxToken),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "bbox", value: paddedBbox(bbox)),
        ]
        if autocomplete { items.append(URLQueryItem(name: "autocomplete", value: "true")) }
        if let p = proximity { items.append(URLQueryItem(name: "proximity", value: "\(p.lng),\(p.lat)")) }
        comps.queryItems = items
        guard let url = comps.url else { return [] }
        do {
            let (data, resp) = try await URLSession.shared.data(from: url)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return [] }
            struct Resp: Decodable {
                struct Feature: Decodable {
                    let center: [Double]
                    let place_name: String
                }
                let features: [Feature]?
            }
            let parsed = try JSONDecoder().decode(Resp.self, from: data)
            return (parsed.features ?? []).map {
                StartPoint(lat: $0.center[1], lng: $0.center[0], name: $0.place_name)
            }
        } catch { return [] }
    }
}
