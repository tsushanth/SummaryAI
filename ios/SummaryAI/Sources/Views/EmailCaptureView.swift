import SwiftUI
import PaywallKit

/// Email capture screen shown at the end of onboarding, before the notification
/// prompt and any paywall. Framed as "save your progress + get tips" rather
/// than "give us your email for the trial" — pattern gets meaningfully higher
/// opt-in rates.
///
/// Captured email is persisted via `PaywallManager.shared.userEmail` so all
/// subsequent paywall events automatically carry it for non-converter drip
/// campaigns and paid retargeting (Meta / TikTok Custom Audiences).
struct EmailCaptureView: View {
    let onContinue: () -> Void

    @State private var email: String = ""
    @State private var isSubmitting: Bool = false
    @FocusState private var emailFieldFocused: Bool

    private var isValidEmail: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.contains("@") && trimmed.contains(".") && trimmed.count >= 5
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Icon
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [.blue, .cyan],
                                         startPoint: .topLeading,
                                         endPoint: .bottomTrailing))
                    .frame(width: 96, height: 96)
                    .shadow(color: .blue.opacity(0.3), radius: 16, y: 8)
                Image(systemName: "envelope.fill")
                    .font(.system(size: 38, weight: .medium))
                    .foregroundColor(.white)
            }
            .padding(.bottom, 32)

            // Headline
            Text("Save your progress")
                .font(.system(size: 32, weight: .bold))
                .multilineTextAlignment(.center)

            Text("Drop your email so your recordings sync across devices and we can send you the occasional tip.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 12)

            // Field
            VStack(alignment: .leading, spacing: 8) {
                TextField("you@email.com", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .focused($emailFieldFocused)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(12)
            }
            .padding(.horizontal, 24)
            .padding(.top, 32)

            Spacer()

            VStack(spacing: 16) {
                Button(action: submit) {
                    HStack {
                        if isSubmitting {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(.white)
                        } else {
                            Text("Continue")
                                .fontWeight(.semibold)
                            Image(systemName: "arrow.right")
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(
                        LinearGradient(
                            colors: isValidEmail ? [.blue, .blue.opacity(0.8)] : [.gray.opacity(0.4), .gray.opacity(0.3)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .foregroundColor(.white)
                    .cornerRadius(16)
                }
                .disabled(!isValidEmail || isSubmitting)
                .padding(.horizontal, 24)

                Button("Skip for now") {
                    onContinue()
                }
                .foregroundColor(.secondary)
                .font(.subheadline)
            }
            .padding(.bottom, 40)
        }
        .background(Color(.systemBackground))
        .onAppear {
            // Slight delay so the focus animation doesn't fight the screen
            // presentation animation.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                emailFieldFocused = true
            }
        }
    }

    private func submit() {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard isValidEmail else { return }
        isSubmitting = true
        // Persist immediately so any subsequent paywall event auto-attaches.
        PaywallManager.shared.userEmail = trimmed
        // Also fire an explicit "email_captured" event so the server has a
        // single row to anchor non-converter drip timing from.
        PaywallManager.shared.trackEvent(
            appId: "meetingmind",
            placement: "onboarding",
            templateId: "email_capture",
            event: "email_captured",
            email: trimmed
        )
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            onContinue()
        }
    }
}

#if DEBUG
struct EmailCaptureView_Previews: PreviewProvider {
    static var previews: some View {
        EmailCaptureView(onContinue: {})
    }
}
#endif
