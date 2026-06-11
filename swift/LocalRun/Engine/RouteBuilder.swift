import Foundation

/// The "brain": (start, distance, shape, vibe, city) -> a scenic route plus a
/// human explanation. Direct port of src/lib/routeBuilder.js — including the
/// circularize pass (loops must circle, never retrace) and the scenicize pass
/// (the streets BETWEEN stops are optimized for scenery, never for speed).
enum RouteBuilder {
    static let streetFactor = 1.28
    static let maxWaypoints = 6
    static let maxCoords = 25
    static let crossingPenalty = 2400.0
    static let tolerance = 0.05

    struct BuildError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// A place annotated relative to a start point (the JS `_d/_b/_zone/_boost`),
    /// with a windowable corridor copy.
    struct Annotated {
        var place: Place
        var corridor: [LL]?
        var d: Double
        var b: Double
        var zone: String
        var boost: Double

        var id: String { place.id }
        var score: Double { place.score ?? 3 }
        var ll: LL { place.ll }
        var isCrossing: Bool { place.crossing ?? false }

        func ends() -> (a: LL, b: LL) {
            if let c = corridor, !c.isEmpty { return (c[0], c[c.count - 1]) }
            return (ll, ll)
        }

        var scenicLength: Double {
            guard let c = corridor, c.count > 1 else { return 0 }
            var d = 0.0
            for i in 1..<c.count { d += Geo.haversine(c[i - 1], c[i]) }
            return d
        }
    }

    struct Output {
        var route: RouteGeometry
        var highlights: [Place]
        var shape: RouteShape
        var targetMeters: Double
        var distanceMeters: Double
        var rationale: Rationale
        /// annotated stops actually used (for rationale/debug)
        var stops: [Annotated]
    }

    // MARK: - Annotation

    static func annotate(start: LL, city: City, plan: RoutePlan) -> [Annotated] {
        let seenSet = Set(plan.seen)
        let avoidSet = Set(plan.avoid)
        return city.places.map { p in
            var boost = 1.0
            if let b = plan.boosts[p.id], b > 0 { boost = 1 + min(b, 5) * 0.12 }
            if plan.explore == .new, seenSet.contains(p.id) { boost *= 0.3 }
            else if plan.explore == .revisit, seenSet.contains(p.id) { boost *= 1.45 }
            if avoidSet.contains(p.id) { boost *= 0.45 } // soft: still usable if it's all there is
            let d: Double
            if let c = p.corridor, !c.isEmpty {
                d = c.map { Geo.haversine(start, $0) }.min() ?? 0
            } else {
                d = Geo.haversine(start, p.ll)
            }
            return Annotated(
                place: p, corridor: p.corridor, d: d,
                b: Geo.bearing(start, p.ll),
                zone: p.zone ?? city.primaryZone,
                boost: boost
            )
        }
    }

    static func value(_ p: Annotated, vibe: [String: Double], jitter: Double) -> Double {
        let base = p.score * p.boost
        let w = vibe[p.place.category] ?? 1
        let noise = jitter > 0 ? 1 + (Double.random(in: 0...1) - 0.5) * jitter : 1
        return base * w * noise
    }

    static func zoneForStart(_ start: LL, _ annotated: [Annotated], _ city: City) -> String {
        annotated.min(by: { $0.d < $1.d })?.zone ?? city.primaryZone
    }

    // MARK: - Loop length estimation & selection

    static func nearestPoint(_ prev: LL, _ p: Annotated) -> LL {
        guard let c = p.corridor, !c.isEmpty else { return p.ll }
        return c.min(by: { Geo.haversine(prev, $0) < Geo.haversine(prev, $1) }) ?? p.ll
    }

    static func loopEstimate(start: LL, set: [Annotated], startZone: String, maxScenic: Double = .infinity) -> Double {
        guard !set.isEmpty else { return 0 }
        let ordered = set.sorted { $0.b < $1.b }
        var dist = 0.0
        var prev = start
        for p in ordered {
            let sl = min(p.scenicLength, maxScenic)
            if p.isCrossing {
                let e = p.ends()
                let near = Geo.haversine(prev, e.a) <= Geo.haversine(prev, e.b) ? e.a : e.b
                dist += Geo.haversine(prev, near) + 2 * sl
                prev = near
            } else if p.zone != startZone {
                let e = p.ends()
                let near = Geo.haversine(prev, e.a) <= Geo.haversine(prev, e.b) ? e.a : e.b
                dist += 2 * Geo.haversine(prev, near) + 2 * crossingPenalty
            } else if let c = p.corridor, !c.isEmpty {
                let near = nearestPoint(prev, p)
                dist += Geo.haversine(prev, near) + sl
                prev = near
            } else {
                dist += Geo.haversine(prev, p.ll)
                prev = p.ll
            }
        }
        dist += Geo.haversine(prev, start)
        return dist * streetFactor
    }

