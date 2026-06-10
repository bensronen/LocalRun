import SwiftUI
import MapKit

struct RunView: View {
    @EnvironmentObject var app: AppState
    let result: BuiltRoute

    @StateObject private var engine: RunEngine
    @State private var mapPosition: MapCameraPosition
    @State private var cameraOpen = false
    @State private var captionAskPhotoTs: Double?
    @State private var captionDraft = ""
    @State private var exitConfirm = false
    @State private var rating = 0
    @State private var note = ""
    @State private var saving = false

    init(result: BuiltRoute) {
        self.result = result
        // settings are read again in onAppear via env; seed engine with stored ones
        _engine = StateObject(wrappedValue: RunEngine(result: result, settings: Stores.loadSettings()))
        _mapPosition = State(initialValue: .userLocation(followsHeading: false, fallback: .region(
            MKCoordinateRegion(center: result.start.ll.cl,
                               span: MKCoordinateSpan(latitudeDelta: 0.004, longitudeDelta: 0.004))
        )))
    }

    var body: some View {
        ZStack(alignment: .top) {
            runMap
            VStack(spacing: 0) {
                topOverlays
                Spacer()
                callout
                cameraButton
                bottomPanel
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .task { await engine.start() }
        .onDisappear { engine.stop() }
        .sheet(isPresented: $cameraOpen) {
            CameraPicker { image in
                engine.addPhoto(image)
                if let last = engine.photos.last {
                    captionDraft = ""
                    captionAskPhotoTs = last.ts
                }
            }
            .ignoresSafeArea()
        }
        .alert("Caption this photo?", isPresented: .init(
            get: { captionAskPhotoTs != nil }, set: { if !$0 { captionAskPhotoTs = nil } }
        )) {
            TextField("Caption", text: $captionDraft)
            Button("Skip", role: .cancel) {}
            Button("Save") {
                if let ts = captionAskPhotoTs {
                    engine.setCaption(captionDraft.trimmingCharacters(in: .whitespaces), forPhotoTs: ts)
                }
            }
        } message: {
            Text("Shows with the photo in your run history.")
        }
        .alert("End this run?", isPresented: $exitConfirm) {
            Button("Keep running", role: .cancel) {}
            Button("End run", role: .destructive) { app.running = false }
        } message: {
            Text("Your time and distance will be discarded.")
        }
    }

    // MARK: - Map

    private var runMap: some View {
        Map(position: $mapPosition) {
            UserAnnotation()
            MapPolyline(coordinates: result.route.coordinates.map(\.cl))
                .stroke(app.theme.accent, lineWidth: 6)
            ForEach(Array(result.highlights.enumerated()), id: \.element.id) { i, h in
                Annotation("", coordinate: h.ll.cl) {
                    Text(engine.announced.contains(h.id) ? "✓" : "\(i + 1)")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(Theme.categoryColor(h.category), in: Circle())
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
            if let finish = result.route.coordinates.last {
                Annotation("", coordinate: finish.cl) {
                    Image(systemName: "flag.checkered")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(app.theme.good, in: Circle())
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
            ForEach(engine.photos.filter { $0.lat != nil }) { p in
                Annotation("", coordinate: CLLocationCoordinate2D(latitude: p.lat!, longitude: p.lng!)) {
                    Image(systemName: "camera")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(app.theme.accentDeep, in: Circle())
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
        }
        .ignoresSafeArea()
    }

    // MARK: - Overlays

    private var topOverlays: some View {
        HStack(alignment: .top, spacing: 10) {
            if let b = engine.banner, !engine.done {
                HStack(spacing: 12) {
                    Image(systemName: b.symbol)
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(app.theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(b.instruction)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(app.theme.text)
                            .lineLimit(2)
                        Text("\(b.meters) m")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(app.theme.accent)
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
                .glass(in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                Spacer()
            }
            Button {
                if engine.done || !engine.started { app.running = false }
                else { exitConfirm = true }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(app.theme.text)
                    .frame(width: 44, height: 44)
                    .glass(in: Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var callout: some View {
        if let c = engine.callout, !engine.done {
            VStack(alignment: .leading, spacing: 4) {
                Text(c.name).font(.system(size: 15, weight: .bold)).foregroundStyle(app.theme.accent)
                Text(c.text).font(.system(size: 14)).foregroundStyle(app.theme.text)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass(in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
    }

    @ViewBuilder
    private var cameraButton: some View {
        if !engine.done {
            HStack {
                Spacer()
                Button {
                    cameraOpen = true
                } label: {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(app.theme.accent)
                        .frame(width: 54, height: 54)
                        .glass(in: Circle())
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
    }

    // MARK: - Bottom panel

    @ViewBuilder
    private var bottomPanel: some View {
        if !engine.done { activePanel } else { reviewPanel }
    }

    private var activePanel: some View {
        VStack(spacing: 0) {
            HStack {
                bigStat(Format.clock(engine.elapsed), "time")
                bigStat(result.unit.format(engine.distM), "distance")
                bigStat(Format.pace(engine.splitPace), "this \(result.unit.rawValue)")
            }
            Text(avgLine)
                .font(.system(size: 13)).foregroundStyle(app.theme.textDim)
                .padding(.top, 10)
            HStack(spacing: 12) {
                Button {
                    engine.togglePause()
                } label: {
                    Text(engine.paused ? "Resume" : "Pause")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(app.theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                Button {
                    engine.finish()
                } label: {
                    Text("Finish")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(app.theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(.top, 16)
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 34)
        .glass(in: UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22))
    }

    private var avgLine: String {
        var s = "avg \(Format.pace(engine.avgPace)) /\(result.unit.rawValue) · \(engine.splits.count) \(engine.splits.count == 1 ? "split" : "splits") done"
        if !engine.photos.isEmpty {
            s += " · \(engine.photos.count) \(engine.photos.count == 1 ? "photo" : "photos")"
        }
        return s
    }

    private var reviewPanel: some View {
        VStack(spacing: 0) {
            Text("Run complete")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(app.theme.text)
                .padding(.bottom, 14)
            HStack {
                bigStat(Format.clock(engine.elapsed), "time", big: false)
                bigStat(result.unit.format(engine.distM), "distance", big: false)
                bigStat(Format.pace(engine.avgPace), "avg /\(result.unit.rawValue)", big: false)
                bigStat("\(engine.announced.count)", "seen", big: false)
            }
            HStack(spacing: 10) {
                ForEach(1...5, id: \.self) { n in
                    Button {
                        Haptics.tap()
                        rating = n
                    } label: {
                        Image(systemName: n <= rating ? "star.fill" : "star")
                            .font(.system(size: 26))
                            .foregroundStyle(n <= rating ? app.theme.accent : app.theme.textDim.opacity(0.4))
                    }
                }
            }
            .padding(.top, 14)
            TextField("Add a note about this run…", text: $note)
                .font(.system(size: 14))
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(app.theme.cardAlt, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.top, 12)
            if !engine.photos.isEmpty {
                Text("\(engine.photos.count) photo\(engine.photos.count == 1 ? "" : "s") attached — those spots will rank higher in future routes.")
                    .font(.system(size: 12)).foregroundStyle(app.theme.textDim)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
            }
            HStack(spacing: 12) {
                Button {
                    app.running = false
                } label: {
                    Text("Discard")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(app.theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                Button {
                    saving = true
                    app.saveRun(engine.makeRecord(rating: rating, note: note.trimmingCharacters(in: .whitespaces)))
                } label: {
                    Group {
                        if saving { ProgressView().tint(app.theme.onAccent) }
                        else { Text("Save run").font(.system(size: 15, weight: .semibold)) }
                    }
                    .foregroundStyle(app.theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .disabled(saving)
            }
            .padding(.top, 16)
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 34)
        .glass(in: UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22))
    }

    private func bigStat(_ value: String, _ label: String, big: Bool = true) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: big ? 28 : 17, weight: .bold))
                .foregroundStyle(app.theme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label).font(.system(size: 12)).foregroundStyle(app.theme.textDim)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Camera capture via UIImagePickerController.
struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            picker.sourceType = .camera
        }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                parent.onImage(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
