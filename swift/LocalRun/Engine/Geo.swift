import Foundation

/// Spherical geometry helpers — direct port of src/lib/geo.js.
enum Geo {
    static let earthR = 6_371_000.0

    static func rad(_ d: Double) -> Double { d * .pi / 180 }
    static func deg(_ r: Double) -> Double { r * 180 / .pi }

    static func haversine(_ a: LL, _ b: LL) -> Double {
        let dLat = rad(b.lat - a.lat)
        let dLng = rad(b.lng - a.lng)
        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(rad(a.lat)) * cos(rad(b.lat)) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * earthR * asin(min(1, sqrt(h)))
    }

    /// Initial bearing a -> b, degrees clockwise from north (0..360).
    static func bearing(_ a: LL, _ b: LL) -> Double {
        let lat1 = rad(a.lat), lat2 = rad(b.lat)
        let dLng = rad(b.lng - a.lng)
        let y = sin(dLng) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
        return (deg(atan2(y, x)) + 360).truncatingRemainder(dividingBy: 360)
    }

    /// Smallest absolute difference between two bearings, 0..180.
    static func angularDiff(_ a: Double, _ b: Double) -> Double {
        let d = abs(a - b).truncatingRemainder(dividingBy: 360)
        return d > 180 ? 360 - d : d
    }

    /// Point reached by traveling distMeters from `from` along bearingDeg.
    static func destination(_ from: LL, bearingDeg: Double, distMeters: Double) -> LL {
        let d = distMeters / earthR
        let brng = rad(bearingDeg)
        let lat1 = rad(from.lat), lng1 = rad(from.lng)
        let lat2 = asin(sin(lat1) * cos(d) + cos(lat1) * sin(d) * cos(brng))
        let lng2 = lng1 + atan2(sin(brng) * sin(d) * cos(lat1), cos(d) - sin(lat1) * sin(lat2))
        let lngDeg = (deg(lng2) + 540).truncatingRemainder(dividingBy: 360) - 180
        return LL(lat: deg(lat2), lng: lngDeg)
    }
}

enum Format {
    /// seconds -> "h:mm:ss" / "m:ss"
    static func clock(_ sec: Double) -> String {
        let s = max(0, Int(sec.rounded()))
        let h = s / 3600, m = (s % 3600) / 60, r = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%d:%02d", m, r)
    }

    /// seconds-per-unit -> "m:ss"
    static func pace(_ secPerUnit: Double) -> String {
        guard secPerUnit.isFinite, secPerUnit > 0 else { return "—" }
        let m = Int(secPerUnit) / 60
        let s = Int(secPerUnit.rounded()) % 60
        return String(format: "%d:%02d", m, s)
    }

    /// Estimated run time at a pace (min/km).
    static func runTime(_ meters: Double, paceMinPerKm: Double = 6) -> String {
        let mins = Int((meters / 1000 * paceMinPerKm).rounded())
        if mins < 60 { return "\(mins) min" }
        return "\(mins / 60)h \(mins % 60)m"
    }
}