    static func selectLoopWaypoints(
        start: LL, target: Double, vibe: [String: Double], jitter: Double,
        annotated: [Annotated], startZone: String
    ) -> [Annotated] {
        let candidates = annotated.filter { ($0.corridor != nil || $0.d > 150) && $0.d <= target * 0.55 }
        var selected: [Annotated] = []
        var pool = candidates
        let maxScenic = target * 0.85

        while selected.count < maxWaypoints, !pool.isEmpty {
            var best: Annotated?
            var bestScore = -Double.infinity
            for cand in pool {
                let len = loopEstimate(start: start, set: selected + [cand], startZone: startZone, maxScenic: maxScenic)
                if len > target * 1.1 { continue }
                let scenicBonus = 1 + (cand.scenicLength / 1000) * 0.6
                let diversity = selected.contains(where: { $0.place.category == cand.place.category }) ? 0.85 : 1.2
                let score = value(cand, vibe: vibe, jitter: jitter) * scenicBonus * diversity
                if score > bestScore { bestScore = score; best = cand }
            }
            guard let b = best else { break }
            selected.append(b)
            pool.removeAll { $0.id == b.id }
        }

        // Fill pass: close the gap with worthwhile stops.
        while selected.count < maxWaypoints + 1, !pool.isEmpty,
              loopEstimate(start: start, set: selected, startZone: startZone, maxScenic: maxScenic) < target * 0.9 {
            var best: Annotated?
            var bestGap = Double.infinity
            for cand in pool {
                if cand.score < 3 { continue }
                let len = loopEstimate(start: start, set: selected + [cand], startZone: startZone, maxScenic: maxScenic)
                if len > target * 1.25 { continue }
                let gap = abs(target - len)
                if gap < bestGap { bestGap = gap; best = cand }
            }
            guard let b = best else { break }
            selected.append(b)
            pool.removeAll { $0.id == b.id }
        }
        return selected.sorted { $0.b < $1.b }
    }

    static let journeyWeight: [String: Double] = [
        "path": 1.7, "waterfront": 1.6, "park": 1.4,
        "viewpoint": 1.1, "landmark": 0.95, "neighborhood": 0.85,
    ]

    static func selectScenicChain(
        start: LL, target: Double, vibe: [String: Double], jitter: Double,
        annotated: [Annotated], startZone: String
    ) -> [Annotated] {
        let maxScenic = target * 0.85
        let cands = annotated.filter {
            $0.zone == startZone && ($0.corridor != nil || $0.d > 150) && $0.d <= target * 0.6
        }
        func scoreOf(_ p: Annotated) -> Double {
            value(p, vibe: vibe, jitter: jitter)
                * (1 + (p.scenicLength / 1000) * 1.2)
                * (journeyWeight[p.place.category] ?? 1)
                * (p.corridor != nil ? 1.5 : 1)
        }
        let pool = cands.sorted { scoreOf($0) > scoreOf($1) }
        var selected: [Annotated] = []
        for cand in pool {
            if selected.count >= 4 { break }
            if loopEstimate(start: start, set: selected + [cand], startZone: startZone, maxScenic: maxScenic) > target * 1.12 { continue }
            selected.append(cand)
        }
        return selected.sorted { $0.b < $1.b }
    }

    // MARK: - Scenery scoring

    static func segDistMeters(_ p: LL, _ a: LL, _ b: LL) -> Double {
        let mLat = 111_320.0
        let mLng = 111_320.0 * cos(p.lat * .pi / 180)
        let ax = (a.lng - p.lng) * mLng, ay = (a.lat - p.lat) * mLat
        let bx = (b.lng - p.lng) * mLng, by = (b.lat - p.lat) * mLat
        let dx = bx - ax, dy = by - ay
        let len2 = dx * dx + dy * dy
        var t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
        t = max(0, min(1, t))
        let cx = ax + t * dx, cy = ay + t * dy
        return sqrt(cx * cx + cy * cy)
    }

    static func nearestFeature(_ pt: LL, _ annotated: [Annotated]) -> (dmin: Double, nearest: Annotated?) {
        var dmin = Double.infinity
        var nearest: Annotated?
        for p in annotated {
            var d: Double
            if let c = p.corridor, c.count > 1 {
                d = .infinity
                for i in 1..<c.count { d = min(d, segDistMeters(pt, c[i - 1], c[i])) }
            } else {
                d = Geo.haversine(pt, p.ll)
            }
            if d < dmin { dmin = d; nearest = p }
        }
        return (dmin, nearest)
    }

    static func sampleAlong(_ coords: [LL], step: Double) -> [LL] {
        guard coords.count >= 2 else { return coords }
        var pts: [LL] = []
        var carry = 0.0
        for i in 1..<coords.count {
            let a = coords[i - 1], b = coords[i]
            let segLen = Geo.haversine(a, b)
            if segLen == 0 { continue }
            var dist = carry
            while dist < segLen {
                let t = dist / segLen
                pts.append(LL(lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t))
                dist += step
            }
            carry = dist - segLen
        }
        if let last = coords.last { pts.append(last) }
        return pts
    }

