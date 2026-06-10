import Foundation

/// Generate a GPX 1.1 document from a run's recorded GPS track —
/// importable by Strava, Garmin, Apple Health importers, etc.
enum GPX {
    static func document(for run: RunRecord) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime]
        let points = run.track.map { p in
            let time = fmt.string(from: Date(timeIntervalSince1970: p.t))
            return "      <trkpt lat=\"\(p.lat)\" lon=\"\(p.lng)\"><time>\(time)</time></trkpt>"
        }.joined(separator: "\n")
        let startTime = fmt.string(from: Date(timeIntervalSince1970: run.ts / 1000))
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="LocalRun" xmlns="http://www.topografix.com/GPX/1/1">
          <metadata><time>\(startTime)</time></metadata>
          <trk>
            <name>LocalRun — \(run.cityName)</name>
            <type>running</type>
            <trkseg>
        \(points)
            </trkseg>
          </trk>
        </gpx>
        """
    }

    /// Write the GPX to a shareable temp file.
    static func tempFile(for run: RunRecord) -> URL? {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("localrun-\(run.id).gpx")
        do {
            try document(for: run).data(using: .utf8)?.write(to: url, options: .atomic)
            return url
        } catch { return nil }
    }
}
