import Foundation
import CoreLocation
import UIKit

/// The live run state machine — port of the RunScreen engine: distance from
/// GPS deltas, splits, turn-by-turn matching, highlight call-outs, ambient
/// narration, finish detection — plus a timestamped GPS track for GPX/Strava.
@MainActor
final class RunEngine: NSObject, ObservableObject {
    // display state
    @Published var position: LL?
    @Published var elapsed: Double = 0
    @Published var distM: Double = 0
    @Published var splitPace: Double = .nan
    @Published var banner: Banner?
    @Published var callout: Callout?
    @Published var paused = false
    @Published var done = false
    @Published var splits: [Double] = []
    @Published var photos: [PhotoRecord] = []
    @Published var locationDenied = false

    struct Banner { var instruction: String; var symbol: String; var meters: Int }
    struct Callout { var name: String; var text: String }

    // configuration
    private let result: BuiltRoute
    private let voice: Bool
    private let ambientInterval: Double

    // engine internals
    private let manager = CLLocationManager()
    private var timer: Timer?
    private var startMs: Double = 0
    private var pausedMs: Double = 0
    private var pauseStart: Double = 0
    private var prev: LL?
    private var splitStartT: Double = 0
    private var splitStartDist: Double = 0
    private var lastUnit = 0
    private var maneuvers: [MapboxAPI.Maneuver] = []
    private var mIdx = 0
    private(set) var announced = Set<String>()
    private var lastAmbient: Double = 0
    private var calloutTask: Task<Void, Never>?
    private(set) var track: [TrackPoint] = []
    var started = false

    private var unitM: Double { result.unit.meters }
    private var routeCoords: [LL] { result.route.coordinates }
    private var finishPt: LL { routeCoords[routeCoords.count - 1] }

    init(result: BuiltRoute, settings: AppSettings) {
        self.result = result
        self.voice = settings.voice
        self.ambientInterval = TalkLevel.interval(for: settings.talk)
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.activityType = .fitness
    }