    static func beautyAt(_ beauty: BeautyGrid?, _ p: LL) -> Double {
        guard let g = beauty else { return 0 }
        let (w, s, e, n) = (g.bbox[0], g.bbox[1], g.bbox[2], g.bbox[3])
        guard p.lng >= w, p.lng <= e, p.lat >= s, p.lat <= n else { return 0 }
        let i = min(g.nx - 1, Int((p.lng - w) / (e - w) * Double(g.nx)))
        let j = min(g.ny - 1, Int((p.lat - s) / (n - s) * Double(g.ny)))
        let idx = j * g.nx + i
        guard idx >= 0, idx < g.scores.count else { return 0 }
        return g.scores[idx] / 100
    }

    /// Beauty-of-ground and dead stretches weigh heavily — the en-route
    /// experience is the product, not the speed between stops.
    static func sceneryScore(_ coords: [LL], _ annotated: [Annotated], _ beauty: BeautyGrid?) -> Double {
        let samples = sampleAlong(coords, step: 120)
        guard !samples.isEmpty else { return 0 }
        var prox = 0.0, dead = 0.0, beautySum = 0.0
        var seen = Set<String>()
        for s in samples {
            let (dmin, nearest) = nearestFeature(s, annotated)
            prox += max(0, 1 - dmin / 300)
            beautySum += beautyAt(beauty, s)
            if dmin > 350 { dead += 1 }
            if dmin < 200, let n = nearest { seen.insert(n.id) }
        }
        let n = Double(samples.count)
        return prox / n + (beautySum / n) * 1.4 + Double(min(seen.count, 10)) * 0.05 - (dead / n) * 1.1
    }

    /// Fraction of the route that runs close to a non-adjacent part of itself.
    static func selfOverlap(_ coords: [LL]) -> Double {
        let s = sampleAlong(coords, step: 80)
        guard s.count >= 8 else { return 0 }
        var overlap = 0
        for i in 0..<s.count {
            // unlike JS, Swift traps on an inverted range — stop once i+4 passes the end
            guard i + 4 < s.count else { break }
            for j in (i + 4)..<s.count where Geo.haversine(s[i], s[j]) < 35 {
                overlap += 1
                break
            }
        }
        return Double(overlap) / Double(s.count)
    }

    // MARK: - Sequencing, circularizing, routing

    static func capCoords(_ input: [LL]) -> [LL] {
        var coords = input
        while coords.count > maxCoords {
            var idx = -1
            var least = Double.infinity
            for i in 1..<(coords.count - 1) {
                let detour = Geo.haversine(coords[i - 1], coords[i])
                    + Geo.haversine(coords[i], coords[i + 1])
                    - Geo.haversine(coords[i - 1], coords[i + 1])
                if detour < least { least = detour; idx = i }
            }
            if idx < 0 { break }
            coords.remove(at: idx)
        }
        return coords
    }

    /// Loops must circle: single stops get a perpendicular lens; one-direction
    /// routes get an outward bulge on the return leg.
    static func circularize(_ start: LL, _ coords: [LL]) -> [LL] {
        guard coords.count >= 3 else { return coords }
        let pts = Array(coords[1..<(coords.count - 1)])
        func offFor(_ d: Double) -> Double { min(900, max(150, d * 0.33)) }

        if pts.count == 1 {
            let p = pts[0]
            let mid = LL(lat: (start.lat + p.lat) / 2, lng: (start.lng + p.lng) / 2)
            let perp = Geo.bearing(start, p) + 90
            let off = offFor(Geo.haversine(start, p))
            return [start,
                    Geo.destination(mid, bearingDeg: perp, distMeters: off),
                    p,
                    Geo.destination(mid, bearingDeg: perp - 180, distMeters: off),
                    start]
        }

        let bs = pts.map { Geo.bearing(start, $0) }
        var spread = 0.0
        for i in 0..<bs.count {
            for j in (i + 1)..<bs.count { spread = max(spread, Geo.angularDiff(bs[i], bs[j])) }
        }
        if spread >= 100 { return coords }

        let lastP = pts[pts.count - 1]
        let mid = LL(lat: (start.lat + lastP.lat) / 2, lng: (start.lng + lastP.lng) / 2)
        let axis = Geo.bearing(start, lastP)
        let off = offFor(Geo.haversine(start, lastP))
        let cen = LL(
            lat: pts.map(\.lat).reduce(0, +) / Double(pts.count),
            lng: pts.map(\.lng).reduce(0, +) / Double(pts.count)
        )
        let sideA = Geo.destination(mid, bearingDeg: axis + 90, distMeters: off)
        let sideB = Geo.destination(mid, bearingDeg: axis - 90, distMeters: off)
        let via = Geo.haversine(sideA, cen) >= Geo.haversine(sideB, cen) ? sideA : sideB
        return Array(coords[0..<(coords.count - 1)]) + [via, start]
    }

