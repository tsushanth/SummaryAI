import SwiftUI

/// Pre-meeting AI Coach toggle. Lives above the Record button on
/// RecordingView. Shows current credit balance, lets the user pick a
/// persona (Phase 1: only Sales Discovery), and flips a binding the
/// view model checks when the recording starts.
struct CoachingToggleCard: View {
    @Binding var isEnabled: Bool
    @Binding var persona: CoachingPersonaKey
    let creditBalance: Int
    let isLoadingBalance: Bool
    let onGetMoreCredits: () -> Void
    let onClaimFreeTier: () async -> Void

    @State private var freeClaimAttempted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundColor(.purple)
                Text("AI Coach")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Toggle("", isOn: $isEnabled)
                    .labelsHidden()
                    .tint(.purple)
                    .disabled(creditBalance <= 0)
            }

            HStack {
                // Persona picker (single-option in Phase 1 — keep the menu
                // so the affordance is discoverable when more personas land).
                Menu {
                    ForEach(CoachingPersonaKey.allCases, id: \.self) { p in
                        Button { persona = p } label: {
                            Label(p.displayName, systemImage: persona == p ? "checkmark" : "")
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(persona.displayName).font(.caption)
                        Image(systemName: "chevron.down").font(.caption2)
                    }
                    .foregroundColor(.secondary)
                }

                Spacer()

                if isLoadingBalance {
                    ProgressView().scaleEffect(0.7)
                } else if creditBalance > 0 {
                    Text("\(creditBalance) credit\(creditBalance == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundColor(.secondary)
                } else {
                    Button("Get credits", action: onGetMoreCredits)
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.purple)
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(.secondarySystemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isEnabled ? Color.purple.opacity(0.4) : Color.clear, lineWidth: 1)
        )
        .task {
            // First-launch claim of the free-tier credits, idempotent server-side.
            guard !freeClaimAttempted else { return }
            freeClaimAttempted = true
            await onClaimFreeTier()
        }
    }
}