    func start() async {
        UIApplication.shared.isIdleTimerDisabled = true
        manager.requestWhenInUseAuthorization()
        var m = await MapboxAPI.getManeuvers(routeCoords, profile: result.plan.profile)
        if m.isEmpty { m = Self.turnsFromGeometry(routeCoords) }
        maneuvers = m
        startMs = Date().timeIntervalSince1970 * 1000
        started = true
        SpeechService.shared.speak("Let's go. Starting your run.", voice: voice, priority: true)
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.pauseStart == 0 else { return }
                self.elapsed = (Date().timeIntervalSince1970 * 1000 - self.startMs - self.pausedMs) / 1000
            }
        }
        manager.startUpdatingLocation()
    }

    func stop() {
        UIApplication.shared.isIdleTimerDisabled = false
        timer?.invalidate()
        manager.stopUpdatingLocation()
        calloutTask?.cancel()
        SpeechService.shared.stop()
    }

    func togglePause() {
        let now = Date().timeIntervalSince1970 * 1000
        if pauseStart > 0 {
            pausedMs += now - pauseStart
            pauseStart = 0
            paused = false
        } else {
            pauseStart = now
            paused = true
            SpeechService.shared.stop()
        }
    }

    func finish() {
        guard !done else { return }
        timer?.invalidate()
        manager.stopUpdatingLocation()
        done = true
        Haptics.success()
        let e = (Date().timeIntervalSince1970 * 1000 - startMs - pausedMs) / 1000
        elapsed = e
        SpeechService.shared.speak(
            "Run complete. \(result.unit.format(distM)) in \(Format.clock(e)). Nice work.",
            voice: voice, priority: true
        )
    }

    var avgPace: Double {
        distM > 30 ? elapsed / (distM / unitM) : .nan
    }

    func addPhoto(_ image: UIImage) {
        guard let fileName = Stores.persistPhoto(image) else { return }
        let cur = prev
        let near = cur.flatMap { nearestHighlight($0) }
        let photo = PhotoRecord(
            fileName: fileName,
            lat: cur?.lat, lng: cur?.lng,
            placeId: near?.id, placeName: near?.name,
            caption: "", ts: Date().timeIntervalSince1970 * 1000
        )
        photos.append(photo)
        Haptics.success()
        if let near {
            showCallout(name: near.name, text: "Photo saved — spots you shoot rank higher in future routes.")
        }
    }

    func setCaption(_ caption: String, forPhotoTs ts: Double) {
        for i in photos.indices where photos[i].ts == ts { photos[i].caption = caption }
    }

    func makeRecord(rating: Int, note: String) -> RunRecord {
        let stride = max(1, Int(ceil(Double(routeCoords.count) / 100)))
        var coords = routeCoords.enumerated().filter { $0.offset % stride == 0 }.map(\.element)
        if let last = routeCoords.last { coords.append(last) }
        return RunRecord(
            id: String(Int(Date().timeIntervalSince1970 * 1000)),
            ts: Date().timeIntervalSince1970 * 1000,
            cityId: result.city.id, cityName: result.city.name,
            unit: result.unit, distM: distM, elapsed: elapsed.rounded(),
            splits: splits, rating: rating, note: note,
            photos: photos,
            highlights: result.highlights.map { .init(id: $0.id, name: $0.name) },
            seen: Array(announced), coords: coords, track: track,
            stravaActivityId: nil
        )
    }

    // MARK: - Location handling

    private func handle(_ loc: CLLocation) {
        guard pauseStart == 0, started, !done else { return }
        let cur = LL(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude)
        position = cur
        track.append(TrackPoint(lat: cur.lat, lng: cur.lng, t: loc.timestamp.timeIntervalSince1970))
        let e = (Date().timeIntervalSince1970 * 1000 - startMs - pausedMs) / 1000

        if let p = prev {
            let d = Geo.haversine(p, cur)
            if d >= 2, d < 70 { distM += d }
        }
        prev = cur

        // splits
        let completed = Int(distM / unitM)
        if completed > lastUnit {
            splits.append(e - splitStartT)
            lastUnit = completed
            splitStartT = e
            splitStartDist = Double(completed) * unitM
        }
        let into = distM - splitStartDist
        splitPace = into > 25 ? (e - splitStartT) / (into / unitM) : .nan

        // turn-by-turn
        if mIdx < maneuvers.count {
            while mIdx + 1 < maneuvers.count,
                  Geo.haversine(cur, maneuvers[mIdx + 1].ll) < Geo.haversine(cur, maneuvers[mIdx].ll) {
                mIdx += 1
            }
            let m = maneuvers[mIdx]
            let dM = Geo.haversine(cur, m.ll)
            banner = Banner(instruction: m.instruction, symbol: Self.maneuverSymbol(m), meters: Int(dM.rounded()))
            if !m.said, dM < 32 {
                maneuvers[mIdx].said = true
                SpeechService.shared.speak(m.instruction, voice: voice, priority: true)
                mIdx += 1
            }
        } else {
            banner = nil
        }

        // highlight call-outs
        for h in result.highlights where !announced.contains(h.id) {
            let hp = h.corridor != nil ? Self.nearestCorridorPt(cur, h) : h.ll
            if Geo.haversine(cur, hp) < 38 {
                announced.insert(h.id)
                let sentence = h.see ?? h.blurb ?? h.name
                showCallout(name: h.name, text: sentence)
                SpeechService.shared.speak("\(h.name). \(sentence)", voice: voice)
            }
        }

        // ambient narration
        let now = Date().timeIntervalSince1970 * 1000
        if voice, ambientInterval.isFinite, now - lastAmbient > ambientInterval * 1000 {
            if let near = nearestPlace(cur) {
                lastAmbient = now
                let text = near.see ?? near.blurb ?? ""
                SpeechService.shared.speak("You're passing \(near.name). \(text)", voice: voice)
                showCallout(name: near.name, text: text)
            }
        }

        // finish detection
        if Geo.haversine(cur, finishPt) < 28, distM > result.route.distanceMeters * 0.6 {
            finish()
        } else if distM >= result.route.distanceMeters * 0.98 {
            finish()
        }
    }

    private func showCallout(name: String, text: String) {
        callout = Callout(name: name, text: text)
        calloutTask?.cancel()
        calloutTask = Task {
            try? await Task.sleep(nanoseconds: 9_000_000_000)
            if !Task.isCancelled { callout = nil }
        }
    }

    private func nearestHighlight(_ cur: LL) -> Place? {
        var best: Place?
        var bd = 150.0
        for h in result.highlights {
            let hp = h.corridor != nil ? Self.nearestCorridorPt(cur, h) : h.ll
            let d = Geo.haversine(cur, hp)
            if d < bd { bd = d; best = h }
        }
        return best
    }

    private func nearestPlace(_ cur: LL) -> Place? {
        var best: Place?
        var bd = 280.0
        for p in result.city.places where !announced.contains(p.id) {
            let pt = p.corridor != nil ? Self.nearestCorridorPt(cur, p) : p.ll
            let d = Geo.haversine(cur, pt)
            if d < bd { bd = d; best = p }
        }
        if let b = best { announced.insert(b.id) }
        return best
    }

    private static func nearestCorridorPt(_ cur: LL, _ p: Place) -> LL {
        guard let c = p.corridor, !c.isEmpty else { return p.ll }
        return c.min(by: { Geo.haversine(cur, $0) < Geo.haversine(cur, $1) }) ?? p.ll
    }

    // MARK: - Maneuver helpers

    /// Fallback turn list derived from route geometry when Map Matching is empty.
    static func turnsFromGeometry(_ coords: [LL]) -> [MapboxAPI.Maneuver] {
        guard coords.count >= 3 else { return [] }
        var simp = [coords[0]]
        for p in coords.dropFirst() where Geo.haversine(simp[simp.count - 1], p) >= 30 {
            simp.append(p)
        }
        var turns: [MapboxAPI.Maneuver] = []
        guard simp.count >= 3 else { return [] }
        for i in 1..<(simp.count - 1) {
            let b1 = Geo.bearing(simp[i - 1], simp[i])
            let b2 = Geo.bearing(simp[i], simp[i + 1])
            let d = (b2 - b1 + 540).truncatingRemainder(dividingBy: 360) - 180
            if abs(d) >= 35 {
                let side = d > 0 ? "right" : "left"
                turns.append(MapboxAPI.Maneuver(
                    lat: simp[i].lat, lng: simp[i].lng,
                    instruction: "Turn \(side)", type: "turn", modifier: side
                ))
            }
        }
        return turns
    }

    /// SF Symbol for a maneuver, for the visual banner.
    static func maneuverSymbol(_ m: MapboxAPI.Maneuver) -> String {
        if m.type == "arrive" { return "flag.checkered" }
        if m.type == "depart" { return "figure.run" }
        if m.modifier.lowercased().contains("left") { return "arrow.turn.up.left" }
        if m.modifier.lowercased().contains("right") { return "arrow.turn.up.right" }
        return "arrow.up"
    }
}

extension RunEngine: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in self.handle(loc) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.locationDenied = status == .denied || status == .restricted
        }
    }
}
