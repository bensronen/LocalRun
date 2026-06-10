import AVFoundation

/// Device TTS — port of the speak/stopSpeaking helpers.
final class SpeechService {
    static let shared = SpeechService()
    private let synth = AVSpeechSynthesizer()

    private init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.duckOthers, .mixWithOthers])
    }

    /// priority stops any current utterance first (turn directions never queue
    /// behind ambient narration).
    func speak(_ text: String, voice: Bool = true, priority: Bool = false) {
        guard voice, !text.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        if priority { synth.stopSpeaking(at: .immediate) }
        let u = AVSpeechUtterance(string: text)
        u.rate = AVSpeechUtteranceDefaultSpeechRate
        u.pitchMultiplier = 1.05
        synth.speak(u)
    }

    func stop() { synth.stopSpeaking(at: .immediate) }
}
