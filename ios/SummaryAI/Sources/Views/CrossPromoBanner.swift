import SwiftUI

struct CrossPromoBanner: View {
    @AppStorage("crosspromo_6758923895_dismissed") private var dismissed = false

    private let appStoreURL = URL(string: "https://apps.apple.com/app/id6758923895")!

    var body: some View {
        if !dismissed {
            Button {
                UIApplication.shared.open(appStoreURL)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(.tint)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("ClearVoice Recorder")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                            Text("Free")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Color.green.opacity(0.15))
                                .foregroundStyle(.green)
                                .clipShape(Capsule())
                        }
                        Text("Record crystal-clear audio for all your meetings.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.leading)
                    }

                    Spacer()

                    Button {
                        withAnimation { dismissed = true }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(12)
            }
            .buttonStyle(.plain)
        }
    }
}
