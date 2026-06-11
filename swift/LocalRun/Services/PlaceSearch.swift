import MapKit

/// Apple's local search: landmarks, businesses, parks, and addresses by name —
/// much better than address-only geocoding for queries like "Stanford Dish".
/// Biased to (but not limited by) the selected city's region. No token needed.
enum PlaceSearch {
    static func search(_ query: String, city: City) async -> [StartPoint] {
        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = query
        req.resultTypes = [.address, .pointOfInterest]
        req.region = MKCoordinateRegion(
            center: city.center.cl,
            span: MKCoordinateSpan(
                latitudeDelta: max(0.2, (city.bbox[3] - city.bbox[1]) * 1.6),
                longitudeDelta: max(0.2, (city.bbox[2] - city.bbox[0]) * 1.6)
            )
        )
        guard let resp = try? await MKLocalSearch(request: req).start() else { return [] }
        return resp.mapItems.prefix(5).map { item in
            let parts = [item.name, item.placemark.locality].compactMap { $0 }
            return StartPoint(
                lat: item.placemark.coordinate.latitude,
                lng: item.placemark.coordinate.longitude,
                name: parts.isEmpty ? "Result" : parts.joined(separator: ", ")
            )
        }
    }
}
