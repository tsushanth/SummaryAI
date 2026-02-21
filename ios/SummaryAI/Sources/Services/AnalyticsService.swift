import Foundation
import FirebaseAnalytics

// MARK: - Analytics Event

enum AnalyticsEvent: String {
    // Onboarding
    case onboardingStarted = "onboarding_started"
    case onboardingCompleted = "onboarding_completed"
    case onboardingSkipped = "onboarding_skipped"

    // Authentication
    case signInStarted = "sign_in_started"
    case signInCompleted = "sign_in_completed"
    case signInFailed = "sign_in_failed"
    case signOut = "sign_out"

    // Recording
    case recordingStarted = "recording_started"
    case recordingStopped = "recording_stopped"
    case recordingDeleted = "recording_deleted"
    case recordingViewed = "recording_viewed"

    // Transcription
    case transcriptionStarted = "transcription_started"
    case transcriptionCompleted = "transcription_completed"
    case transcriptionFailed = "transcription_failed"

    // Summary
    case summaryGenerated = "summary_generated"
    case summaryViewed = "summary_viewed"

    // Export
    case exportStarted = "export_started"
    case exportCompleted = "export_completed"
    case exportShared = "export_shared"

    // Subscription
    case paywallViewed = "paywall_viewed"
    case subscriptionStarted = "subscription_started"
    case subscriptionCompleted = "subscription_completed"
    case subscriptionFailed = "subscription_failed"
    case subscriptionRestored = "subscription_restored"
    case trialStarted = "trial_started"

    // Calendar
    case calendarConnected = "calendar_connected"
    case calendarDisconnected = "calendar_disconnected"
    case meetingJoined = "meeting_joined"

    // Phone
    case phoneCallStarted = "phone_call_started"
    case phoneCallEnded = "phone_call_ended"

    // Search
    case searchPerformed = "search_performed"

    // Chat
    case chatQuestionAsked = "chat_question_asked"
}

// MARK: - Analytics Service

final class AnalyticsService {

    // MARK: - Shared Instance

    static let shared = AnalyticsService()

    private init() {}

    // MARK: - Configuration

    /// Configure Firebase Analytics - call this once at app launch
    static func configure() {
        // Firebase auto-initializes from GoogleService-Info.plist
        // Enable analytics collection
        Analytics.setAnalyticsCollectionEnabled(true)

        print("[AnalyticsService] Firebase Analytics configured")
    }

    // MARK: - User Properties

    /// Set the user ID for analytics
    func setUserId(_ userId: String?) {
        Analytics.setUserID(userId)
        print("[AnalyticsService] User ID set: \(userId ?? "nil")")
    }

    /// Set a user property
    func setUserProperty(_ value: String?, forName name: String) {
        Analytics.setUserProperty(value, forName: name)
    }

    /// Set subscription status as user property
    func setSubscriptionStatus(_ isSubscribed: Bool) {
        setUserProperty(isSubscribed ? "premium" : "free", forName: "subscription_status")
    }

    // MARK: - Event Logging

    /// Log an analytics event
    func logEvent(_ event: AnalyticsEvent, parameters: [String: Any]? = nil) {
        Analytics.logEvent(event.rawValue, parameters: parameters)

        #if DEBUG
        print("[AnalyticsService] Event: \(event.rawValue), params: \(parameters ?? [:])")
        #endif
    }

    // MARK: - Screen Tracking

    /// Log a screen view
    func logScreenView(_ screenName: String, screenClass: String? = nil) {
        Analytics.logEvent(AnalyticsEventScreenView, parameters: [
            AnalyticsParameterScreenName: screenName,
            AnalyticsParameterScreenClass: screenClass ?? screenName
        ])

        #if DEBUG
        print("[AnalyticsService] Screen: \(screenName)")
        #endif
    }

    // MARK: - Convenience Methods

    /// Log onboarding events
    func logOnboardingStarted() {
        logEvent(.onboardingStarted)
    }

    func logOnboardingCompleted() {
        logEvent(.onboardingCompleted)
    }

    func logOnboardingSkipped(atPage page: Int) {
        logEvent(.onboardingSkipped, parameters: ["page": page])
    }

    /// Log authentication events
    func logSignInStarted(method: String) {
        logEvent(.signInStarted, parameters: ["method": method])
    }

    func logSignInCompleted(method: String) {
        logEvent(.signInCompleted, parameters: ["method": method])
    }

    func logSignInFailed(method: String, error: String) {
        logEvent(.signInFailed, parameters: ["method": method, "error": error])
    }

    func logSignOut() {
        logEvent(.signOut)
    }

    /// Log recording events
    func logRecordingStarted() {
        logEvent(.recordingStarted)
    }

    func logRecordingStopped(durationSeconds: Int) {
        logEvent(.recordingStopped, parameters: ["duration_seconds": durationSeconds])
    }

    func logRecordingDeleted() {
        logEvent(.recordingDeleted)
    }

    func logRecordingViewed(recordingId: String) {
        logEvent(.recordingViewed, parameters: ["recording_id": recordingId])
    }

    /// Log subscription events
    func logPaywallViewed(source: String = "unknown") {
        logEvent(.paywallViewed, parameters: ["source": source])
    }

    func logSubscriptionStarted(productId: String) {
        logEvent(.subscriptionStarted, parameters: ["product_id": productId])
    }

    func logSubscriptionCompleted(productId: String, price: Double, currency: String) {
        logEvent(.subscriptionCompleted, parameters: [
            "product_id": productId,
            "price": price,
            "currency": currency
        ])

        // Also log standard purchase event for Google Ads attribution
        Analytics.logEvent(AnalyticsEventPurchase, parameters: [
            AnalyticsParameterCurrency: currency,
            AnalyticsParameterValue: price,
            AnalyticsParameterItems: [[
                AnalyticsParameterItemID: productId,
                AnalyticsParameterItemName: productId
            ]]
        ])
    }

    func logSubscriptionFailed(productId: String, error: String) {
        logEvent(.subscriptionFailed, parameters: [
            "product_id": productId,
            "error": error
        ])
    }

    func logSubscriptionRestored() {
        logEvent(.subscriptionRestored)
    }

    func logTrialStarted(productId: String) {
        logEvent(.trialStarted, parameters: ["product_id": productId])
    }

    /// Log export events
    func logExportStarted(format: String) {
        logEvent(.exportStarted, parameters: ["format": format])
    }

    func logExportCompleted(format: String) {
        logEvent(.exportCompleted, parameters: ["format": format])
    }

    func logExportShared(format: String, destination: String) {
        logEvent(.exportShared, parameters: [
            "format": format,
            "destination": destination
        ])
    }

    /// Log calendar events
    func logCalendarConnected(provider: String) {
        logEvent(.calendarConnected, parameters: ["provider": provider])
    }

    func logCalendarDisconnected(provider: String) {
        logEvent(.calendarDisconnected, parameters: ["provider": provider])
    }

    /// Log phone events
    func logPhoneCallStarted() {
        logEvent(.phoneCallStarted)
    }

    func logPhoneCallEnded(durationSeconds: Int) {
        logEvent(.phoneCallEnded, parameters: ["duration_seconds": durationSeconds])
    }

    /// Log search events
    func logSearchPerformed(query: String, resultsCount: Int) {
        logEvent(.searchPerformed, parameters: [
            "search_term": query,
            "results_count": resultsCount
        ])
    }

    /// Log chat events
    func logChatQuestionAsked(recordingId: String) {
        logEvent(.chatQuestionAsked, parameters: ["recording_id": recordingId])
    }
}
