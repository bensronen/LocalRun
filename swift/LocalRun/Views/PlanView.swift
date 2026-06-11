import SwiftUI
import MapKit
import CoreLocation

struct PlanView: View {
    @EnvironmentObject var app: AppState

    @State private var city: City = Cities.all.first!
    @State private var cityPickerOpen = false
    @State private var start: StartPoint = Cities.all.first!.defaultStart
    @State private var address = ""
    @State private var suggestions: [StartPoint] = []
    @State private var suggestTask: Task<Void, Never>?
    @State private var destination: StartPoint?
    @State private var destAddress = ""
    @State private var destSuggestions: [StartPoint] = []
    @State private var destSuggestTask: Task<Void, Never>?
    @State private var mapPickerOpen = false
    @State private var profileOpen = false
    @State private var distanceKm: Double = 5
    @State private var unit: DistanceUnit = .km
    @State private var shape: RouteShape = .loop
    @State private var vibes: Set<String> = []
    @State private var busy = false
    @State private var locating = false
    @State private var community: CommunitySnapshot?
    @State private var errorMessage: String?
    @State private var exploreAsk: ExploreAsk?
    @State private var mapPosition: MapCameraPosition = .automatic
    @State private var hydrated = false

    private let locator = CLLocationManager()

    struct ExploreAsk: Identifiable {
        let id = UUID()
        let seen: [String]
        let plan: RoutePlan
    }

