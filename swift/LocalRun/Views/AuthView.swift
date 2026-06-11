import SwiftUI

/// Login / create-account sheet. Accounts put your username on community
/// runs and unlock the feed identity; everything else works without one.
struct AuthView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var auth = AuthService.shared
    @Environment(\.dismiss) private var dismiss

    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var email = ""
    @State private var identifier = ""
    @State private var password = ""
    @State private var busy = false
    @State private var errorText: String?

    enum Mode: String, CaseIterable {
        case login = "Log in"
        case signup = "Create account"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Capsule().fill(app.theme.textDim.opacity(0.3)).frame(width: 44, height: 5)
                .frame(maxWidth: .infinity).padding(.top, 10)
            Text("LocalRun account")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(app.theme.text)
                .padding(.top, 8)
            Text("Your username appears on community runs. Routes, history, and photos all work without an account.")
                .font(.system(size: 13)).foregroundStyle(app.theme.textDim)

            Picker("", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.top, 4)

            Group {
                if mode == .signup {
                    field("Username", text: $username, content: .username)
                    field("Email", text: $email, content: .emailAddress)
                } else {
                    field("Username or email", text: $identifier, content: .username)
                }
                SecureField("Password\(mode == .signup ? " (8+ characters)" : "")", text: $password)
                    .textContentType(mode == .signup ? .newPassword : .password)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(app.theme.cardAlt, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            if let e = errorText {
                Text(e).font(.system(size: 13, weight: .medium)).foregroundStyle(app.theme.danger)
            }

            Button {
                Task { await submit() }
            } label: {
                Group {
                    if busy { ProgressView().tint(app.theme.onAccent) }
                    else { Text(mode.rawValue).font(.system(size: 16, weight: .semibold)) }
                }
                .foregroundStyle(app.theme.onAccent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(app.theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(busy)
            .padding(.top, 6)
            Spacer()
        }
        .padding(.horizontal, 22)
        .background(app.theme.card)
    }

    private func field(_ placeholder: String, text: Binding<String>, content: UITextContentType) -> some View {
        TextField(placeholder, text: text)
            .textContentType(content)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(app.theme.cardAlt, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func submit() async {
        errorText = nil
        busy = true
        defer { busy = false }
        do {
            if mode == .signup {
                try await auth.signup(
                    username: username.trimmingCharacters(in: .whitespaces),
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            } else {
                try await auth.login(
                    identifier: identifier.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            }
            Haptics.success()
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}
