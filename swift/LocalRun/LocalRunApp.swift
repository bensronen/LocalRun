import SwiftUI

@main
struct LocalRunApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(app)
                .preferredColorScheme(app.settings.dark ? .dark : .light)
                .tint(Theme.accent(dark: app.settings.dark))
        }
    }
}

/// Top-level navigation + shared state, mirroring the JS App component:
/// plan/history are tabs; a built route and an active run take over the screen.
@MainActor
final class AppState: ObservableObject {
    @Published var settings = Stores.loadSettings()
    @Published var draft = Stores.loadDraft()
    @Published var tab: Tab = .plan
    @Published var result: BuiltRoute?
    @Published var running = false
    @Published var regenerating = false
    @Published var settingsOpen = false

    enum Tab { case plan, history }

    var theme: Theme { Theme(dark: settings.dark) }

    func updateSettings(_ s: AppSettings) {
        settings = s
        Stores.saveSettings(s)
    }

    func updateDraft(_ d: PlanDraft) {
        draft = d
        Stores.saveDraft(d)
    }

    func regenerate() async {
        guard let r = result, !regenerating else { return }
        regenerating = true
        defer { regenerating = false }
        do {
            var plan = r.plan
            plan.jitter = 0.7
            let fresh = try await RouteBuilder.build(start: r.start, plan: plan, city: r.city)
            result = BuiltRoute(
                route: fresh.route, highlights: fresh.highlights, shape: fresh.shape,
                targetMeters: fresh.targetMeters, distanceMeters: fresh.distanceMeters,
                rationale: fresh.rationale, start: r.start, unit: r.unit, plan: r.plan,
                city: r.city, community: r.community
            )
            Haptics.success()
        } catch {
            // keep the old route; surface nothing fatal
        }
    }

    /// Save a finished run: history + personal boosts + community submit, then go home.
    func saveRun(_ record: RunRecord) {
        Stores.appendRun(record)
        Stores.applyBoosts(from: record)
        Task { await CommunityAPI.submit(record) }
        withAnimation(.easeInOut(duration: 0.25)) {
            running = false
            result = nil
        }
    }
}
