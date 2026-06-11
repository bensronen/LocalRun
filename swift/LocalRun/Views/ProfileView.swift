import SwiftUI

/// Profile sheet, opened from the person button on the plan screen.
/// Signed out it IS the login page; signed in it shows your community
/// stats, Strava connection, and account controls.
struct ProfileView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var auth = AuthService.shared
    @StateObject private var strava = StravaService.shared
    @Environment(\.dismiss) private var dismiss

    @State private var stravaBusy = false
    @State private var deleteConfirm = false
    @State private var errorText: String?

    var body: some View {
        Group {
            if !Config.hasAPI {
                noServer
            } else if auth.signedIn {
                profile
            } else {
                AuthView().environmentObject(app)
            }
        }
        .task { await auth.refreshProfile() }
        .alert("Delete your account?", isPresented: $deleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task {
                    do {
                        try await auth.deleteAccount()
                        dismiss()
                    } catch { errorText = error.localizedDescription }
                }
            }
        } message: {
            Text("Removes your username and profile from the community server. Runs and photos on this phone are kept.")
        }
        .alert("Profile", isPresented: .init(
            get: { errorText != nil }, set: { if !$0 { errorText = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorText ?? "")
        }
    }

    private var noServer: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.system(size: 44)).foregroundStyle(app.theme.textDim)
            Text("Profiles need the LocalRun server")
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(app.theme.text)
            Text("Deploy server/ (one click with render.yaml) and set apiURL in Config.swift.")
                .font(.system(size: 13)).foregroundStyle(app.theme.textDim)
                .multilineTextAlignment(.center)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(app.theme.card)
    }

    private var profile: some View {
        ScrollView {
            VStack(spacing: 0) {
                Capsule().fill(app.theme.textDim.opacity(0.3)).frame(width: 44, height: 5)
                    .padding(.top, 10)
                Image(systemName: "person.crop.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(app.theme.accent)
                    .padding(.top, 18)
                Text("@\(auth.username ?? "")")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(app.theme.text)
                    .padding(.top, 8)

                HStack {
                    stat("\(auth.profile?.runs ?? 0)", "runs")
                    stat(String(format: "%.1f km", Double(auth.profile?.distM ?? 0) / 1000), "distance")
                    stat("\(auth.profile?.photos ?? 0)", "sights shot")
                }
                .padding(16)
                .background(app.theme.cardAlt, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.top, 18)

                if Config.hasStrava {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Strava").font(.system(size: 16, weight: .semibold)).foregroundStyle(app.theme.text)
                            Text(strava.connected
                                 ? "Connected\(strava.athleteName.isEmpty ? "" : " as \(strava.athleteName)")"
                                 : "Send saved runs to your feed.")
                                .font(.system(size: 13)).foregroundStyle(app.theme.textDim)
                        }
                        Spacer()
                        Button {
                            Task { await toggleStrava() }
                        } label: {
                            if stravaBusy { ProgressView() }
                            else {
                                Text(strava.connected ? "Disconnect" : "Connect")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(strava.connected ? app.theme.danger : app.theme.accent)
                            }
                        }
                    }
                    .padding(16)
                    .background(app.theme.cardAlt, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .padding(.top, 10)
                }

                Button {
                    auth.logout()
                    dismiss()
                } label: {
                    Text("Sign out")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(app.theme.danger)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(app.theme.cardAlt, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .padding(.top, 22)
                Button {
                    deleteConfirm = true
                } label: {
                    Text("Delete account…")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(app.theme.danger.opacity(0.8))
                }
                .padding(.top, 10)
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 30)
        }
        .background(app.theme.card)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.system(size: 20, weight: .bold)).foregroundStyle(app.theme.text)
            Text(label).font(.system(size: 12)).foregroundStyle(app.theme.textDim)
        }
        .frame(maxWidth: .infinity)
    }

    private func toggleStrava() async {
        if strava.connected {
            strava.disconnect()
            return
        }
        stravaBusy = true
        defer { stravaBusy = false }
        do { try await strava.connect() }
        catch { errorText = error.localizedDescription }
    }
}
