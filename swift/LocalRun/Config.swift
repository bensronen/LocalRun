import Foundation

/// Fill these in before building. Mapbox token is required for routing;
/// the API URL and Strava client id are optional features.
enum Config {
    /// Free token from https://account.mapbox.com/access-tokens/ (starts with pk.)
    static let mapboxToken = "pk.YOUR_MAPBOX_TOKEN_HERE"

    /// LocalRun community backend (server/ in this repo), e.g. "https://localrun.fly.dev".
    /// Leave empty to run fully solo. Also used for the Strava token exchange.
    static let apiURL = ""

    /// Strava API application client id (https://www.strava.com/settings/api).
    /// The client SECRET lives on the backend (STRAVA_CLIENT_SECRET env), never here.
    static let stravaClientID = ""

    static var hasMapboxToken: Bool {
        mapboxToken.count > 20 && !mapboxToken.contains("YOUR_")
    }
    static var hasAPI: Bool { !apiURL.isEmpty }
    static var hasStrava: Bool { !stravaClientID.isEmpty && hasAPI }
}