    static func coordSequence(start: LL, waypoints: [Annotated], shape: RouteShape) -> [LL] {
        var coords = [start]
        var prev = start
        for p in waypoints {
            if let c = p.corridor, !c.isEmpty {
                let pts = Geo.haversine(prev, c[0]) <= Geo.haversine(prev, c[c.count - 1]) ? c : Array(c.reversed())
                coords.append(contentsOf: pts)
                prev = coords[coords.count - 1]
            } else {
                coords.append(p.ll)
                prev = p.ll
            }
        }
        if shape == .loop {
            coords.append(start)
            return capCoords(circularize(start, coords))
        }
        return capCoords(coords)
    }

    static func routeFor(start: LL, waypoints: [Annotated], shape: RouteShape, profile: String) async throws -> RouteGeometry {
        try await MapboxAPI.getRoute(coordSequence(start: start, waypoints: waypoints, shape: shape), profile: profile)
    }

    static func orderWaypoints(_ ws: [Annotated], shape: RouteShape) -> [Annotated] {
        shape == .loop ? ws.sorted { $0.b < $1.b } : ws.sorted { $0.d < $1.d }
    }

    static func trimOne(_ waypoints: [Annotated], shape: RouteShape) -> [Annotated] {
        guard waypoints.count > 1 else { return waypoints }
        let removable = shape == .oneway ? Array(waypoints.dropLast()) : waypoints
        func keepValue(_ p: Annotated) -> Double {
            p.score + (p.corridor != nil ? 4 + p.scenicLength / 1000 : 0)
        }
        guard let worst = removable.min(by: { keepValue($0) < keepValue($1) }) else { return waypoints }
        return waypoints.filter { $0.id != worst.id }
    }

    // MARK: - Scenicize: bend the legs between stops toward scenery

    static func scenicize(
        start: LL, waypoints: [Annotated], shape: RouteShape, route: RouteGeometry,
        annotated: [Annotated], beauty: BeautyGrid?, profile: String, target: Double
    ) async -> (waypoints: [Annotated], route: RouteGeometry) {
        var curWps = waypoints
        var curRoute = route
        func evalRoute(_ r: RouteGeometry) -> (ov: Double, s: Double) {
            let ov = selfOverlap(r.coordinates)
            return (ov, sceneryScore(r.coordinates, annotated, beauty) - 0.9 * ov)
        }
        var cur = evalRoute(curRoute)
        let cap = target * 1.12

        for _ in 0..<2 {
            let used = Set(curWps.map(\.id))
            var reps = [start] + curWps.map(\.ll)
            if shape == .loop { reps.append(start) }
            struct Cand { let p: Annotated; let idx: Int; let rank: Double }
            var cands: [Cand] = []
            for i in 0..<(reps.count - 1) {
                let a = reps[i], b = reps[i + 1]
                let legLen = Geo.haversine(a, b)
                if legLen < 500 { continue }
                let budget = min(900, legLen * 0.45)
                for p in annotated where !used.contains(p.id) && p.corridor == nil {
                    let detour = Geo.haversine(a, p.ll) + Geo.haversine(p.ll, b) - legLen
                    if detour <= 30 || detour > budget { continue }
                    let gain = p.score * p.boost + beautyAt(beauty, p.ll) * 4
                    cands.append(Cand(p: p, idx: i, rank: gain / (1 + detour / 300)))
                }
            }
            cands.sort { $0.rank > $1.rank }
            var improved = false
            for c in cands.prefix(4) {
                var trial = curWps
                trial.insert(c.p, at: min(c.idx, trial.count))
                guard let r = try? await routeFor(start: start, waypoints: trial, shape: shape, profile: profile) else { continue }
                if r.distanceMeters > cap { continue }
                let e = evalRoute(r)
                if e.ov > cur.ov + 0.08 { continue } // scenery never buys doubling back
                if e.s > cur.s + 0.015 {
                    curWps = trial; curRoute = r; cur = e; improved = true
                    break
                }
            }
            if !improved { break }
        }
        return (curWps, curRoute)
    }

    // MARK: - Distance fitting

    static func fitLongCorridor(
        start: LL, waypoints: [Annotated], shape: RouteShape, target: Double,
        profile: String, route: RouteGeometry
    ) async -> (waypoints: [Annotated], route: RouteGeometry) {
        guard let idx = waypoints.firstIndex(where: { ($0.corridor?.count ?? 0) > 2 }),
              let full = waypoints[idx].corridor
        else { return (waypoints, route) }
        var cen = 0
        var cd = Double.infinity
        for (i, c) in full.enumerated() {
            let d = Geo.haversine(start, c)
            if d < cd { cd = d; cen = i }
        }
        var lo = 2
        var hi = full.count
        var best = (waypoints: waypoints, route: route)
        var bestErr = abs(route.distanceMeters - target)
        var under: (waypoints: [Annotated], route: RouteGeometry)?

        for _ in 0..<6 {
            let keep = max(2, (lo + hi) / 2)
            let half = keep / 2
            var a = max(0, cen - half)
            let b = min(full.count, a + keep)
            a = max(0, b - keep)
            var wp = waypoints
            wp[idx].corridor = Array(full[a..<b])
            guard let r = try? await routeFor(start: start, waypoints: wp, shape: shape, profile: profile) else { break }
            let err = abs(r.distanceMeters - target)
            if err < bestErr { bestErr = err; best = (wp, r) }
            if r.distanceMeters <= target * 1.02,
               under == nil || r.distanceMeters > under!.route.distanceMeters {
                under = (wp, r)
            }
            if err <= target * tolerance { return (wp, r) }
            if r.distanceMeters > target { hi = keep } else { lo = keep }
        }
        return under ?? best
    }

