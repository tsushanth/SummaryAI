import SwiftUI

// MARK: - Live Waveform View

/// Animated waveform visualization for recording
struct LiveWaveformView: View {
    let audioLevel: Float

    @State private var waveformData: [Float] = Array(repeating: 0.1, count: 50)
    @State private var animationTimer: Timer?

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 3) {
                ForEach(Array(waveformData.enumerated()), id: \.offset) { index, level in
                    WaveformBar(level: CGFloat(level), maxHeight: geometry.size.height)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: audioLevel) { _, newLevel in
            updateWaveform(with: newLevel)
        }
        .onAppear {
            startAnimation()
        }
        .onDisappear {
            stopAnimation()
        }
    }

    private func updateWaveform(with level: Float) {
        // Shift all values left and add new level at the end
        var newData = waveformData
        newData.removeFirst()
        // Add some variation to make it look more natural
        let variation = Float.random(in: -0.1...0.1)
        let adjustedLevel = max(0.05, min(1.0, level + variation))
        newData.append(adjustedLevel)

        withAnimation(.linear(duration: 0.1)) {
            waveformData = newData
        }
    }

    private func startAnimation() {
        // Add subtle animation even when not receiving audio
        animationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            if audioLevel < 0.1 {
                // Add subtle movement when quiet
                let randomIndex = Int.random(in: 0..<waveformData.count)
                var newData = waveformData
                newData[randomIndex] = Float.random(in: 0.05...0.15)
                withAnimation(.easeInOut(duration: 0.1)) {
                    waveformData = newData
                }
            }
        }
    }

    private func stopAnimation() {
        animationTimer?.invalidate()
        animationTimer = nil
    }
}

// MARK: - Waveform Bar

struct WaveformBar: View {
    let level: CGFloat
    let maxHeight: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(barGradient)
            .frame(width: 4, height: barHeight)
    }

    private var barHeight: CGFloat {
        let minHeight: CGFloat = 4
        let height = max(minHeight, level * maxHeight)
        return min(height, maxHeight)
    }

    private var barGradient: LinearGradient {
        let colors: [Color]
        if level > 0.7 {
            colors = [.red, .orange]
        } else if level > 0.4 {
            colors = [.orange, .yellow]
        } else {
            colors = [.blue, .cyan]
        }
        return LinearGradient(colors: colors, startPoint: .bottom, endPoint: .top)
    }
}

// MARK: - Circular Waveform View

/// Circular waveform visualization alternative
struct CircularWaveformView: View {
    let audioLevel: Float
    let isRecording: Bool

    @State private var rotation: Double = 0

    var body: some View {
        ZStack {
            // Outer ring
            Circle()
                .stroke(
                    AngularGradient(
                        gradient: Gradient(colors: [.blue, .purple, .pink, .blue]),
                        center: .center
                    ),
                    lineWidth: 4
                )
                .frame(width: 200, height: 200)
                .rotationEffect(.degrees(rotation))
                .opacity(isRecording ? 1 : 0.3)

            // Audio level ring
            Circle()
                .trim(from: 0, to: CGFloat(audioLevel))
                .stroke(Color.blue, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                .frame(width: 160, height: 160)
                .rotationEffect(.degrees(-90))

            // Inner circle with level
            Circle()
                .fill(
                    RadialGradient(
                        colors: [.blue.opacity(0.3), .clear],
                        center: .center,
                        startRadius: 0,
                        endRadius: 60
                    )
                )
                .frame(width: 120, height: 120)
                .scaleEffect(1 + CGFloat(audioLevel) * 0.2)

            // Center icon
            Image(systemName: "mic.fill")
                .font(.system(size: 40))
                .foregroundColor(isRecording ? .red : .gray)
        }
        .animation(.easeInOut(duration: 0.1), value: audioLevel)
        .onAppear {
            if isRecording {
                withAnimation(.linear(duration: 10).repeatForever(autoreverses: false)) {
                    rotation = 360
                }
            }
        }
    }
}

// MARK: - Mini Waveform View

/// Small waveform for list items or compact displays
struct MiniWaveformView: View {
    let levels: [Float]
    let color: Color

    init(levels: [Float] = [], color: Color = .blue) {
        // Generate random levels if none provided
        if levels.isEmpty {
            self.levels = (0..<20).map { _ in Float.random(in: 0.2...0.8) }
        } else {
            self.levels = levels
        }
        self.color = color
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                RoundedRectangle(cornerRadius: 1)
                    .fill(color)
                    .frame(width: 2, height: CGFloat(level) * 20)
            }
        }
        .frame(height: 20)
    }
}

// MARK: - Preview

#if DEBUG
struct LiveWaveformView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 40) {
            LiveWaveformView(audioLevel: 0.6)
                .frame(height: 100)
                .padding()

            CircularWaveformView(audioLevel: 0.5, isRecording: true)

            MiniWaveformView()
        }
        .padding()
    }
}
#endif