    let vibeOptions: [(key: String, label: String)] = [
        ("waterfront", "Waterfront"), ("parks", "Parks"),
        ("landmarks", "Landmarks"), ("neighborhoods", "Neighborhoods"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                cityButton
                communityPulse
                SectionLabel(text: "Start from")
                addressRow
                suggestionList
                presetRow
                miniMap
                SectionLabel(text: "Destination (optional)")
                destSection
                SectionLabel(text: "Distance")
                distanceSection
                SectionLabel(text: "Route shape")
                shapePicker
                SectionLabel(text: "Sights (optional)")
                vibeChips
                buildButton
                if !Config.hasMapboxToken {
                    Text("Add your Mapbox token in Config.swift to build routes.")
                        .font(.footnote).foregroundStyle(app.theme.textDim).padding(.top, 12)
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 110)
            .containerRelativeFrame(.horizontal)
            .animation(.easeInOut(duration: 0.18), value: suggestions.count)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear(perform: hydrate)
        .onChange(of: city.id) { _, _ in
            Task { community = await CommunityAPI.fetchCommunity(city.id) }
            saveDraft()
        }
        .onChange(of: distanceKm) { _, _ in saveDraft() }
        .onChange(of: unit) { _, _ in saveDraft() }
        .onChange(of: shape) { _, _ in saveDraft() }
        .onChange(of: vibes) { _, _ in saveDraft() }
        .onChange(of: start) { _, _ in saveDraft() }
        .onChange(of: destination) { _, _ in saveDraft() }
        .sheet(isPresented: $cityPickerOpen) { cityPicker }
        .sheet(isPresented: $profileOpen) {
            ProfileView()
                .environmentObject(app)
                .presentationDetents([.medium, .large])
        }
        .fullScreenCover(isPresented: $mapPickerOpen) {
            MapPickerSheet(city: city, start: $start) {
                clearAddress()
            }
            .environmentObject(app)
        }
        .alert("Could not build a route", isPresented: .init(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
        .confirmationDialog(
            "You've run here before",
            isPresented: .init(get: { exploreAsk != nil }, set: { if !$0 { exploreAsk = nil } }),
            titleVisibility: .visible
        ) {
            Button("Something new") { resolveExplore(.new) }
            Button("Revisit favorites") { resolveExplore(.revisit) }
            Button("Surprise me") { resolveExplore(nil) }
        } message: {
            Text("\(exploreAsk?.seen.count ?? 0) sights already in your history. What's the mood today?")
        }
    }

    // MARK: - Sections

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("LocalRun")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(app.theme.text)
                Text("Run a city like a local.")
                    .font(.subheadline).foregroundStyle(app.theme.textDim)
            }
            Spacer()
            HStack(spacing: 8) {
                Button {
                    profileOpen = true
                } label: {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(app.theme.accent)
                        .frame(width: 40, height: 40)
                }
                .card(radius: 20)
                Button {
                    app.settingsOpen = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(app.theme.accent)
                        .frame(width: 40, height: 40)
                }
                .card(radius: 20)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 16)
    }

    private var cityButton: some View {
        Button {
            cityPickerOpen = true
        } label: {
            HStack {
                Text("\(city.emoji) \(city.name)")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(app.theme.text)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(app.theme.textDim)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
        }
        .card()
    }

    @ViewBuilder
    private var communityPulse: some View {
        if let c = community, c.totalRuns > 0 {
            HStack(spacing: 8) {
                Image(systemName: "figure.run").font(.system(size: 13, weight: .semibold))
                Text(pulseText(c)).font(.system(size: 13, weight: .medium)).lineLimit(2)
            }
            .foregroundStyle(app.theme.accent)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.top, 10)
        }
    }

    private func pulseText(_ c: CommunitySnapshot) -> String {
        var s = "\(c.totalRuns) \(c.totalRuns == 1 ? "run" : "runs") by the community"
        if let top = c.top.first,
           let name = city.places.first(where: { $0.id == top.id })?.name {
            s += " · most shot: \(name)"
        }
        return s
    }

    private var addressRow: some View {
        HStack(spacing: 8) {
            TextField("Hotel or address in \(city.name)…", text: $address)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .card(radius: 12)
                .onChange(of: address) { _, text in scheduleSuggest(text) }
                .onSubmit { submitSearch() }
            Button("Find") { submitSearch() }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(app.theme.accent)
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    @ViewBuilder
    private var suggestionList: some View {
        if !suggestions.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(suggestions.enumerated()), id: \.offset) { i, s in
                    Button {
                        pickSuggestion(s)
                    } label: {
                        Text(s.name)
                            .font(.system(size: 14))
                            .foregroundStyle(app.theme.text)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                    }
                    if i < suggestions.count - 1 { Divider() }
                }
            }
            .card(radius: 12)
            .padding(.top, 6)
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    private var presetRow: some View {
        FlowRow {
            presetChip(locating ? "Locating…" : "My location") { useMyLocation() }
            ForEach(city.presets, id: \.label) { p in
                presetChip(p.label) {
                    Haptics.tap()
                    start = p.start
                    clearAddress()
                    recenterMap()
                }
            }
        }
        .padding(.top, 10)
    }

    private func presetChip(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(app.theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
        }
        .card(radius: 18)
    }

    private var miniMap: some View {
        Map(position: $mapPosition) {
            Annotation("", coordinate: start.ll.cl) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.white, app.theme.accent)
            }
            if let d = destination {
                Annotation("", coordinate: d.ll.cl) {
                    Image(systemName: "flag.circle.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(.white, app.theme.accentDeep)
                }
            }
        }
        .allowsHitTesting(false) // preview only — tap opens the full-screen picker
        .frame(height: 200)
        .overlay(alignment: .bottomLeading) {
            HStack(spacing: 5) {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: 10, weight: .bold))
                Text("\(start.name) · tap to expand")
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(app.theme.text)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .glassCapsule()
            .padding(10)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .onTapGesture {
            Haptics.tap()
            mapPickerOpen = true
        }
        .padding(.top, 14)
    }

    @ViewBuilder
    private var destSection: some View {
        if let d = destination {
            HStack(spacing: 10) {
                Image(systemName: "flag.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(.white, app.theme.accentDeep)
                Text(d.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(app.theme.text)
                    .lineLimit(1)
                Spacer()
                Button {
                    Haptics.tap()
                    destination = nil
                    destAddress = ""
                    destSuggestions = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(app.theme.textDim)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .card(radius: 12)
        } else {
            TextField("A place the route must hit…", text: $destAddress)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .card(radius: 12)
                .onChange(of: destAddress) { _, text in scheduleDestSuggest(text) }
            if !destSuggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(destSuggestions.enumerated()), id: \.offset) { i, s in
                        Button {
                            Haptics.tap()
                            destination = s
                            destAddress = ""
                            destSuggestions = []
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        } label: {
                            Text(s.name)
                                .font(.system(size: 14))
                                .foregroundStyle(app.theme.text)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                        }
                        if i < destSuggestions.count - 1 { Divider() }
                    }
                }
                .card(radius: 12)
                .padding(.top, 6)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var distanceSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(unit.format(distanceKm * 1000))
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(app.theme.text)
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.2), value: distanceKm)
                Spacer()
                Picker("", selection: $unit) {
                    ForEach(DistanceUnit.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 110)
            }
            // The slider works in the SELECTED unit so steps are an honest 0.1 km or 0.1 mi.
            Slider(value: distanceInUnit, in: unitRange, step: 0.1)
            if let est = PaceModel.estimate(meters: distanceKm * 1000) {
                Text("~\(est) at your pace")
                    .font(.system(size: 13)).foregroundStyle(app.theme.textDim)
            } else {
                Text("Time estimates appear after your first saved run.")
                    .font(.system(size: 12)).foregroundStyle(app.theme.textDim.opacity(0.8))
            }
        }
    }

    private var unitRange: ClosedRange<Double> { unit == .mi ? 0.6...13 : 1...21 }

    private var distanceInUnit: Binding<Double> {
        Binding(
            get: { min(unitRange.upperBound, max(unitRange.lowerBound, distanceKm * 1000 / unit.meters)) },
            set: { distanceKm = ($0 * unit.meters / 1000 * 100).rounded() / 100 }
        )
    }

    private var shapePicker: some View {
        HStack(spacing: 3) {
            shapeSegment(.loop, label: "Loop back", hint: "Return to start")
            shapeSegment(.oneway, label: "One-way", hint: "Bike/transit back")
        }
        .padding(3)
        .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func shapeSegment(_ s: RouteShape, label: String, hint: String) -> some View {
        let active = shape == s
        return Button {
            Haptics.tap()
            shape = s
        } label: {
            VStack(spacing: 2) {
                Text(label).font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(active ? app.theme.text : app.theme.textDim)
                Text(hint).font(.system(size: 12)).foregroundStyle(app.theme.textDim)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(active ? app.theme.card : .clear,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var vibeChips: some View {
        FlowRow {
            ForEach(vibeOptions, id: \.key) { v in
                let active = vibes.contains(v.key)
                Button {
                    Haptics.tap()
                    if active { vibes.remove(v.key) } else { vibes.insert(v.key) }
                } label: {
                    Text(v.label)
                        .font(.system(size: 14, weight: active ? .semibold : .medium))
                        .foregroundStyle(active ? app.theme.onAccent : app.theme.text)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(active ? app.theme.accent : app.theme.card,
                                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var buildButton: some View {
        Button {
            Task { await prepareBuild() }
        } label: {
            Group {
                if busy { ProgressView().tint(app.theme.onAccent) }
                else { Text("Build my run").font(.system(size: 17, weight: .semibold)) }
            }
            .foregroundStyle(app.theme.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .disabled(busy)
        .padding(.top, 28)
    }

    private var cityPicker: some View {
        NavigationStack {
            List(Cities.all) { c in
                Button {
                    Haptics.tap()
                    city = c
                    start = c.defaultStart
                    clearAddress()
                    recenterMap()
                    cityPickerOpen = false
                } label: {
                    HStack {
                        Text("\(c.emoji) \(c.name)").foregroundStyle(app.theme.text)
                        Spacer()
                        if c.id == city.id {
                            Image(systemName: "checkmark").foregroundStyle(app.theme.accent)
                        }
                    }
                }
            }
            .navigationTitle("City")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: - Behavior

    private func hydrate() {
        guard !hydrated else { return }
        hydrated = true
        let d = app.draft
        if let id = d.cityId, let c = Cities.all.first(where: { $0.id == id }) { city = c }
        start = d.start ?? city.defaultStart
        address = d.address
        distanceKm = d.distanceKm
        unit = d.unit
        shape = d.shape
        vibes = Set(d.vibes)
        destination = d.dest
        recenterMap()
        Task { community = await CommunityAPI.fetchCommunity(city.id) }
    }

    private func saveDraft() {
        guard hydrated else { return }
        app.updateDraft(PlanDraft(
            cityId: city.id, start: start, address: address, distanceKm: distanceKm,
            unit: unit, shape: shape, vibes: Array(vibes), dest: destination
        ))
    }

    private func recenterMap() {
        mapPosition = .region(MKCoordinateRegion(
            center: start.ll.cl,
            span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
        ))
    }

    private func clearAddress() {
        address = ""
        suggestions = []
        suggestTask?.cancel()
    }

    private func scheduleSuggest(_ text: String) {
        suggestTask?.cancel()
        let q = text.trimmingCharacters(in: .whitespaces)
        guard q.count >= 3 else {
            suggestions = []
            return
        }
        suggestTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            let hits = await PlaceSearch.search(q, city: city)
            if !Task.isCancelled { suggestions = hits }
        }
    }

    private func scheduleDestSuggest(_ text: String) {
        destSuggestTask?.cancel()
        let q = text.trimmingCharacters(in: .whitespaces)
        guard q.count >= 3 else {
            destSuggestions = []
            return
        }
        destSuggestTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            let hits = await PlaceSearch.search(q, city: city)
            if !Task.isCancelled { destSuggestions = hits }
        }
    }

    private func pickSuggestion(_ s: StartPoint) {
        Haptics.tap()
        suggestTask?.cancel()
        start = s
        address = s.name
        suggestions = []
        recenterMap()
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func submitSearch() {
        if let first = suggestions.first { pickSuggestion(first); return }
        let q = address.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        Task {
            let hits = await PlaceSearch.search(q, city: city)
            if let hit = hits.first { pickSuggestion(hit) }
            else { errorMessage = "Not found — try a more specific \(city.name) place or drop a pin." }
        }
    }

    private func useMyLocation() {
        locating = true
        locator.requestWhenInUseAuthorization()
        locator.startUpdatingLocation()
        Task {
            // simple poll for a fix (delegate-free; .location fills once updating)
            for _ in 0..<20 {
                if let loc = locator.location {
                    let pt = LL(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude)
                    city = Cities.forPoint(pt)
                    start = StartPoint(lat: pt.lat, lng: pt.lng, name: "My location")
                    clearAddress()
                    recenterMap()
                    break
                }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            locator.stopUpdatingLocation()
            locating = false
        }
    }

    /// Build flow: merge boosts, check run history for the revisit/new prompt.
    private func prepareBuild() async {
        guard Config.hasMapboxToken else {
            errorMessage = "Add your Mapbox token in Config.swift, then rebuild."
            return
        }
        let boosts = CommunityAPI.mergeBoosts(personal: Stores.loadBoosts(), community: community)
        let cityRuns = Stores.loadRuns().filter { $0.cityId == city.id }
        let seen = Array(Set(cityRuns.flatMap(\.seen)))
        var plan = RoutePlan(distanceKm: distanceKm, shape: shape,
                             vibe: RouteBuilder.vibeFromChips(Array(vibes)))
        plan.boosts = boosts
        plan.seen = seen
        plan.dest = destination
        if seen.count >= 3 {
            exploreAsk = ExploreAsk(seen: seen, plan: plan)
        } else {
            await build(plan: plan)
        }
    }

    private func resolveExplore(_ mode: ExploreMode?) {
        guard var plan = exploreAsk?.plan else { return }
        plan.explore = mode
        exploreAsk = nil
        Task { await build(plan: plan) }
    }

    private func build(plan: RoutePlan) async {
        busy = true
        defer { busy = false }
        do {
            let out = try await RouteBuilder.build(start: start, plan: plan, city: city)
            Haptics.success()
            withAnimation(.easeInOut(duration: 0.25)) {
                app.result = BuiltRoute(
                    route: out.route, highlights: out.highlights, shape: out.shape,
                    targetMeters: out.targetMeters, distanceMeters: out.distanceMeters,
                    rationale: out.rationale, start: start, unit: unit, plan: plan,
                    city: city, community: community
                )
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Full-screen start picker, X-style: the map fills the screen and the
/// "Start from" controls move into a bottom card. Tap the map to set the pin.
struct MapPickerSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    let city: City
    @Binding var start: StartPoint
    var onChanged: () -> Void

    @State private var camera: MapCameraPosition
    @State private var address = ""
    @State private var suggestions: [StartPoint] = []
    @State private var suggestTask: Task<Void, Never>?
    @State private var locating = false
    private let locator = CLLocationManager()

    init(city: City, start: Binding<StartPoint>, onChanged: @escaping () -> Void) {
        self.city = city
        self._start = start
        self.onChanged = onChanged
        _camera = State(initialValue: .region(MKCoordinateRegion(
            center: start.wrappedValue.ll.cl,
            span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        )))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            MapReader { proxy in
                Map(position: $camera) {
                    UserAnnotation()
                    Annotation("", coordinate: start.ll.cl) {
                        Image(systemName: "mappin.circle.fill")
                            .font(.system(size: 32))
                            .foregroundStyle(.white, app.theme.accent)
                    }
                }
                .onTapGesture { sp in
                    if let c = proxy.convert(sp, from: .local) {
                        Haptics.tap()
                        start = StartPoint(lat: c.latitude, lng: c.longitude, name: "Dropped pin")
                        onChanged()
                    }
                }
                .ignoresSafeArea()
            }

            // easy way back, always visible
            VStack {
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(app.theme.text)
                            .frame(width: 42, height: 42)
                            .glass(in: Circle())
                    }
                    Spacer()
                }
                .padding(.leading, 16)
                .padding(.top, 8)
                Spacer()
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("START FROM")
                    .font(.system(size: 12, weight: .semibold)).kerning(0.6)
                    .foregroundStyle(app.theme.textDim)
                TextField("Hotel or address in \(city.name)…", text: $address)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .background(app.theme.cardAlt.opacity(0.7),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onChange(of: address) { _, text in schedule(text) }
                if !suggestions.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(Array(suggestions.prefix(3).enumerated()), id: \.offset) { i, s in
                            Button {
                                pick(s)
                            } label: {
                                Text(s.name)
                                    .font(.system(size: 14))
                                    .foregroundStyle(app.theme.text)
                                    .lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 11)
                            }
                            if i < min(suggestions.count, 3) - 1 { Divider() }
                        }
                    }
                    .background(app.theme.cardAlt.opacity(0.7),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                FlowRow {
                    Button {
                        useMyLocation()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "location.fill").font(.system(size: 11, weight: .semibold))
                            Text(locating ? "Locating…" : "My location")
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundStyle(app.theme.accent)
                        .padding(.horizontal, 13)
                        .padding(.vertical, 7)
                        .background(app.theme.tint, in: Capsule())
                    }
                    ForEach(city.presets, id: \.label) { p in
                        Button {
                            pick(p.start)
                        } label: {
                            Text(p.label)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(app.theme.text)
                                .padding(.horizontal, 13)
                                .padding(.vertical, 7)
                                .background(app.theme.cardAlt.opacity(0.7), in: Capsule())
                        }
                    }
                }
                Text(start.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(app.theme.accent)
                    .lineLimit(1)
                Button {
                    dismiss()
                } label: {
                    Text("Done")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(app.theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(16)
            .padding(.bottom, 18)
            .glass(in: UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22))
        }
        .ignoresSafeArea(edges: .bottom)
    }

    private func pick(_ s: StartPoint) {
        Haptics.tap()
        start = s
        address = ""
        suggestions = []
        onChanged()
        camera = .region(MKCoordinateRegion(
            center: s.ll.cl, span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        ))
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func useMyLocation() {
        locating = true
        locator.requestWhenInUseAuthorization()
        locator.startUpdatingLocation()
        Task {
            for _ in 0..<20 {
                if let loc = locator.location {
                    pick(StartPoint(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, name: "My location"))
                    break
                }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            locator.stopUpdatingLocation()
            locating = false
        }
    }

    private func schedule(_ text: String) {
        suggestTask?.cancel()
        let q = text.trimmingCharacters(in: .whitespaces)
        guard q.count >= 3 else {
            suggestions = []
            return
        }
        suggestTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            let hits = await PlaceSearch.search(q, city: city)
            if !Task.isCancelled { suggestions = hits }
        }
    }
}

/// Minimal wrapping HStack for chips.
struct FlowRow<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        // Simple wrapping layout (iOS 16+).
        FlowLayout(spacing: 8) { content }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > width, x > 0 {
                x = 0
                y += rowH + spacing
                rowH = 0
            }
            x += sz.width + spacing
            rowH = max(rowH, sz.height)
        }
        return CGSize(width: width, height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowH + spacing
                rowH = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing
            rowH = max(rowH, sz.height)
        }
    }
}