    /// Measured top-up. The extension aims into the EMPTIEST angular sector of
    /// the circuit and is folded into the loop in bearing order — extra distance
    /// rounds the circle out instead of bolting a tail past the start.
    static func addSpur(
        start: LL, waypoints: [Annotated], shape: RouteShape, target: Double,
        profile: String, beauty: BeautyGrid?, baseOverlap: Double = 1
    ) async -> RouteGeometry? {
        // middle of the largest bearing gap between existing stops
        let bs = waypoints.map(\.b).sorted()
        var gapStart = bs[bs.count - 1]
        var gapSize = bs[0] + 360 - gapStart
        for i in 1..<bs.count where bs[i] - bs[i - 1] > gapSize {
            gapSize = bs[i] - bs[i - 1]
            gapStart = bs[i - 1]
        }
        var baseDir = (gapStart + gapSize / 2).truncatingRemainder(dividingBy: 360)
        // Never diametric: a spur opposite the only stop puts the START on the
        // line between them — the route passes home and retraces. Keep within
        // 110° of the nearest stop so the circuit stays a triangle.
        var nearestB = bs[0]
        var nearestDiff = 360.0
        for b in bs {
            let ad = Geo.angularDiff(baseDir, b)
            if ad < nearestDiff { nearestDiff = ad; nearestB = b }
        }
        if nearestDiff > 110 {
            let a = nearestB + 110
            let b2 = nearestB - 110
            baseDir = Geo.angularDiff(a, baseDir) <= Geo.angularDiff(b2, baseDir) ? a : b2
        }
        var dir = baseDir
        if beauty != nil {
            var best = -1.0
            for dd in [-40.0, -20, 0, 20, 40] {
                let probe = Geo.destination(start, bearingDeg: baseDir + dd, distMeters: target * 0.25)
                let bv = beautyAt(beauty, probe)
                if bv > best { best = bv; dir = baseDir + dd }
            }
        }
        var lo = 50.0
        var hi = target * 0.6
        var best: RouteGeometry?
        var bestErr = Double.infinity
        for _ in 0..<7 {
            let d = (lo + hi) / 2
            let p = Geo.destination(start, bearingDeg: dir, distMeters: d)
            let normB = (dir.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
            let spur = Annotated(
                place: Place(id: "_spur", name: "_spur", category: "landmark", lat: p.lat, lng: p.lng,
                             zone: nil, score: 0, blurb: nil, see: nil, activity: nil, tip: nil,
                             transit: nil, corridor: nil, crossing: nil, endpoint: nil),
                corridor: nil, d: d, b: normB, zone: "", boost: 1
            )
            let seq = shape == .loop ? orderWaypoints(waypoints + [spur], shape: shape) : waypoints + [spur]
            guard let r = try? await routeFor(start: start, waypoints: seq, shape: shape, profile: profile) else {
                hi = d // spur point unroutable — pull it closer
                continue
            }
            // distance is never worth doubling back: a retracing spur is rejected
            let acceptable = selfOverlap(r.coordinates) <= baseOverlap + 0.1
            let err = abs(r.distanceMeters - target)
            if acceptable, err < bestErr { bestErr = err; best = r }
            if acceptable, err <= target * tolerance { return r }
            if r.distanceMeters < target { lo = d } else { hi = d }
        }
        return best
    }

    static func addOnewayDetour(
        start: LL, waypoints: [Annotated], target: Double, profile: String
    ) async -> RouteGeometry? {
        guard let dest = waypoints.last else { return nil }
        let mid = LL(lat: (start.lat + dest.place.lat) / 2, lng: (start.lng + dest.place.lng) / 2)
        let perp = Geo.bearing(start, dest.ll) + 90
        let destD = waypoints.map(\.d).max() ?? 0
        var lo = 0.0
        var hi = target * 0.45
        var best: RouteGeometry?
        var bestErr = Double.infinity
        for _ in 0..<7 {
            let d = (lo + hi) / 2
            let p = Geo.destination(mid, bearingDeg: perp, distMeters: d)
            let detour = Annotated(
                place: Place(id: "_detour", name: "_detour", category: "landmark", lat: p.lat, lng: p.lng,
                             zone: nil, score: 0, blurb: nil, see: nil, activity: nil, tip: nil,
                             transit: nil, corridor: nil, crossing: nil, endpoint: nil),
                corridor: nil, d: min(destD * 0.6, target * 0.4), b: 0, zone: "", boost: 1
            )
            let seq = (waypoints + [detour]).sorted { $0.d < $1.d }
            guard let r = try? await routeFor(start: start, waypoints: seq, shape: .oneway, profile: profile) else {
                hi = d
                continue
            }
            let err = abs(r.distanceMeters - target)
            if err < bestErr { bestErr = err; best = r }
            if err <= target * tolerance { return r }
            if r.distanceMeters < target { lo = d } else { hi = d }
        }
        return best
    }

    static func selectOneWayDest(
        start: LL, target: Double, vibe: [String: Double], jitter: Double,
        annotated: [Annotated], startZone: String, profile: String
    ) async -> [Annotated] {
        let filtered = annotated.filter {
            $0.zone == startZone && $0.d > target * 0.1 && $0.d < target * 1.05
                && (($0.place.endpoint ?? false) || $0.score >= 3)
        }
        let ranked = filtered
            .map { p in (p, value(p, vibe: vibe, jitter: jitter)
                + ((p.place.endpoint ?? false) ? 1.6 : 0)
                + (p.place.transit != nil ? 0.6 : 0)) }
            .sorted { $0.1 > $1.1 }
            .prefix(10)
            .map(\.0)

        if ranked.isEmpty {
            let f = annotated.min(by: { abs($0.d - target * 0.72) < abs($1.d - target * 0.72) })
            return f.map { [$0] } ?? []
        }

        var measured: [(Annotated, Double)] = []
        await withTaskGroup(of: (Annotated, Double)?.self) { group in
            for d in ranked {
                group.addTask {
                    guard let r = try? await routeFor(start: start, waypoints: [d], shape: .oneway, profile: profile) else { return nil }
                    let overshoot = max(0, r.distanceMeters - target * 1.02)
                    return (d, abs(r.distanceMeters - target) + overshoot * 0.5)
                }
            }
            for await item in group { if let item { measured.append(item) } }
        }
        measured.sort { $0.1 < $1.1 }
        return measured.first.map { [$0.0] } ?? []
    }

    // MARK: - Public entry point

    static func build(start: StartPoint, plan: RoutePlan, city: City) async throws -> Output {
        let startLL = start.ll
        let target = plan.distanceKm * 1000
        let annotated = annotate(start: startLL, city: city, plan: plan)
        let startZone = zoneForStart(startLL, annotated, city)
        let vibe = plan.vibe
        let profile = plan.profile

        var waypoints: [Annotated]
        var route: RouteGeometry

        if plan.shape == .loop {
            var sets = [
                selectScenicChain(start: startLL, target: target, vibe: vibe, jitter: plan.jitter, annotated: annotated, startZone: startZone),
                selectScenicChain(start: startLL, target: target, vibe: vibe, jitter: 0.5, annotated: annotated, startZone: startZone),
                selectLoopWaypoints(start: startLL, target: target, vibe: vibe, jitter: plan.jitter, annotated: annotated, startZone: startZone),
                selectLoopWaypoints(start: startLL, target: target, vibe: vibe, jitter: 0.6, annotated: annotated, startZone: startZone),
            ].filter { !$0.isEmpty }
            // dedupe by stop ids
            var seenKeys = Set<String>()
            sets = sets.filter { set in
                let key = set.map(\.id).sorted().joined(separator: ",")
                return seenKeys.insert(key).inserted
            }
            if sets.isEmpty {
                // Standing on the only sight (or an empty pocket): synthesize an
                // unnamed anchor toward the most scenic reachable direction so
                // the lens still makes a clean circle of the right size.
                var bestDir = 0.0
                var bestScore = -Double.infinity
                for dd in stride(from: 0.0, to: 360, by: 45) {
                    let probe = Geo.destination(startLL, bearingDeg: dd, distMeters: target * 0.3)
                    let (dmin, _) = nearestFeature(probe, annotated)
                    let sc = beautyAt(city.beauty, probe) * 2 + max(0, 1 - dmin / 2000)
                    if sc > bestScore { bestScore = sc; bestDir = dd }
                }
                let p = Geo.destination(startLL, bearingDeg: bestDir, distMeters: target * 0.3)
                let anchor = Annotated(
                    place: Place(id: "_anchor", name: "_anchor", category: "landmark", lat: p.lat, lng: p.lng,
                                 zone: nil, score: 0, blurb: nil, see: nil, activity: nil, tip: nil,
                                 transit: nil, corridor: nil, crossing: nil, endpoint: nil),
                    corridor: nil, d: target * 0.3, b: bestDir, zone: startZone, boost: 1
                )
                sets = [[anchor]]
            }
            // Score each set that routes; one unroutable waypoint never kills the build.
            var scored: [(set: [Annotated], r: RouteGeometry, sc: Double)] = []
            for set in sets {
                guard let r = try? await routeFor(start: startLL, waypoints: set, shape: .loop, profile: profile) else { continue }
                let sc = sceneryScore(r.coordinates, annotated, city.beauty) - 1.5 * selfOverlap(r.coordinates)
                scored.append((set, r, sc))
            }
            if let best = scored.max(by: { $0.sc < $1.sc }) {
                waypoints = best.set
                route = best.r
            } else {
                // every set failed — seed from the best single feature that routes
                let ranked = annotated
                    .filter { ($0.corridor != nil || $0.d > 150) && $0.d <= target * 0.55 }
                    .sorted {
                        value($0, vibe: vibe, jitter: plan.jitter) * (1 + $0.scenicLength / 1000)
                            > value($1, vibe: vibe, jitter: plan.jitter) * (1 + $1.scenicLength / 1000)
                    }
                var found: (Annotated, RouteGeometry)?
                for cand in ranked {
                    if let r = try? await routeFor(start: startLL, waypoints: [cand], shape: .loop, profile: profile) {
                        found = (cand, r)
                        break
                    }
                }
                guard let f = found else {
                    throw BuildError(message: "Could not route to any scenic spot near there — try a different start.")
                }
                waypoints = [f.0]
                route = f.1
            }
        } else {
            waypoints = await selectOneWayDest(start: startLL, target: target, vibe: vibe, jitter: plan.jitter, annotated: annotated, startZone: startZone, profile: profile)
            guard !waypoints.isEmpty else {
                throw BuildError(message: "No scenic waypoints found near there at this distance.")
            }
            route = try await routeFor(start: startLL, waypoints: waypoints, shape: .oneway, profile: profile)
        }

        // Make the legs between stops scenic before fitting the distance.
        let scenic = await scenicize(start: startLL, waypoints: waypoints, shape: plan.shape,
                                     route: route, annotated: annotated, beauty: city.beauty,
                                     profile: profile, target: target)
        waypoints = scenic.waypoints
        route = scenic.route

        let lo = target * (1 - tolerance)
        let hi = target * (1 + tolerance)

        // Too long? Window the corridor first (keeps every stop)...
        if route.distanceMeters > hi {
            let fit = await fitLongCorridor(start: startLL, waypoints: waypoints, shape: plan.shape,
                                            target: target, profile: profile, route: route)
            waypoints = fit.waypoints
            route = fit.route
        }
        // ...then drop the least scenic stops.
        var guard1 = 0
        while route.distanceMeters > hi, waypoints.count > 1, guard1 < 6 {
            guard1 += 1
            let trimmed = trimOne(waypoints, shape: plan.shape)
            guard let r = try? await routeFor(start: startLL, waypoints: trimmed, shape: plan.shape, profile: profile),
                  r.distanceMeters < route.distanceMeters
            else { break }
            waypoints = trimmed
            route = r
            if route.distanceMeters < lo { break }
        }

        // Loop safety net: re-seed from the best feature that measures under the cap.
        if plan.shape == .loop, route.distanceMeters > hi {
            let ranked = annotated
                .filter { $0.zone == startZone && ($0.corridor != nil || $0.d > 150) && $0.d <= target * 0.55 }
                .sorted {
                    value($0, vibe: vibe, jitter: plan.jitter) * (1 + $0.scenicLength / 1000)
                        > value($1, vibe: vibe, jitter: plan.jitter) * (1 + $1.scenicLength / 1000)
                }
            for cand in ranked.prefix(8) {
                guard var r = try? await routeFor(start: startLL, waypoints: [cand], shape: .loop, profile: profile) else { continue }
                var wp = [cand]
                if cand.corridor != nil, r.distanceMeters > hi {
                    let fit = await fitLongCorridor(start: startLL, waypoints: wp, shape: .loop,
                                                    target: target, profile: profile, route: r)
                    wp = fit.waypoints
                    r = fit.route
                }
                if r.distanceMeters <= hi {
                    waypoints = wp
                    route = r
                    break
                }
            }
        }

        // Grow while short: prefer fillers that are also worth seeing, and never
        // grow by doubling back over ground already covered.
        var used = Set(waypoints.map(\.id))
        let destD = waypoints.map(\.d).max() ?? 0
        var pool = annotated.filter {
            !used.contains($0.id) && ($0.corridor != nil || $0.d > 150) && $0.zone == startZone
                && (plan.shape == .loop || $0.d < destD * 0.98)
        }
        var guard2 = 0
        while route.distanceMeters < lo, !pool.isEmpty, waypoints.count < maxWaypoints + 3, guard2 < 6 {
            guard2 += 1
            let gap = target - route.distanceMeters
            func fitErr(_ p: Annotated) -> Double {
                abs(2 * p.d * streetFactor - gap) - value(p, vibe: vibe, jitter: 0) * 150
            }
            pool.sort { fitErr($0) < fitErr($1) }
            let cand = pool.removeFirst()
            let trial = orderWaypoints(waypoints + [cand], shape: plan.shape)
            guard let r = try? await routeFor(start: startLL, waypoints: trial, shape: plan.shape, profile: profile) else { continue }
            if r.distanceMeters <= hi, r.distanceMeters > route.distanceMeters,
               selfOverlap(r.coordinates) <= selfOverlap(route.coordinates) + 0.08 {
                waypoints = trial
                route = r
                used.insert(cand.id)
            }
        }

        // Precise top-up when still short.
        if route.distanceMeters < lo {
            let r: RouteGeometry?
            if plan.shape == .loop {
                r = await addSpur(start: startLL, waypoints: waypoints, shape: .loop,
                                  target: target, profile: profile, beauty: city.beauty,
                                  baseOverlap: selfOverlap(route.coordinates))
            } else {
                r = await addOnewayDetour(start: startLL, waypoints: waypoints, target: target, profile: profile)
            }
            if let r, abs(r.distanceMeters - target) < abs(route.distanceMeters - target) {
                route = r
            }
        }

        // synthetic anchors (_anchor) shaped the route but aren't real sights
        let visible = waypoints.filter { !$0.id.hasPrefix("_") }
        let rationale = computeRationale(city: city, shape: plan.shape, vibe: vibe,
                                         distanceMeters: route.distanceMeters,
                                         highlights: visible, annotated: annotated, startZone: startZone)
        return Output(route: route, highlights: visible.map(\.place), shape: plan.shape,
                      targetMeters: target, distanceMeters: route.distanceMeters,
                      rationale: rationale, stops: visible)
    }

    // MARK: - Rationale

    static func experiencePhrase(_ p: Annotated) -> String {
        switch p.place.category {
        case "waterfront": return "trace \(p.place.name)"
        case "path": return "run the length of \(p.place.name)"
        case "park": return "loop through \(p.place.name)"
        case "viewpoint": return "take in \(p.place.name)"
        case "neighborhood": return "explore \(p.place.name)"
        default: return "pass \(p.place.name)"
        }
    }

    static func computeRationale(
        city: City, shape: RouteShape, vibe: [String: Double], distanceMeters: Double,
        highlights: [Annotated], annotated: [Annotated], startZone: String
    ) -> Rationale {
        let km = String(format: "%.1f", distanceMeters / 1000)
        let corridors = highlights.filter { $0.corridor != nil }
        let spine = corridors.max(by: { $0.score < $1.score })
            ?? highlights.max(by: { $0.score < $1.score })
        let crossings = highlights.filter(\.isCrossing)
        let others = highlights.filter { $0.id != spine?.id }

        let tail = others.isEmpty ? "" :
            ", then " + others.prefix(2).map(experiencePhrase).joined(separator: " and ")
        let shapeWord = shape == .loop ? "loop" : "point-to-point run"
        let thesis: String
        if let s = spine {
            thesis = "A \(km) km \(shapeWord) built to \(experiencePhrase(s))\(tail)."
        } else {
            thesis = "A \(km) km \(shapeWord) through the city's highlights."
        }

        var reasons: [String] = []
        if let s = spine, s.corridor != nil {
            reasons.append("Leads with \(s.place.name) — a stretch you run along, so the distance is scenic, not filler streets.")
        } else if let s = spine {
            reasons.append("Anchored on \(s.place.name), the standout nearby.")
        }
        if !crossings.isEmpty {
            reasons.append("Crosses \(crossings.map(\.place.name).joined(separator: " and ")) so you see the skyline from the water — and from the other side.")
        }
        let vibeKeys = vibe.filter { $0.value > 1 }.keys.sorted()
        if !vibeKeys.isEmpty {
            reasons.append("Weighted toward \(vibeKeys.joined(separator: " & ")) the way you asked.")
        }
        let cats = Set(highlights.map { $0.place.category })
        if cats.count >= 3 {
            reasons.append("Mixes \(cats.count) kinds of place for a first feel of the city, not one note.")
        }

        let usedIds = Set(highlights.map(\.id))
        let spineCat = spine?.place.category
        let spineBearing = spine?.b ?? 0
        let unused = annotated
            .filter { !usedIds.contains($0.id) && $0.zone == startZone && $0.score >= 4 }
            .sorted { $0.score > $1.score }

        var alternatives: [Rationale.Alternative] = []
        var takenCats = Set<String>()
        for p in unused {
            if alternatives.count >= 2 { break }
            if p.place.category == spineCat, alternatives.isEmpty, unused.count > 1 { continue }
            if takenCats.contains(p.place.category) { continue }
            takenCats.insert(p.place.category)
            let dir = Geo.angularDiff(p.b, spineBearing) > 70 ? "the other direction" : "nearby"
            alternatives.append(.init(
                name: p.place.name,
                why: "could've sent you \(dir) to \(experiencePhrase(p)) instead — \(p.place.blurb ?? "")"
            ))
        }
        return Rationale(thesis: thesis, reasons: reasons, alternatives: alternatives)
    }

    // MARK: - Vibes

    static func vibeFromChips(_ chips: [String]) -> [String: Double] {
        let groups: [String: [String: Double]] = [
            "waterfront": ["waterfront": 1.8, "path": 1.3],
            "parks": ["park": 1.8, "viewpoint": 1.4],
            "landmarks": ["landmark": 1.8, "viewpoint": 1.3],
            "neighborhoods": ["neighborhood": 1.8],
        ]
        var vibe: [String: Double] = [:]
        for chip in chips {
            guard let group = groups[chip] else { continue }
            for (cat, w) in group { vibe[cat] = max(vibe[cat] ?? 1, w) }
        }
        return vibe
    }
}
