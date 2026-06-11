import SwiftUI

/// The social pulse of the selected city: recent community runs (with
/// usernames), the most-photographed sights, and your own standing.
struct FeedView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var auth = AuthService.shared

    @State private var community: CommunitySnapshot?
    @State private var loading = false
    @State private var authOpen = false

    private var city: City {
        if let id = app.draft.cityId, let c = Cities.all.first(where: { $0.id == id }) { return c }
        return Cities.all.first!
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Community")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(app.theme.text)
                    .padding(.top, 16)
                Text(city.name)
                    .font(.subheadline).foregroundStyle(app.theme.textDim)

                if !Config.hasAPI {
                    explainer("The community feed needs the LocalRun server. Set apiURL in Config.swift once it's deployed.")
                } else {
                    accountCard
                    leaderboard
                    recentRuns
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 110)
            .containerRelativeFrame(.horizontal)
        }
        .refreshable { await load(force: true) }
        .task { await load(force: true) }
        .sheet(isPresented: $authOpen) {
            AuthView()
                .environmentObject(app)
                .presentationDetents([.medium, .large])
        }
    }

    private func load(force: Bool) async {
        loading = true
        community = await CommunityAPI.fetchCommunity(city.id, force: force)
        await auth.refreshProfile()
        loading = false
    }

    private func explainer(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 14)).foregroundStyle(app.theme.textDim)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .padding(.top, 16)
    }

    // MARK: - You

    @ViewBuilder
    private var accountCard: some View {
        if auth.signedIn {
            HStack(spacing: 14) {
                Image(systemName: "person.crop.circle.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(app.theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("@\(auth.username ?? "")")
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(app.theme.text)
                    if let p = auth.profile {
                        Text("\(p.runs) runs · \(String(format: "%.1f", Double(p.distM) / 1000)) km · \(p.photos) sights shot")
                            .font(.system(size: 13)).foregroundStyle(app.theme.textDim)
                    }
                }
                Spacer()
            }
            .padding(14)
            .card()
            .padding(.top, 16)
        } else {
            Button {
                authOpen = true
            } label: {
                HStack {
                    Image(systemName: "person.crop.circle.badge.plus")
                        .font(.system(size: 18, weight: .semibold))
                    Text("Sign in to put your name on your runs")
                        .font(.system(size: 14, weight: .semibold))
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(app.theme.accent)
                .padding(14)
                .background(app.theme.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.top, 16)
        }
    }

    // MARK: - Most photographed

    @ViewBuilder
    private var leaderboard: some View {
        if let top = community?.top, !top.isEmpty {
            SectionLabel(text: "Most photographed")
            VStack(spacing: 0) {
                ForEach(Array(top.prefix(5).enumerated()), id: \.element.id) { i, t in
                    HStack(spacing: 10) {
                        Text("\(i + 1)")
                            .font(.system(size: 13, weight: .heavy))
                            .foregroundStyle(app.theme.accent)
                            .frame(width: 20)
                        Text(placeName(t.id))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(app.theme.text)
                            .lineLimit(1)
                        Spacer()
                        HStack(spacing: 4) {
                            Image(systemName: "camera").font(.system(size: 11))
                            Text("\(t.photos)").font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundStyle(app.theme.textDim)
                    }
                    .padding(.vertical, 9)
                    if i < min(top.count, 5) - 1 { Divider() }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .card()
        }
    }

    // MARK: - Recent runs

    @ViewBuilder
    private var recentRuns: some View {
        SectionLabel(text: "Recent runs")
        let entries = community?.recent ?? []
        if entries.isEmpty {
            Text(loading ? "Loading…" : "No runs here yet — be the first. Finish a run and save it.")
                .font(.system(size: 14)).foregroundStyle(app.theme.textDim)
                .padding(.top, 4)
        }
        ForEach(entries) { e in
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "figure.run.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(app.theme.accent.opacity(e.username == nil ? 0.4 : 1))
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(e.username.map { "@\($0)" } ?? "A runner")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(app.theme.text)
                        Spacer()
                        Text(timeAgo(e.ts))
                            .font(.system(size: 12)).foregroundStyle(app.theme.textDim)
                    }
                    Text(runLine(e))
                        .font(.system(size: 13)).foregroundStyle(app.theme.textDim)
                    if let ids = e.photoPlaceIds, !ids.isEmpty {
                        HStack(spacing: 5) {
                            Image(systemName: "camera").font(.system(size: 10, weight: .semibold))
                            Text(ids.map(placeName).joined(separator: ", "))
                                .font(.system(size: 12, weight: .medium))
                                .lineLimit(1)
                        }
                        .foregroundStyle(app.theme.accent)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .padding(.bottom, 10)
        }
    }

    private func runLine(_ e: CommunitySnapshot.FeedEntry) -> String {
        var s = "\(String(format: "%.1f", e.distM / 1000)) km · \(Format.clock(e.elapsed))"
        if e.rating > 0 { s += " · \(String(repeating: "★", count: e.rating))" }
        return s
    }

    private func placeName(_ id: String) -> String {
        city.places.first(where: { $0.id == id })?.name ?? id
    }

    private func timeAgo(_ ts: Double) -> String {
        let secs = Date().timeIntervalSince1970 - ts / 1000
        if secs < 90 { return "just now" }
        if secs < 3600 { return "\(Int(secs / 60))m ago" }
        if secs < 86_400 { return "\(Int(secs / 3600))h ago" }
        return "\(Int(secs / 86_400))d ago"
    }
}
