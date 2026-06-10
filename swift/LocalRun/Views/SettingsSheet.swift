import SwiftUI

struct SettingsSheet: View {
    @EnvironmentObject var app: AppState
    @StateObject private var strava = StravaService.shared
    @Environment(\.dismiss) private var dismiss
    @State private var stravaBusy = false
    @State private var stravaError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(app.theme.textDim.opacity(0.3)).frame(width: 44, height: 5)
                .frame(maxWidth: .infinity).padding(.top, 10)
            Text("Settings")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(app.theme.text)
                .padding(.top, 14)

            Text("How much should it talk?")
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(app.theme.text)
                .padding(.top, 18)
            Text("Turn directions and place call-outs always play. This sets how often it narrates the area you're running through.")
                .font(.system(size: 13)).foregroundStyle(app.theme.textDim).padding(.top, 3)
            HStack(spacing: 8) {
                ForEach(TalkLevel.all) { l in
                    let active = app.settings.talk == l.id
                    Button {
                        var s = app.settings
                        s.talk = l.id
                        app.updateSettings(s)
                    } label: {
                        VStack(spacing: 3) {
                            Text(l.label)
                                .font(.system(size: 14, weight: active ? .bold : .semibold))
                                .foregroundStyle(active ? app.theme.accent : app.theme.text)
                            Text(l.blurb)
                                .font(.system(size: 10)).foregroundStyle(app.theme.textDim)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(active ? app.theme.tint : app.theme.cardAlt,
                                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 12)

            toggleRow("Voice guidance", sub: "Speak directions and call-outs aloud.",
                      isOn: .init(get: { app.settings.voice }, set: { v in
                          var s = app.settings; s.voice = v; app.updateSettings(s)
                      }))
            toggleRow("Dark mode", sub: "Pure black, easier on the eyes at night.",
                      isOn: .init(get: { app.settings.dark }, set: { v in
                          var s = app.settings; s.dark = v; app.updateSettings(s)
                      }))

            if Config.hasStrava {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Strava").font(.system(size: 16, weight: .semibold)).foregroundStyle(app.theme.text)
                        Text(strava.connected
                             ? "Connected\(strava.athleteName.isEmpty ? "" : " as \(strava.athleteName)")"
                             : "Send saved runs to your Strava feed.")
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
                .padding(.top, 18)
            }

            Button {
                dismiss()
            } label: {
                Text("Done")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(app.theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.top, 26)
            Spacer()
        }
        .padding(.horizontal, 22)
        .background(app.theme.card)
        .alert("Strava", isPresented: .init(
            get: { stravaError != nil }, set: { if !$0 { stravaError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(stravaError ?? "")
        }
    }

    private func toggleRow(_ title: String, sub: String, isOn: Binding<Bool>) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(app.theme.text)
                Text(sub).font(.system(size: 13)).foregroundStyle(app.theme.textDim)
            }
            Spacer()
            Toggle("", isOn: isOn).labelsHidden().tint(app.theme.accent)
        }
        .padding(.top, 18)
    }

    private func toggleStrava() async {
        if strava.connected {
            strava.disconnect()
            return
        }
        stravaBusy = true
        defer { stravaBusy = false }
        do { try await strava.connect() }
        catch { stravaError = error.localizedDescription }
    }
}
