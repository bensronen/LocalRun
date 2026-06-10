import SwiftUI
import MapKit

struct RouteView: View {
    @EnvironmentObject var app: AppState
    let result: BuiltRoute

    @State private var mapPosition: MapCameraPosition = .automatic

    private var distanceNote: String {
        let off = result.distanceMeters / result.targetMeters
        if off > 1.15 { return "a bit longer than asked" }
        if off < 0.85 { return "a touch shorter — scenic density ran out" }
        return "right on target"
    }

    var body: some View {
        VStack(spacing: 0) {
            routeMap
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    statsRow
                    Text(distanceNote)
                        .font(.system(size: 12)).italic()
                        .foregroundStyle(app.theme.textDim)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                    rationaleCard
                    onewayCard
                    Text("What you'll see")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(app.theme.text)
                        .padding(.top, 22)
                    Text(result.shape == .loop
                         ? "A loop from your door and back, threaded through:"
                         : "A one-way line across the city, passing:")
                        .font(.system(size: 13)).foregroundStyle(app.theme.textDim)
                        .padding(.bottom, 12)
                    ForEach(Array(result.highlights.enumerated()), id: \.element.id) { i, h in
                        highlightRow(i: i, h: h)
                    }
                    actions
                }
                .padding(.horizontal, 18)
                .padding(.top, 16)
                .padding(.bottom, 30)
            }
        }
        .ignoresSafeArea(edges: .top)
    }

    private var routeMap: some View {
        Map(position: $mapPosition) {
            MapPolyline(coordinates: result.route.coordinates.map(\.cl))
                .stroke(app.theme.accent, lineWidth: 5)
            Annotation("", coordinate: result.start.ll.cl) {
                pin(text: "S", color: app.theme.good)
            }
            ForEach(Array(result.highlights.enumerated()), id: \.element.id) { i, h in
                Annotation("", coordinate: h.ll.cl) {
                    pin(text: "\(i + 1)", color: Theme.categoryColor(h.category))
                }
            }
        }
        .frame(height: UIScreen.main.bounds.height * 0.42)
        .overlay(alignment: .topLeading) {
            Button {
                app.result = nil
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "chevron.left").font(.system(size: 13, weight: .semibold))
                    Text("Plan").font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(app.theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .glassCapsule()
            }
            .padding(.leading, 14)
            .padding(.top, 50)
        }
        .onAppear { fitMap() }
    }

    private func fitMap() {
        let coords = result.route.coordinates
        guard !coords.isEmpty else { return }
        let lats = coords.map(\.lat), lngs = coords.map(\.lng)
        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (lats.min()! + lats.max()!) / 2,
                longitude: (lngs.min()! + lngs.max()!) / 2
            ),
            span: MKCoordinateSpan(
                latitudeDelta: max(0.005, (lats.max()! - lats.min()!) * 1.4),
                longitudeDelta: max(0.005, (lngs.max()! - lngs.min()!) * 1.4)
            )
        )
        mapPosition = .region(region)
    }

    private func pin(text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 13, weight: .heavy))
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(color, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 2))
    }

    private var statsRow: some View {
        HStack {
            stat(result.unit.format(result.distanceMeters), "distance")
            stat(Format.runTime(result.distanceMeters), "easy run")
            stat(result.shape == .loop ? "Loop" : "One-way", "shape")
            stat("\(result.highlights.count)", "stops")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 18, weight: .bold)).foregroundStyle(app.theme.text)
            Text(label).font(.system(size: 12)).foregroundStyle(app.theme.textDim)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var rationaleCard: some View {
        if let r = result.rationale {
            VStack(alignment: .leading, spacing: 0) {
                Text("WHY THIS ROUTE")
                    .font(.system(size: 12, weight: .heavy)).kerning(1)
                    .foregroundStyle(app.theme.accent)
                Text(r.thesis)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(app.theme.text)
                    .padding(.top, 8)
                ForEach(r.reasons, id: \.self) { reason in
                    HStack(alignment: .top, spacing: 8) {
                        Text("›").font(.system(size: 15, weight: .heavy)).foregroundStyle(app.theme.accent)
                        Text(reason).font(.system(size: 13)).foregroundStyle(app.theme.textDim)
                    }
                    .padding(.top, 10)
                }
                if !r.alternatives.isEmpty {
                    Divider().padding(.vertical, 12)
                    Text("ROADS NOT TAKEN")
                        .font(.system(size: 11, weight: .heavy)).kerning(0.8)
                        .foregroundStyle(app.theme.textDim)
                    ForEach(r.alternatives, id: \.name) { a in
                        (Text(a.name).bold().foregroundColor(app.theme.text)
                            + Text(" — \(a.why)").foregroundColor(app.theme.textDim))
                            .font(.system(size: 13))
                            .padding(.top, 4)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card(radius: 16)
            .padding(.top, 16)
        }
    }

    @ViewBuilder
    private var onewayCard: some View {
        if result.shape == .oneway, let last = result.highlights.last {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 7) {
                    Image(systemName: "flag.checkered").font(.system(size: 14, weight: .semibold))
                    Text("Finish at \(last.name)").font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(app.theme.text)
                if let transit = last.transit {
                    HStack(spacing: 7) {
                        Image(systemName: "tram.fill").font(.system(size: 12, weight: .semibold))
                        Text("Ride back from: \(transit)").font(.system(size: 13))
                    }
                    .foregroundStyle(app.theme.accent)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .padding(.top, 16)
        }
    }

    private func highlightRow(i: Int, h: Place) -> some View {
        let meta = CategoryMeta.all[h.category]
        let photos = result.community?.places[h.id]?.photos ?? 0
        return HStack(alignment: .top, spacing: 12) {
            Text("\(i + 1)")
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Theme.categoryColor(h.category), in: Circle())
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(h.name).font(.system(size: 15, weight: .bold)).foregroundStyle(app.theme.text)
                    Spacer()
                    if let meta {
                        HStack(spacing: 4) {
                            Image(systemName: meta.symbol).font(.system(size: 10, weight: .semibold))
                            Text(meta.label).font(.system(size: 11, weight: .bold))
                        }
                        .foregroundStyle(Theme.categoryColor(h.category))
                    }
                }
                if let blurb = h.blurb {
                    Text(blurb).font(.system(size: 13)).foregroundStyle(app.theme.textDim)
                }
                if photos > 0 {
                    HStack(spacing: 5) {
                        Image(systemName: "camera").font(.system(size: 11, weight: .semibold))
                        Text("Photographed by \(photos) \(photos == 1 ? "runner" : "runners")")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(app.theme.accent)
                    .padding(.top, 2)
                }
                if let see = h.see { detail("eye", see, dim: false) }
                if let act = h.activity { detail("sparkles", act, dim: false) }
                if let tip = h.tip { detail("lightbulb", tip, dim: true) }
                if let transit = h.transit { detail("tram.fill", transit, dim: true) }
            }
        }
        .padding(.bottom, 18)
    }

    private func detail(_ symbol: String, _ text: String, dim: Bool) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(dim ? app.theme.textDim : app.theme.accent)
                .padding(.top, 3)
            Text(text).font(.system(size: 13)).foregroundStyle(dim ? app.theme.textDim : app.theme.text)
        }
        .padding(.top, 4)
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button {
                Haptics.thump()
                app.running = true
            } label: {
                Text("Start run")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(app.theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(app.regenerating)
            .opacity(app.regenerating ? 0.5 : 1)
            HStack(spacing: 12) {
                Button {
                    app.result = nil
                } label: {
                    Text("Adjust").font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(app.theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                Button {
                    Task { await app.regenerate(); fitMap() }
                } label: {
                    Group {
                        if app.regenerating {
                            ProgressView().tint(app.theme.accent)
                        } else {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .semibold))
                                Text("Another").font(.system(size: 15, weight: .semibold))
                            }
                        }
                    }
                    .foregroundStyle(app.theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .disabled(app.regenerating)
            }
        }
        .padding(.top, 12)
    }
}
