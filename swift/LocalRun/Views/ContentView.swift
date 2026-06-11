import SwiftUI

/// Top-level flow: plan/history are tabs under a floating glass pill;
/// a built route and an active run take over the full screen.
struct ContentView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        ZStack(alignment: .bottom) {
            app.theme.bg.ignoresSafeArea()

            if app.running, let result = app.result {
                RunView(result: result)
                    .transition(.opacity)
            } else if let result = app.result {
                RouteView(result: result)
                    .transition(.opacity)
            } else {
                Group {
                    switch app.tab {
                    case .plan: PlanView()
                    case .history: HistoryView()
                    }
                }
                .transition(.opacity)
                TabBarView()
                    .padding(.bottom, 10)
            }
        }
        .sheet(isPresented: $app.settingsOpen) {
            SettingsSheet()
                .environmentObject(app)
                .presentationDetents([.medium, .large])
        }
    }
}

/// Floating Liquid Glass page selector.
struct TabBarView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        HStack(spacing: 4) {
            tabItem(.plan, label: "Plan", symbol: "map.fill")
            tabItem(.history, label: "Runs", symbol: "figure.run")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .glassCapsule()
    }

    private func tabItem(_ tab: AppState.Tab, label: String, symbol: String) -> some View {
        let active = app.tab == tab
        return Button {
            if !active {
                Haptics.tap()
                withAnimation(.easeInOut(duration: 0.2)) { app.tab = tab }
            }
        } label: {
            HStack(spacing: 7) {
                Image(systemName: symbol).font(.system(size: 17, weight: .semibold))
                Text(label).font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(active ? app.theme.accent : app.theme.textDim)
            .padding(.horizontal, 18)
            .padding(.vertical, 9)
            .background(active ? app.theme.tint : .clear, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}
