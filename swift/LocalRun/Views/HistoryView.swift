import SwiftUI
import MapKit

struct HistoryView: View {
    @EnvironmentObject var app: AppState
    @State private var runs: [RunRecord] = []
    @State private var selected: RunRecord?

    var body: some View {
        Group {
            if let run = selected {
                RunDetailView(run: run, onBack: { selected = nil }, onDelete: {
                    runs = Stores.deleteRun(id: run.id)
                    selected = nil
                })
            } else {
                list
            }
        }
        .onAppear { runs = Stores.loadRuns() }
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Your runs")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(app.theme.text)
                    .padding(.top, 16)
                if runs.isEmpty {
                    Text("No runs yet. Finish a run and save it — your photos and ratings teach LocalRun what you love seeing.")
                        .font(.system(size: 14)).foregroundStyle(app.theme.textDim)
                        .padding(.top, 4)
                }
                ForEach(runs) { r in
                    Button { selected = r } label: { runCard(r) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 110)
            .containerRelativeFrame(.horizontal)
        }
    }

    private func runCard(_ r: RunRecord) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(r.cityName).font(.system(size: 16, weight: .semibold)).foregroundStyle(app.theme.text)
                Spacer()
                Text(Self.dateLabel(r.ts)).font(.system(size: 13)).foregroundStyle(app.theme.textDim)
            }
            HStack(spacing: 18) {
                Text(r.unit.format(r.distM))
                Text(Format.clock(r.elapsed))
                Text("\(Format.pace(r.distM > 30 ? r.elapsed / (r.distM / r.unit.meters) : .nan)) /\(r.unit.rawValue)")
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(app.theme.textDim)
            HStack {
                if r.rating > 0 {
                    HStack(spacing: 1) {
                        ForEach(1...5, id: \.self) { n in
                            Image(systemName: n <= r.rating ? "star.fill" : "star")
                                .font(.system(size: 11))
                                .foregroundStyle(n <= r.rating ? app.theme.accent : app.theme.textDim.opacity(0.35))
                        }
                    }
                }
                Spacer()
                if !r.photos.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "camera").font(.system(size: 12))
                        Text("\(r.photos.count)").font(.system(size: 13))
                    }
                    .foregroundStyle(app.theme.textDim)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    static func dateLabel(_ ts: Double) -> String {
        let f = DateFormatter()
        f.dateFormat = "EEE, MMM d"
        return f.string(from: Date(timeIntervalSince1970: ts / 1000))
    }
}

