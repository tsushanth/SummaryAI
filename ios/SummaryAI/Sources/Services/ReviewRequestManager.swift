import Foundation
import StoreKit
import SwiftUI

/// Manages App Store review request timing and conditions
/// Uses a two-step flow: first asks if user enjoys the app, then requests review or collects feedback
@MainActor
final class ReviewRequestManager: ObservableObject {

    // MARK: - Singleton

    static let shared = ReviewRequestManager()

    // MARK: - Published Properties

    /// Whether to show the review prompt
    @Published var showReviewPrompt = false

    // MARK: - Constants

    private enum Constants {
        static let lastReviewRequestDateKey = "lastReviewRequestDate"
        static let successfulRecordingsCountKey = "successfulRecordingsCount"
        static let hasRespondedToPromptKey = "hasRespondedToReviewPrompt"

        /// Minimum days between review prompts
        static let minimumDaysBetweenPrompts = 30

        /// Number of successful recordings before first review prompt
        static let recordingsThreshold = 1

        /// Feedback/contact URL for users who don't enjoy the app
        static let feedbackURL = "https://kreativekoala.llc/contact"
    }

    // MARK: - Properties

    private let userDefaults: UserDefaults

    private var lastReviewRequestDate: Date? {
        get { userDefaults.object(forKey: Constants.lastReviewRequestDateKey) as? Date }
        set { userDefaults.set(newValue, forKey: Constants.lastReviewRequestDateKey) }
    }

    private var successfulRecordingsCount: Int {
        get { userDefaults.integer(forKey: Constants.successfulRecordingsCountKey) }
        set { userDefaults.set(newValue, forKey: Constants.successfulRecordingsCountKey) }
    }

    private var hasRespondedToPrompt: Bool {
        get { userDefaults.bool(forKey: Constants.hasRespondedToPromptKey) }
        set { userDefaults.set(newValue, forKey: Constants.hasRespondedToPromptKey) }
    }

    // MARK: - Initialization

    private init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    // MARK: - Public Methods

    /// Call this when a recording is successfully uploaded
    /// Increments the successful recordings counter and may show the review prompt
    func recordingCompleted() {
        successfulRecordingsCount += 1
        print("[ReviewRequestManager] Recordings completed: \(successfulRecordingsCount)")

        // Show prompt after reaching threshold
        if successfulRecordingsCount == Constants.recordingsThreshold {
            showPromptIfEligible()
        }
    }

    /// Call this after a successful subscription purchase
    /// Satisfied customers are more likely to leave positive reviews
    func purchaseCompleted() {
        print("[ReviewRequestManager] Purchase completed, showing review prompt")
        showPromptIfEligible()
    }

    /// Show the review prompt if all conditions are met
    func showPromptIfEligible() {
        guard canShowPrompt() else {
            print("[ReviewRequestManager] Prompt conditions not met")
            return
        }

        showReviewPrompt = true
        lastReviewRequestDate = Date()
        print("[ReviewRequestManager] Showing review prompt")
    }

    /// User responded positively - show the native App Store review dialog
    func userEnjoyingApp() {
        showReviewPrompt = false
        hasRespondedToPrompt = true
        requestNativeReview()
    }

    /// User responded negatively - open feedback page
    func userNotEnjoyingApp() {
        showReviewPrompt = false
        hasRespondedToPrompt = true
        openFeedbackPage()
    }

    /// User dismissed the prompt without responding
    func promptDismissed() {
        showReviewPrompt = false
        // Don't mark as responded so we can ask again later
        print("[ReviewRequestManager] Prompt dismissed")
    }

    // MARK: - Private Methods

    private func canShowPrompt() -> Bool {
        // Check if enough time has passed since last prompt
        if let lastDate = lastReviewRequestDate {
            let daysSinceLastPrompt = Calendar.current.dateComponents(
                [.day],
                from: lastDate,
                to: Date()
            ).day ?? 0

            if daysSinceLastPrompt < Constants.minimumDaysBetweenPrompts {
                print("[ReviewRequestManager] Only \(daysSinceLastPrompt) days since last prompt, need \(Constants.minimumDaysBetweenPrompts)")
                return false
            }
        }

        return true
    }

