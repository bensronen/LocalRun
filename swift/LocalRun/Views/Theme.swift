import SwiftUI

/// iOS-neutral surfaces with a dark evergreen accent. Light = system grouped
/// background + white cards; dark = pure black + elevated cards, with the
/// accent lightened for contrast (port of src/theme.js).
struct Theme {
    let dark: Bool

    var bg: Color { dark ? .black : Color(hex: "f2f2f7") }
    var card: Color { dark ? Color(hex: "1c1c1e") : .white }
    var cardAlt: Color { dark ? Color(hex: "2c2c2e") : Color(hex: "f2f2f7") }
    var text: Color { dark ? Color(hex: "f2f2f7") : Color(hex: "1c1c1e") }
    var textDim: Color { dark ? Color(hex: "98989f") : Color(hex: "6e6e73") }
    var accent: Color { Theme.accent(dark: dark) }
    var accentDeep: Color { dark ? Color(hex: "3c8a5f") : Color(hex: "1e4a30") }
    var good: Color { accent }
    var tint: Color { accent.opacity(dark ? 0.22 : 0.12) }
    var danger: Color { dark ? Color(hex: "e0654f") : Color(hex: "b9543f") }
    var onAccent: Color { .white }

    static func accent(dark: Bool) -> Color {
        dark ? Color(hex: "4ca271") : Color(hex: "2c5e40")
    }

    static func categoryColor(_ category: String) -> Color {
        Color(hex: CategoryMeta.all[category]?.colorHex ?? "2c5e40")
    }
}

extension Color {
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&v)
        self.init(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }
}

/// Liquid Glass on iOS 26+, frosted material elsewhere. Applies the shape too.
struct GlassBackground<S: Shape>: ViewModifier {
    var shape: S

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: shape)
        } else {
            content.background(.ultraThinMaterial, in: shape)
        }
    }
}

extension View {
    func glass<S: Shape>(in shape: S) -> some View {
        modifier(GlassBackground(shape: shape))
    }

    func glassCapsule() -> some View {
        glass(in: Capsule())
    }
}

/// Standard white/elevated card with the soft shadow used everywhere.
struct CardStyle: ViewModifier {
    @EnvironmentObject var app: AppState
    var radius: CGFloat = 14

    func body(content: Content) -> some View {
        content
            .background(app.theme.card)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .shadow(color: .black.opacity(app.settings.dark ? 0 : 0.06), radius: 10, y: 2)
    }
}

extension View {
    func card(radius: CGFloat = 14) -> some View { modifier(CardStyle(radius: radius)) }
}

/// Small uppercase section header, iOS Settings style.
struct SectionLabel: View {
    @EnvironmentObject var app: AppState
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 13, weight: .semibold))
            .kerning(0.6)
            .foregroundStyle(app.theme.textDim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 24)
            .padding(.bottom, 2)
    }
}