struct RunDetailView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var strava = StravaService.shared

    @State var run: RunRecord
    let onBack: () -> Void
    let onDelete: () -> Void

    @State private var viewer: PhotoRecord?
    @State private var captionDraft = ""
    @State private var deleteConfirm = false
    @State private var uploading = false
    @State private var stravaMessage: String?

    var avgPace: Double {
        run.distM > 30 ? run.elapsed / (run.distM / run.unit.meters) : .nan
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    onBack()
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                        Text("Runs").font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(app.theme.accent)
                }
                .padding(.top, 8)
                Text(run.cityName)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(app.theme.text)
                    .padding(.top, 8)
                Text(HistoryView.dateLabel(run.ts))
                    .font(.subheadline).foregroundStyle(app.theme.textDim)

                detailMap
                statsCard
                splitsCard
                photosSection
                shareButtons
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 110)
            .containerRelativeFrame(.horizontal)
        }
        .fullScreenCover(item: $viewer) { photo in
            photoViewer(photo)
        }
        .alert("Delete this run?", isPresented: $deleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { onDelete() }
        } message: {
            Text("Its stats and photos will be removed from history.")
        }
        .alert("Strava", isPresented: .init(
            get: { stravaMessage != nil }, set: { if !$0 { stravaMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(stravaMessage ?? "")
        }
    }

    @ViewBuilder
    private var detailMap: some View {
        if run.coords.count > 1 {
            Map(initialPosition: .region(fitRegion())) {
                MapPolyline(coordinates: run.coords.map(\.cl))
                    .stroke(app.theme.accent, lineWidth: 4)
                ForEach(run.photos.filter { $0.lat != nil }) { p in
                    Annotation("", coordinate: CLLocationCoordinate2D(latitude: p.lat!, longitude: p.lng!)) {
                        Image(systemName: "camera")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 24, height: 24)
                            .background(app.theme.accentDeep, in: Circle())
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                    }
                }
            }
            .allowsHitTesting(false)
            .frame(height: 180)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.top, 14)
        }
    }

    private func fitRegion() -> MKCoordinateRegion {
        let lats = run.coords.map(\.lat), lngs = run.coords.map(\.lng)
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (lats.min()! + lats.max()!) / 2,
                longitude: (lngs.min()! + lngs.max()!) / 2
            ),
            span: MKCoordinateSpan(
                latitudeDelta: max(0.004, (lats.max()! - lats.min()!) * 1.4),
                longitudeDelta: max(0.004, (lngs.max()! - lngs.min()!) * 1.4)
            )
        )
    }

    private var statsCard: some View {
        VStack(spacing: 10) {
            HStack {
                stat(run.unit.format(run.distM), "distance")
                stat(Format.clock(run.elapsed), "time")
                stat(Format.pace(avgPace), "avg /\(run.unit.rawValue)")
                stat("\(run.seen.count)", "seen")
            }
            if run.rating > 0 {
                HStack(spacing: 2) {
                    ForEach(1...5, id: \.self) { n in
                        Image(systemName: n <= run.rating ? "star.fill" : "star")
                            .font(.system(size: 15))
                            .foregroundStyle(n <= run.rating ? app.theme.accent : app.theme.textDim.opacity(0.35))
                    }
                }
            }
            if !run.note.isEmpty {
                Text("“\(run.note)”")
                    .font(.system(size: 14)).italic()
                    .foregroundStyle(app.theme.text)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .card()
        .padding(.top, 12)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 16, weight: .bold)).foregroundStyle(app.theme.text)
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.system(size: 12)).foregroundStyle(app.theme.textDim)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var splitsCard: some View {
        if !run.splits.isEmpty {
            SectionLabel(text: "Splits")
            VStack(spacing: 0) {
                ForEach(Array(run.splits.enumerated()), id: \.offset) { i, s in
                    HStack {
                        Text("\(run.unit.rawValue) \(i + 1)").font(.system(size: 14)).foregroundStyle(app.theme.textDim)
                        Spacer()
                        Text(Format.pace(s)).font(.system(size: 14, weight: .semibold)).foregroundStyle(app.theme.text)
                    }
                    .padding(.vertical, 8)
                    if i < run.splits.count - 1 { Divider() }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .card()
        }
    }

    @ViewBuilder
    private var photosSection: some View {
        if !run.photos.isEmpty {
            SectionLabel(text: "Sights you captured")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(run.photos) { p in
                        Button {
                            captionDraft = p.caption
                            viewer = p
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                AsyncImage(url: p.url) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    app.theme.cardAlt
                                }
                                .frame(width: 140, height: 140)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                if !(p.caption.isEmpty && (p.placeName ?? "").isEmpty) {
                                    Text(p.caption.isEmpty ? (p.placeName ?? "") : p.caption)
                                        .font(.system(size: 12)).foregroundStyle(app.theme.textDim)
                                        .lineLimit(1).frame(width: 140, alignment: .leading)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    private var shareButtons: some View {
        VStack(spacing: 10) {
            ShareLink(item: shareText) {
                Text("Share run")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(app.theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            HStack(spacing: 10) {
                if let gpx = GPX.tempFile(for: run), !run.track.isEmpty {
                    ShareLink(item: gpx) {
                        secondaryLabel("Export GPX", symbol: "square.and.arrow.up")
                    }
                }
                stravaButton
            }
            Button {
                deleteConfirm = true
            } label: {
                Text("Delete run").font(.system(size: 15, weight: .medium)).foregroundStyle(app.theme.danger)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
            }
        }
        .padding(.top, 24)
    }

    @ViewBuilder
    private var stravaButton: some View {
        if Config.hasStrava {
            Button {
                Task { await sendToStrava() }
            } label: {
                Group {
                    if uploading { ProgressView().tint(app.theme.accent) }
                    else {
                        secondaryLabel(
                            strava.connected ? "Send to Strava" : "Connect Strava",
                            symbol: "arrow.up.circle"
                        )
                    }
                }
            }
            .disabled(uploading || run.track.isEmpty)
        }
    }

    private func secondaryLabel(_ text: String, symbol: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 13, weight: .semibold))
            Text(text).font(.system(size: 15, weight: .semibold))
        }
        .foregroundStyle(app.theme.accent)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var shareText: String {
        var s = "I ran \(run.unit.format(run.distM)) through \(run.cityName) with LocalRun — "
        s += "\(Format.clock(run.elapsed)) at \(Format.pace(avgPace))/\(run.unit.rawValue)."
        let names = run.highlights.prefix(4).map(\.name)
        if !names.isEmpty { s += "\nPassed: \(names.joined(separator: ", "))." }
        if !run.photos.isEmpty {
            s += "\n\(run.photos.count) sight\(run.photos.count == 1 ? "" : "s") captured"
        }
        return s
    }

    private func sendToStrava() async {
        uploading = true
        defer { uploading = false }
        do {
            if !strava.connected { try await strava.connect() }
            try await strava.upload(run)
            Haptics.success()
            stravaMessage = "Uploaded! It may take a moment to appear in your Strava feed."
        } catch {
            stravaMessage = error.localizedDescription
        }
    }

    // MARK: - Photo viewer

    private func photoViewer(_ photo: PhotoRecord) -> some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(0.95).ignoresSafeArea()
            VStack(spacing: 12) {
                Spacer(minLength: 60)
                AsyncImage(url: photo.url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView().tint(.white)
                }
                Spacer(minLength: 0)
                if let place = photo.placeName {
                    HStack(spacing: 6) {
                        Image(systemName: "mappin.and.ellipse").font(.system(size: 13, weight: .semibold))
                        Text(place).font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(.white.opacity(0.8))
                }
                HStack(spacing: 8) {
                    TextField("Add a caption…", text: $captionDraft)
                        .font(.system(size: 15))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    Button("Save") {
                        let caption = captionDraft.trimmingCharacters(in: .whitespaces)
                        Stores.updatePhotoCaption(runId: run.id, photoTs: photo.ts, caption: caption)
                        if let i = run.photos.firstIndex(where: { $0.ts == photo.ts }) {
                            run.photos[i].caption = caption
                        }
                        viewer = nil
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(app.theme.onAccent)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 11)
                    .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            Button {
                viewer = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(.white.opacity(0.15), in: Circle())
            }
            .padding(.top, 56)
            .padding(.trailing, 20)
        }
    }
}
