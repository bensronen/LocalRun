import Foundation
import CoreLocation

// MARK: - Geo primitives

/// A lat/lng point matching the JSON datasets ({lat, lng}).
struct LL: Codable, Hashable {
    var lat: Double
    var lng: Double

    var cl: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
}

// MARK: - City datasets (bundled cities.json, same shape as the JS data)

struct City: Codable, Identifiable, Hashable {
    static func == (a: City, b: City) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    let id: String
    let name: String
    let emoji: String
    let center: LL
    let bbox: [Double] // [w, s, e, n]
    let primaryZone: String
    let defaultStart: StartPoint
    let presets: [Preset]
    let beauty: BeautyGrid?
    let places: [Place]

    struct Preset: Codable, Hashable {
        let label: String
        let lat: Double
        let lng: Double
        let name: String
        var start: StartPoint { StartPoint(lat: lat, lng: lng, name: name) }
    }
}

struct StartPoint: Codable, Hashable {
    var lat: Double
    var lng: Double
    var name: String
    var ll: LL { LL(lat: lat, lng: lng) }
}

struct BeautyGrid: Codable, Hashable {
    let bbox: [Double]
    let nx: Int
    let ny: Int
    let scores: [Double]
}

struct Place: Codable, Identifiable, Hashable {
    static func == (a: Place, b: Place) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    let id: String
    let name: String
    let category: String
    let lat: Double
    let lng: Double
    let zone: String?
    let score: Double?
    let blurb: String?
    let see: String?
    let activity: String? // "do" in the JSON
    let tip: String?
    let transit: String?
    let corridor: [LL]?
    let crossing: Bool?
    let endpoint: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, category, lat, lng, zone, score, blurb, see, tip, transit, corridor, crossing, endpoint
        case activity = "do"
    }

    var ll: LL { LL(lat: lat, lng: lng) }
}

enum Cities {
    static let all: [City] = {
        guard let url = Bundle.main.url(forResource: "cities", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let cities = try? JSONDecoder().decode([City].self, from: data)
        else { return [] }
        return cities
    }()

    /// Which city a coordinate falls in (bbox hit, else nearest center).
    static func forPoint(_ pt: LL) -> City {
        for c in all {
            if pt.lng >= c.bbox[0], pt.lng <= c.bbox[2], pt.lat >= c.bbox[1], pt.lat <= c.bbox[3] {
                return c
            }
        }
        return all.min(by: {
            Geo.haversine($0.center, pt) < Geo.haversine($1.center, pt)
        }) ?? all[0]
    }
}

struct CategoryMeta {
    let label: String
    let colorHex: String
    let symbol: String

    static let all: [String: CategoryMeta] = [
        "waterfront": .init(label: "Waterfront", colorHex: "3e7ca6", symbol: "water.waves"),
        "path": .init(label: "Running path", colorHex: "3c7a52", symbol: "figure.run"),
        "park": .init(label: "Park", colorHex: "2c5e40", symbol: "tree"),
        "viewpoint": .init(label: "Viewpoint", colorHex: "d98a4a", symbol: "binoculars"),
        "landmark": .init(label: "Landmark", colorHex: "bf5b45", symbol: "mappin.and.ellipse"),
        "neighborhood": .init(label: "Neighborhood", colorHex: "7d6a9e", symbol: "building.2"),
    ]
}

// MARK: - Planning

struct RoutePlan: Codable {
    var distanceKm: Double
    var shape: RouteShape
    var vibe: [String: Double]
    var profile: String = "walking"
    var jitter: Double = 0
    var boosts: [String: Double] = [:]
    var seen: [String] = []
    var explore: ExploreMode?
    /// "Another" passes the current route's stop ids so the rebuild steers away
    /// from them — regenerating must actually produce a different route.
    var avoid: [String] = []
    /// A destination the route MUST hit (one-way finishes there; loops pass it).
    var dest: StartPoint?
}

enum RouteShape: String, Codable { case loop, oneway }
enum ExploreMode: String, Codable { case new, revisit }

struct RouteGeometry: Codable {
    var coordinates: [LL]
    var distanceMeters: Double
    var durationSec: Double
}

struct Rationale: Codable {
    var thesis: String
    var reasons: [String]
    var alternatives: [Alternative]
    struct Alternative: Codable { var name: String; var why: String }
}

/// Everything the route + run screens need, mirroring the JS `result` object.
struct BuiltRoute {
    var route: RouteGeometry
    var highlights: [Place]
    var shape: RouteShape
    var targetMeters: Double
    var distanceMeters: Double
    var rationale: Rationale?
    var start: StartPoint
    var unit: DistanceUnit
    var plan: RoutePlan
    var city: City
    var community: CommunitySnapshot?
}

enum DistanceUnit: String, Codable, CaseIterable {
    case km, mi
    var meters: Double { self == .mi ? 1609.34 : 1000 }
    func format(_ m: Double) -> String {
        String(format: "%.1f %@", m / meters, rawValue)
    }
}

// MARK: - Settings & plan draft

struct AppSettings: Codable {
    var talk: String = "normal"
    var voice: Bool = true
    var dark: Bool = false
}

struct TalkLevel: Identifiable {
    let id: String
    let label: String
    let ambientSec: Double
    let blurb: String

    static let all: [TalkLevel] = [
        .init(id: "off", label: "Off", ambientSec: .infinity, blurb: "No area narration"),
        .init(id: "low", label: "Less", ambientSec: 300, blurb: "Every ~5 min"),
        .init(id: "normal", label: "Normal", ambientSec: 180, blurb: "Every ~3 min"),
        .init(id: "high", label: "More", ambientSec: 90, blurb: "Every ~90 sec"),
    ]

    static func interval(for key: String) -> Double {
        all.first(where: { $0.id == key })?.ambientSec ?? 180
    }
}

struct PlanDraft: Codable {
    var cityId: String?
    var start: StartPoint?
    var address: String = ""
    var distanceKm: Double = 5
    var unit: DistanceUnit = .km
    var shape: RouteShape = .loop
    var vibes: [String] = []
    var dest: StartPoint?
}

// MARK: - Run history

struct TrackPoint: Codable {
    var lat: Double
    var lng: Double
    var t: Double // unix seconds
}

struct PhotoRecord: Codable, Identifiable {
    var id: Double { ts }
    var fileName: String
    var lat: Double?
    var lng: Double?
    var placeId: String?
    var placeName: String?
    var caption: String = ""
    var ts: Double

    var url: URL { Stores.photosDir.appendingPathComponent(fileName) }
}

struct RunRecord: Codable, Identifiable {
    var id: String
    var ts: Double
    var cityId: String
    var cityName: String
    var unit: DistanceUnit
    var distM: Double
    var elapsed: Double
    var splits: [Double]
    var rating: Int
    var note: String
    var photos: [PhotoRecord]
    var highlights: [HighlightRef]
    var seen: [String]
    var coords: [LL]
    var track: [TrackPoint]
    var stravaActivityId: Double?

    struct HighlightRef: Codable { var id: String; var name: String }
}

// MARK: - Community

struct CommunitySnapshot: Codable {
    var cityId: String
    var totalRuns: Int
    var places: [String: PlaceStats]
    var top: [TopPlace]

    struct PlaceStats: Codable {
        var photos: Int
        var seen: Int
        var loved: Int
        var boost: Double
    }
    struct TopPlace: Codable { var id: String; var photos: Int }
}
