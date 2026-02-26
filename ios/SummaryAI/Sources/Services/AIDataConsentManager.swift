//
//  AIDataConsentManager.swift
//  SummaryAI
//
//  Manages user consent for AI data sharing with third-party services
//

import Foundation
import SwiftUI

@MainActor
class AIDataConsentManager: ObservableObject {
    static let shared = AIDataConsentManager()

    // MARK: - Published Properties
    @Published private(set) var hasConsented: Bool
    @Published private(set) var consentDate: Date?

    // MARK: - Keys
    private let hasConsentedKey = "aiDataConsentGranted"
    private let consentDateKey = "aiDataConsentDate"
    private let consentVersionKey = "aiDataConsentVersion"

    /// Current consent version — increment when adding new third-party services
    private let currentConsentVersion = 1

    // MARK: - Computed Properties

    /// Whether the user needs to see the consent screen
    var needsConsent: Bool {
        if !hasConsented { return true }
        let savedVersion = UserDefaults.standard.integer(forKey: consentVersionKey)
        return savedVersion < currentConsentVersion
    }

    // MARK: - Init

    private init() {
        self.hasConsented = UserDefaults.standard.bool(forKey: hasConsentedKey)
        if let date = UserDefaults.standard.object(forKey: consentDateKey) as? Date {
            self.consentDate = date
        }
    }

    // MARK: - Actions

    func grantConsent() {
        hasConsented = true
        consentDate = Date()
        UserDefaults.standard.set(true, forKey: hasConsentedKey)
        UserDefaults.standard.set(Date(), forKey: consentDateKey)
        UserDefaults.standard.set(currentConsentVersion, forKey: consentVersionKey)
    }

    func revokeConsent() {
        hasConsented = false
        consentDate = nil
        UserDefaults.standard.set(false, forKey: hasConsentedKey)
        UserDefaults.standard.removeObject(forKey: consentDateKey)
        UserDefaults.standard.removeObject(forKey: consentVersionKey)
    }
}
