import Foundation

/// Account client for the LocalRun backend: signup/login/logout, profile,
/// and App Store-required account deletion. Token kept in UserDefaults
/// (move to Keychain before wide release).
@MainActor
final class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published var username: String? = UserDefaults.standard.string(forKey: "auth.username")
    @Published var profile: Profile?

    var token: String? { UserDefaults.standard.string(forKey: "auth.token") }
    var signedIn: Bool { token != nil && username != nil }

    struct Profile: Decodable {
        let username: String
        let runs: Int
        let distM: Int
        let photos: Int
    }

    struct AuthError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    nonisolated init() {}

    /// Adds the bearer token to any outgoing request when signed in.
    nonisolated static func authorize(_ req: inout URLRequest) {
        if let token = UserDefaults.standard.string(forKey: "auth.token") {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    func signup(username: String, email: String, password: String) async throws {
        let r: TokenResponse = try await post("auth/signup", [
            "username": username, "email": email, "password": password,
        ])
        store(r)
    }

    func login(identifier: String, password: String) async throws {
        let r: TokenResponse = try await post("auth/login", [
            "identifier": identifier, "password": password,
        ])
        store(r)
    }

    func logout() {
        UserDefaults.standard.removeObject(forKey: "auth.token")
        UserDefaults.standard.removeObject(forKey: "auth.username")
        username = nil
        profile = nil
    }

    func refreshProfile() async {
        guard signedIn, Config.hasAPI,
              let url = URL(string: "\(Config.apiURL)/api/me") else { return }
        var req = URLRequest(url: url, timeoutInterval: 8)
        Self.authorize(&req)
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let p = try? JSONDecoder().decode(Profile.self, from: data)
        else { return }
        profile = p
    }

    func deleteAccount() async throws {
        guard Config.hasAPI, let url = URL(string: "\(Config.apiURL)/api/me") else {
            throw AuthError(message: "No server configured.")
        }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = "DELETE"
        Self.authorize(&req)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            throw AuthError(message: serverError(data) ?? "Could not delete the account.")
        }
        logout()
    }

    // MARK: - plumbing

    private struct TokenResponse: Decodable {
        let token: String
        let username: String
    }

    private func post<T: Decodable>(_ path: String, _ body: [String: String]) async throws -> T {
        guard Config.hasAPI, let url = URL(string: "\(Config.apiURL)/api/\(path)") else {
            throw AuthError(message: "Set apiURL in Config.swift to enable accounts.")
        }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            throw AuthError(message: serverError(data) ?? "Something went wrong — try again.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func serverError(_ data: Data) -> String? {
        struct E: Decodable { let error: String }
        return (try? JSONDecoder().decode(E.self, from: data))?.error
    }

    private func store(_ r: TokenResponse) {
        UserDefaults.standard.set(r.token, forKey: "auth.token")
        UserDefaults.standard.set(r.username, forKey: "auth.username")
        username = r.username
        Task { await refreshProfile() }
    }
}
