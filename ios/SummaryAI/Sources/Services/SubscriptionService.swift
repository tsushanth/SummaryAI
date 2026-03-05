import Foundation
import RevenueCat

// MARK: - Subscription Status

enum SubscriptionStatus: Equatable {
    case unknown
    case notSubscribed
    case subscribed(expirationDate: Date?, productId: String)
    case inTrial(expirationDate: Date)

    var isActive: Bool {
        switch self {
        case .subscribed, .inTrial:
            return true
        case .unknown, .notSubscribed:
            return false
        }
    }

    var isPremium: Bool {
        isActive
    }
}

// MARK: - Subscription Service

@MainActor
final class SubscriptionService: ObservableObject {

    // MARK: - Published Properties

    @Published var offerings: Offerings?
    @Published var customerInfo: CustomerInfo?
    @Published var subscriptionStatus: SubscriptionStatus = .unknown
    @Published var isLoading = false
    @Published var errorMessage: String?

    // MARK: - Constants

    private let entitlementID = "premium"

    // MARK: - Configuration

    /// Configure RevenueCat - call this once at app launch
    /// Replace YOUR_REVENUECAT_IOS_API_KEY with your actual API key from RevenueCat dashboard
    static func configure() {
        #if DEBUG
        Purchases.logLevel = .debug
        #else
        Purchases.logLevel = .warn
        #endif

        Purchases.configure(withAPIKey: "appl_oaxBhvTWrxFWthyVWQKKcfVVoLF")

        // Enable automatic Apple Search Ads attribution collection
        Purchases.shared.attribution.enableAdServicesAttributionTokenCollection()

        // Set customer attributes for segmentation
        Purchases.shared.attribution.setAttributes([
            "$appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "app_name": "MeetingMind",
            "platform": "ios"
        ])

        print("[SubscriptionService] RevenueCat configured")
    }

    // MARK: - Initialization

    init() {
        Task {
            await loadOfferings()
            await updateSubscriptionStatus()
        }
    }

    // MARK: - Load Offerings

    func loadOfferings() async {
        isLoading = true
        defer { isLoading = false }

        do {
            offerings = try await Purchases.shared.offerings()
            print("[SubscriptionService] Loaded offerings: \(offerings?.current?.availablePackages.count ?? 0) packages")
        } catch {
            print("[SubscriptionService] Failed to load offerings: \(error)")
            errorMessage = "Failed to load subscription options"
        }
    }

    // MARK: - Purchase

    func purchase(_ package: Package) async throws -> Bool {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await Purchases.shared.purchase(package: package)
            customerInfo = result.customerInfo

            await updateSubscriptionStatus()

            if !result.userCancelled {
                print("[SubscriptionService] Purchase successful: \(package.storeProduct.productIdentifier)")
                // Request app review after successful purchase
                ReviewRequestManager.shared.purchaseCompleted()
                return true
            }

            print("[SubscriptionService] User cancelled purchase")
            return false

        } catch {
            print("[SubscriptionService] Purchase failed: \(error)")
            errorMessage = "Purchase failed. Please try again."
            throw error
        }
    }

    // MARK: - Restore Purchases

    func restorePurchases() async {
        isLoading = true
        defer { isLoading = false }

        do {
            customerInfo = try await Purchases.shared.restorePurchases()
            await updateSubscriptionStatus()
            print("[SubscriptionService] Purchases restored")
            if subscriptionStatus.isActive {
                AnalyticsService.shared.logSubscriptionRestored()
                AnalyticsService.shared.setSubscriptionStatus(true)
            }
        } catch {
            print("[SubscriptionService] Failed to restore purchases: \(error)")
            errorMessage = "Failed to restore purchases"
        }
    }

    // MARK: - Update Subscription Status

    func updateSubscriptionStatus() async {
        do {
            customerInfo = try await Purchases.shared.customerInfo()

            guard let info = customerInfo else {
                subscriptionStatus = .unknown
                return
            }

            // Check if user has active premium entitlement
            if let entitlement = info.entitlements[entitlementID], entitlement.isActive {
                let expirationDate = entitlement.expirationDate
                let productId = entitlement.productIdentifier

                // Check if in trial period
                if entitlement.periodType == .trial {
                    subscriptionStatus = .inTrial(expirationDate: expirationDate ?? Date())
                } else {
                    subscriptionStatus = .subscribed(
                        expirationDate: expirationDate,
                        productId: productId
                    )
                }
            } else {
                subscriptionStatus = .notSubscribed
            }

            print("[SubscriptionService] Status updated: \(subscriptionStatus)")
        } catch {
            print("[SubscriptionService] Failed to get customer info: \(error)")
            subscriptionStatus = .unknown
        }
    }

    // MARK: - User Identification

    /// Link the RevenueCat user with your backend user ID
    /// Call this after successful authentication
    func loginUser(userId: String) async {
        do {
            let (customerInfo, _) = try await Purchases.shared.logIn(userId)
            self.customerInfo = customerInfo
            await updateSubscriptionStatus()
            print("[SubscriptionService] Logged in user: \(userId)")
        } catch {
            print("[SubscriptionService] Failed to login user: \(error)")
        }
    }

    /// Log out the current user (resets to anonymous)
    func logoutUser() async {
        do {
            customerInfo = try await Purchases.shared.logOut()
            await updateSubscriptionStatus()
            print("[SubscriptionService] User logged out")
        } catch {
            print("[SubscriptionService] Failed to logout: \(error)")
        }
    }

    // MARK: - Helper Properties

    /// Get the current offering's packages
    var availablePackages: [Package] {
        offerings?.current?.availablePackages ?? []
    }

    /// Get yearly package from current offering
    var yearlyPackage: Package? {
        offerings?.current?.annual
    }

    /// Get monthly package from current offering
    var monthlyPackage: Package? {
        offerings?.current?.monthly
    }

    /// Get weekly package from current offering
    var weeklyPackage: Package? {
        offerings?.current?.weekly
    }

    /// Calculate savings percentage for yearly vs monthly
    var yearlySavingsPercentage: Int? {
        guard let yearly = yearlyPackage?.storeProduct,
              let monthly = monthlyPackage?.storeProduct else { return nil }

        let yearlyPrice = yearly.price as Decimal
        let monthlyAnnualPrice = (monthly.price as Decimal) * 12
        let savings = (monthlyAnnualPrice - yearlyPrice) / monthlyAnnualPrice * 100

        return Int(NSDecimalNumber(decimal: savings).doubleValue.rounded())
    }
}
