import Foundation
import PaywallKit

// MARK: - Product Identifiers

/// Product identifiers for Meeting Mind in-app purchases
enum ProductID: String, CaseIterable {
    case weekly = "com.summaryai.subscription.weekly"
    case monthly = "com.summaryai.subscription.monthly"
    case yearly = "com.summaryai.subscription.yearly1"

    static var subscriptionIDs: [String] {
        [weekly.rawValue, monthly.rawValue, yearly.rawValue]
    }

    static var allIDs: [String] {
        allCases.map(\.rawValue)
    }
}

// MARK: - Premium Manager

/// Manager for premium feature access and subscription state via StoreKit 2
@MainActor
@Observable
final class PremiumManager {

    // MARK: - Singleton

    static let shared = PremiumManager()

    // MARK: - Properties

    /// Whether user has any premium access
    private(set) var isPremium: Bool = false

    /// Whether user has lifetime access
    private(set) var isLifetime: Bool = false

    /// Subscription expiration date (nil for lifetime or free)
    private(set) var subscriptionExpirationDate: Date?

    private let store = StoreManager.shared

    // MARK: - UserDefaults Keys

    private enum UserDefaultsKey {
        static let isPremium = "com.meetingmind.subscription.isPremium"
        static let subscriptionExpiration = "com.meetingmind.subscription.expiration"
        static let lastValidationDate = "com.meetingmind.validation.date"
    }

    // MARK: - Initialization

    private init() {
        loadPersistedState()
    }

    // MARK: - Public Methods

    /// Validate and update subscription state via StoreKit 2
    func validateSubscriptionState() async {
        await store.refreshSubscriptionStatus()

        if store.isLifetime {
            isPremium = true
            isLifetime = true
        } else if store.isPremium {
            isPremium = true
            isLifetime = false
        } else {
            isPremium = false
            isLifetime = false
        }
        subscriptionExpirationDate = store.subscriptionExpirationDate

        persistState()
    }

    /// Check if subscription is expiring soon (within 3 days)
    func isSubscriptionExpiringSoon() -> Bool {
        guard let expirationDate = subscriptionExpirationDate else { return false }
        let threeDaysFromNow = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
        return expirationDate < threeDaysFromNow && expirationDate > Date()
    }

    /// Get remaining days of subscription
    func remainingSubscriptionDays() -> Int? {
        guard let expirationDate = subscriptionExpirationDate else { return nil }
        let calendar = Calendar.current
        let components = calendar.dateComponents([.day], from: Date(), to: expirationDate)
        return components.day
    }

    // MARK: - Private Methods

    private func loadPersistedState() {
        let defaults = UserDefaults.standard
        isPremium = defaults.bool(forKey: UserDefaultsKey.isPremium)

        if let expirationInterval = defaults.object(forKey: UserDefaultsKey.subscriptionExpiration) as? TimeInterval {
            let expirationDate = Date(timeIntervalSince1970: expirationInterval)
            if expirationDate > Date() {
                subscriptionExpirationDate = expirationDate
            } else if !isLifetime {
                isPremium = false
            }
        }
    }

    private func persistState() {
        let defaults = UserDefaults.standard
        defaults.set(isPremium, forKey: UserDefaultsKey.isPremium)

        if let expirationDate = subscriptionExpirationDate {
            defaults.set(expirationDate.timeIntervalSince1970, forKey: UserDefaultsKey.subscriptionExpiration)
        } else {
            defaults.removeObject(forKey: UserDefaultsKey.subscriptionExpiration)
        }

        defaults.set(Date().timeIntervalSince1970, forKey: UserDefaultsKey.lastValidationDate)
    }
}
