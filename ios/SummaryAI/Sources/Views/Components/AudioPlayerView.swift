import SwiftUI
import AVFoundation

// MARK: - Audio Player View

/// Full-featured audio player with scrubber and speed control
struct AudioPlayerView: View {
    let audioURL: URL?
    let duration: TimeInterval
    let onSeek: ((TimeInterval) -> Void)?

    @StateObject private var player = AudioPlayerManager()
    @State private var isDragging = false

    init(audioURL: URL?, duration: TimeInterval, onSeek: ((TimeInterval) -> Void)? = nil) {
        self.audioURL = audioURL
        self.duration = duration
        self.onSeek = onSeek
    }

    var body: some View {
        VStack(spacing: 12) {
            // Progress slider
            VStack(spacing: 4) {
                Slider(
                    value: Binding(
                        get: { isDragging ? player.seekTime : player.currentTime },
                        set: { newValue in
                            player.seekTime = newValue
                            isDragging = true
                        }
                    ),
                    in: 0...max(duration, 1),
                    onEditingChanged: { editing in
                        if !editing {
                            player.seek(to: player.seekTime)
                            onSeek?(player.seekTime)
                            isDragging = false
                        }
                    }
                )
                .tint(.blue)

                // Time labels
                HStack {
                    Text(formatTime(isDragging ? player.seekTime : player.currentTime))
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .monospacedDigit()

                    Spacer()

                    Text(formatTime(duration))
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .monospacedDigit()
                }
            }

            // Controls
            HStack(spacing: 24) {
                // Playback speed
                Menu {
                    ForEach(PlaybackSpeed.allCases, id: \.self) { speed in
                        Button {
                            player.setPlaybackSpeed(speed.rate)
                        } label: {
                            HStack {
                                Text(speed.label)
                                if player.playbackSpeed == speed.rate {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    Text(PlaybackSpeed.label(for: player.playbackSpeed))
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.gray.opacity(0.15))
                        .cornerRadius(4)
                }

                Spacer()

                // Skip backward
                Button {
                    player.skipBackward(seconds: 15)
                } label: {
                    Image(systemName: "gobackward.15")
                        .font(.title2)
                        .foregroundColor(.primary)
                }

                // Play/Pause
                Button {
                    if player.isPlaying {
                        player.pause()
                    } else {
                        player.play()
                    }
                } label: {
                    ZStack {
                        Circle()
                            .fill(player.isLoading ? Color.gray : Color.blue)
                            .frame(width: 56, height: 56)

                        if player.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.title2)
                                .foregroundColor(.white)
                                .offset(x: player.isPlaying ? 0 : 2) // Visual center for play icon
                        }
                    }
                }
                .disabled(player.isLoading)

                // Skip forward
                Button {
                    player.skipForward(seconds: 15)
                } label: {
                    Image(systemName: "goforward.15")
                        .font(.title2)
                        .foregroundColor(.primary)
                }

                Spacer()

                // Download/Share button
                Button {
                    // Handle download action
                } label: {
                    Image(systemName: "square.and.arrow.down")
                        .font(.title3)
                        .foregroundColor(.primary)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(16)
        .onAppear {
            if let url = audioURL {
                player.loadAudio(from: url)
            }
        }
        .onDisappear {
            player.stop()
        }
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - Playback Speed

enum PlaybackSpeed: CaseIterable {
    case halfSpeed
    case threeQuarterSpeed
    case normal
    case oneAndQuarter
    case oneAndHalf
    case double

    var rate: Float {
        switch self {
        case .halfSpeed: return 0.5
        case .threeQuarterSpeed: return 0.75
        case .normal: return 1.0
        case .oneAndQuarter: return 1.25
        case .oneAndHalf: return 1.5
        case .double: return 2.0
        }
    }

    var label: String {
        switch self {
        case .halfSpeed: return "0.5x"
        case .threeQuarterSpeed: return "0.75x"
        case .normal: return "1x"
        case .oneAndQuarter: return "1.25x"
        case .oneAndHalf: return "1.5x"
        case .double: return "2x"
        }
    }

    static func label(for rate: Float) -> String {
        if rate == 1.0 { return "1.0x" }
        return String(format: "%.2gx", rate)
    }
}

// MARK: - Audio Player Manager

@MainActor
class AudioPlayerManager: ObservableObject {
    @Published var isPlaying = false
    @Published var currentTime: TimeInterval = 0
    @Published var seekTime: TimeInterval = 0
    @Published var playbackSpeed: Float = 1.0
    @Published var isLoading = false
    @Published var error: String?

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?

    func loadAudio(from url: URL) {
        print("[AudioPlayer] Loading audio from: \(url.absoluteString.prefix(80))...")

        // Configure audio session for playback
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .default, options: [])
            try audioSession.setActive(true)
            print("[AudioPlayer] Audio session configured successfully")
        } catch {
            print("[AudioPlayer] Failed to configure audio session: \(error)")
            self.error = "Failed to configure audio: \(error.localizedDescription)"
            return
        }

        isLoading = true
        error = nil

        let playerItem = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: playerItem)

        // Observe player item status to know when it's ready
        statusObserver = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                switch item.status {
                case .readyToPlay:
                    print("[AudioPlayer] Player ready to play")
                    self?.isLoading = false
                case .failed:
                    let errorMessage = item.error?.localizedDescription ?? "Unknown error"
                    print("[AudioPlayer] Player failed: \(errorMessage)")
                    self?.error = errorMessage
                    self?.isLoading = false
                case .unknown:
                    print("[AudioPlayer] Player status unknown")
                @unknown default:
                    break
                }
            }
        }

        // Add time observer for progress tracking
        timeObserver = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                if self?.isPlaying == true {
                    self?.currentTime = time.seconds
                }
            }
        }