    private func requestNativeReview() {
        // Get the current window scene
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }) else {
            print("[ReviewRequestManager] No active window scene found")
            return
        }

        // Request the review using StoreKit
        SKStoreReviewController.requestReview(in: windowScene)
        print("[ReviewRequestManager] Native review requested")
    }

    private func openFeedbackPage() {
        guard let url = URL(string: Constants.feedbackURL) else { return }
        UIApplication.shared.open(url)
        print("[ReviewRequestManager] Opened feedback page")
    }

    // MARK: - Debug/Testing

    #if DEBUG
    /// Reset all tracking data (for testing)
    func resetForTesting() {
        userDefaults.removeObject(forKey: Constants.lastReviewRequestDateKey)
        userDefaults.removeObject(forKey: Constants.successfulRecordingsCountKey)
        userDefaults.removeObject(forKey: Constants.hasRespondedToPromptKey)
        showReviewPrompt = false
        print("[ReviewRequestManager] Reset for testing")
    }

    /// Force show the review prompt (for testing)
    func forceShowPrompt() {
        showReviewPrompt = true
    }
    #endif
}

// MARK: - Review Prompt View

/// A custom in-app prompt asking if the user enjoys the app
/// If yes, shows the native App Store review. If no, collects feedback.
struct ReviewPromptView: View {
    @ObservedObject var reviewManager = ReviewRequestManager.shared

    var body: some View {
        ZStack {
            // Dimmed background
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture {
                    reviewManager.promptDismissed()
                }

            // Prompt card
            VStack(spacing: 24) {
                // Icon
                Image(systemName: "star.fill")
                    .font(.system(size: 48))
                    .foregroundColor(.yellow)

                // Title and message
                VStack(spacing: 8) {
                    Text("Enjoying Meeting Mind?")
                        .font(.title2)
                        .fontWeight(.bold)

                    Text("Your feedback helps us improve the app for everyone.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }

                // Buttons
                VStack(spacing: 12) {
                    Button {
                        reviewManager.userEnjoyingApp()
                    } label: {
                        Text("Yes, I love it!")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.blue)
                            .cornerRadius(12)
                    }

                    Button {
                        reviewManager.userNotEnjoyingApp()
                    } label: {
                        Text("Not really...")
                            .font(.headline)
                            .foregroundColor(.primary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color(.systemGray5))
                            .cornerRadius(12)
                    }

                    Button {
                        reviewManager.promptDismissed()
                    } label: {
                        Text("Ask me later")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 4)
                }
            }
            .padding(24)
            .background(Color(.systemBackground))
            .cornerRadius(20)
            .shadow(radius: 20)
            .padding(.horizontal, 32)
        }
    }
}

// MARK: - View Modifier for Review Prompt

/// A view modifier that overlays the review prompt when needed
struct ReviewPromptModifier: ViewModifier {
    @ObservedObject var reviewManager = ReviewRequestManager.shared

    func body(content: Content) -> some View {
        ZStack {
            content

            if reviewManager.showReviewPrompt {
                ReviewPromptView(reviewManager: reviewManager)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                    .animation(.easeInOut(duration: 0.2), value: reviewManager.showReviewPrompt)
            }
        }
    }
}

extension View {
    /// Adds the review prompt overlay to a view
    func reviewPrompt() -> some View {
        modifier(ReviewPromptModifier())
    }
}

// MARK: - Preview

#if DEBUG
struct ReviewPromptView_Previews: PreviewProvider {
    static var previews: some View {
        ZStack {
            Color.gray.opacity(0.3)
                .ignoresSafeArea()

            ReviewPromptView()
        }
    }
}
#endif
