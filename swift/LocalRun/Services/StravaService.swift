import Foundation
import AuthenticationServices

/// Strava connection: OAuth via ASWebAuthenticationSession (no URL-scheme
/// registration needed — the session intercepts the redirect), with the token
/// exchange done by our backend so the client secret never ships in the app.
/// Uploads send the run's GPX to Strava's upload API.
@MainActor
final class StravaService: NSObject, ObservableObject {
    static let shared = StravaService()

    @Published var connected = UserDefaults.standard.string(forKey: "strava.access") != nil
    @Published var athleteName = UserDefaults.standard.string(forKey: "strava.athlete") ?? ""

    private var session: ASWebAuthenticationSession?

    enum StravaError: LocalizedError {
        case notConfigured, authFailed, uploadFailed(String)
        var errorDescription: String? {
            switch self {
            case .notConfigured: return "Set stravaClientID and apiURL in Config.swift first."
            case .authFailed: return "Strava sign-in was cancelled or failed."
            case let .uploadFailed(m): return "Strava upload failed: \(m)"
            }
        }
    }

    // MARK: - OAuth

    func connect() async throws {
        guard Config.hasStrava else { throw StravaError.notConfigured }
        // Strava validates the HOST of the redirect against the app's
        // "Authorization Callback Domain" — set that to `localhost` in your
        // Strava API settings; the custom scheme is the documented mobile pattern.
        let redirect = "localrun://localhost"
        var comps = URLComponents(string: "https://www.strava.com/oauth/mobile/authorize")!
        comps.queryItems = [
            .init(name: "client_id", value: Config.stravaClientID),
            .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"),
            .init(name: "approval_prompt", value: "auto"),
            .init(name: "scope", value: "activity:write,read"),
        ]
        let code: String = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: "localrun") { url, error in
                if let url,
                   let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                   let code = items.first(where: { $0.name == "code" })?.value {
                    cont.resume(returning: code)
                } else {
                    cont.resume(throwing: error ?? StravaError.authFailed)
                }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            self.session = s
            s.start()
        }
        try await exchange(code: code)
    }

    func disconnect() {
        for key in ["strava.access", "strava.refresh", "strava.expires", "strava.athlete"] {
            UserDefaults.standard.removeObject(forKey: key)
        }
        connected = false
        athleteName = ""
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_at: Double
        struct Athlete: Decodable { let firstname: String? }
        let athlete: Athlete?
    }

    private func exchange(code: String) async throws {
        let t: TokenResponse = try await backendToken(path: "exchange", body: ["code": code])
        store(t)
    }

    private func refreshIfNeeded() async throws {
        let expires = UserDefaults.standard.double(forKey: "strava.expires")
        guard Date().timeIntervalSince1970 > expires - 300 else { return }
        guard let refresh = UserDefaults.standard.string(forKey: "strava.refresh") else {
            throw StravaError.authFailed
        }
        let t: TokenResponse = try await backendToken(path: "refresh", body: ["refresh_token": refresh])
        store(t)
    }

    private func backendToken(path: String, body: [String: String]) async throws -> TokenResponse {
        guard let url = URL(string: "\(Config.apiURL)/api/strava/\(path)") else {
            throw StravaError.notConfigured
        }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw StravaError.authFailed }
        return try JSONDecoder().decode(TokenResponse.self, from: data)
    }

    private func store(_ t: TokenResponse) {
        UserDefaults.standard.set(t.access_token, forKey: "strava.access")
        UserDefaults.standard.set(t.refresh_token, forKey: "strava.refresh")
        UserDefaults.standard.set(t.expires_at, forKey: "strava.expires")
        if let name = t.athlete?.firstname { UserDefaults.standard.set(name, forKey: "strava.athlete") }
        connected = true
        athleteName = UserDefaults.standard.string(forKey: "strava.athlete") ?? ""
    }

    // MARK: - Upload

    /// Upload a saved run as a GPX activity. Returns Strava's upload id.
    func upload(_ run: RunRecord) async throws {
        guard connected else { throw StravaError.authFailed }
        guard !run.track.isEmpty else {
            throw StravaError.uploadFailed("This run has no GPS track recorded.")
        }
        try await refreshIfNeeded()
        guard let token = UserDefaults.standard.string(forKey: "strava.access") else {
            throw StravaError.authFailed
        }
        let gpx = GPX.document(for: run).data(using: .utf8)!
        let boundary = "localrun-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        field("data_type", "gpx")
        field("name", "LocalRun — \(run.cityName)")
        field("activity_type", "run")
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"run.gpx\"\r\nContent-Type: application/gpx+xml\r\n\r\n".data(using: .utf8)!)
        body.append(gpx)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: URL(string: "https://www.strava.com/api/v3/uploads")!, timeoutInterval: 30)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 201 || code == 200 else {
            throw StravaError.uploadFailed(String(data: data, encoding: .utf8) ?? "HTTP \(code)")
        }
    }
}

extension StravaService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        ASPresentationAnchor()
    }
}