        // Observe when playback ends
        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                print("[AudioPlayer] Playback ended")
                self?.isPlaying = false
                self?.seek(to: 0)
            }
        }
    }

    func play() {
        guard let player = player else {
            print("[AudioPlayer] No player available")
            return
        }

        guard player.currentItem?.status == .readyToPlay else {
            print("[AudioPlayer] Player not ready yet, status: \(player.currentItem?.status.rawValue ?? -1)")
            return
        }

        print("[AudioPlayer] Starting playback at rate: \(playbackSpeed)")
        player.rate = playbackSpeed
        isPlaying = true
    }

    func pause() {
        print("[AudioPlayer] Pausing")
        player?.pause()
        isPlaying = false
    }

    func stop() {
        player?.pause()
        player?.seek(to: .zero)
        isPlaying = false
        currentTime = 0

        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }

        statusObserver?.invalidate()
        statusObserver = nil
    }

    func seek(to time: TimeInterval) {
        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        player?.seek(to: cmTime, toleranceBefore: .zero, toleranceAfter: .zero)
        currentTime = time
    }

    func skipForward(seconds: Double) {
        let newTime = min(currentTime + seconds, player?.currentItem?.duration.seconds ?? currentTime)
        seek(to: newTime)
    }

    func skipBackward(seconds: Double) {
        let newTime = max(currentTime - seconds, 0)
        seek(to: newTime)
    }

    func setPlaybackSpeed(_ speed: Float) {
        playbackSpeed = speed
        if isPlaying {
            player?.rate = speed
        }
    }
}

// MARK: - Compact Audio Player

/// Smaller audio player for inline use
struct CompactAudioPlayerView: View {
    let audioURL: URL?
    let duration: TimeInterval

    @StateObject private var player = AudioPlayerManager()

    var body: some View {
        HStack(spacing: 12) {
            // Play/Pause button
            Button {
                if player.isPlaying {
                    player.pause()
                } else {
                    player.play()
                }
            } label: {
                Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(.blue)
            }

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Background
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.gray.opacity(0.2))
                        .frame(height: 4)

                    // Progress
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.blue)
                        .frame(width: geometry.size.width * CGFloat(player.currentTime / max(duration, 1)), height: 4)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 20)

            // Time
            Text(formatTime(player.currentTime))
                .font(.caption)
                .foregroundColor(.secondary)
                .monospacedDigit()
                .frame(width: 40, alignment: .trailing)
        }
        .onAppear {
            if let url = audioURL {
                player.loadAudio(from: url)
            }
        }
        .onDisappear {
            player.stop()
        }
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - Preview

#if DEBUG
struct AudioPlayerView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 20) {
            AudioPlayerView(audioURL: nil, duration: 245)
                .padding()

            CompactAudioPlayerView(audioURL: nil, duration: 120)
                .padding()
        }
    }
}
#endif
