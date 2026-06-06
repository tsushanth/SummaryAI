//
//  PaywallCoordinator.swift
//  SummaryAI (Meeting Mind)
//
//  Tracks paywall dismissals and triggers winback offer
//  after multiple dismissals with a cooldown period.
//

import SwiftUI
import Combine
import PaywallKit

@MainActor
final class PaywallCoordinator: ObservableObject {

    // MARK: - Singleton

    static let shared = PaywallCoordinator()

    // MARK: - Published

    @Published var showWinbackOffer = false

    // MARK: - UserDefaults Keys

    private let dismissCountKey = "meetingmind_paywall_dismiss_count"
    private let lastDismissDateKey = "meetingmind_paywall_last_dismiss_date"
    private let lastWinbackShownDateKey = "meetingmind_winback_last_shown_date"

    // MARK: - Thresholds

    /// Number of paywall dismissals before showing winback
    private let dismissThreshold = 3
    /// Minimum seconds between last dismiss and winback eligibility (1 day)
    private let cooldownInterval: TimeInterval = 86_400
    /// Minimum seconds between winback presentations (1 day)
    private let winbackCooldown: TimeInterval = 86_400

    // MARK: - Init

    private init() {}

    // MARK: - Dismiss Count

    var paywallDismissCount: Int {
        get { UserDefaults.standard.integer(forKey: dismissCountKey) }
        set { UserDefaults.standard.set(newValue, forKey: dismissCountKey) }
    }

    private var lastDismissDate: Date? {
        get { UserDefaults.standard.object(forKey: lastDismissDateKey) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: lastDismissDateKey) }
    }

    private var lastWinbackShownDate: Date? {
        get { UserDefaults.standard.object(forKey: lastWinbackShownDateKey) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: lastWinbackShownDateKey) }
    }

    // MARK: - Public Methods

    /// Call this every time the user dismisses a paywall without purchasing.
    func trackDismiss() {
        paywallDismissCount += 1
        lastDismissDate = Date()
        print("[PaywallCoordinator] Dismiss tracked. Count: \(paywallDismissCount)")
    }

    /// Call on app foreground / onAppear to evaluate whether
    /// a winback offer should be shown.
    func checkWinbackEligibility() {
        // Already subscribed -- skip
        if PremiumManager.shared.isPremium { return }

        // Server kill-switch (defaults to false; flip via paywall_placements.experiment.showWinback)
        guard ExperimentManager.shared.showWinback() else {
            print("[PaywallCoordinator] Winback disabled by server")
            return
        }

        // Not enough dismissals
        guard paywallDismissCount >= dismissThreshold else { return }

        // Cooldown since last paywall dismiss (user should have been away for a day)
        if let lastDismiss = lastDismissDate,
           Date().timeIntervalSince(lastDismiss) < cooldownInterval {
            return
        }

        // Don't show winback more than once per day
        if let lastShown = lastWinbackShownDate,
           Date().timeIntervalSince(lastShown) < winbackCooldown {
            return
        }

        // Eligible -- show winback
        lastWinbackShownDate = Date()
        showWinbackOffer = true
        print("[PaywallCoordinator] Winback offer triggered")
    }
}
