import Foundation
import StoreKit

// MARK: - Subscription Product IDs

enum SubscriptionProductID: String, CaseIterable {
    case yearly = "com.summaryai.subscription.yearly"
    case monthly = "com.summaryai.subscription.monthly"
    case weekly = "com.summaryai.subscription.weekly"

    var displayName: String {
        switch self {
        case .yearly: return "Yearly"
        case .monthly: return "Monthly"
        case .weekly: return "Weekly"
        }
    }
}

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

    @Published var products: [Product] = []
    @Published var purchasedProductIDs: Set<String> = []
    @Published var subscriptionStatus: SubscriptionStatus = .unknown
    @Published var isLoading = false
    @Published var errorMessage: String?

    // MARK: - Properties

    private var updateListenerTask: Task<Void, Error>?
    private let productIDs = SubscriptionProductID.allCases.map { $0.rawValue }

    // MARK: - Initialization

    init() {
        updateListenerTask = listenForTransactions()
        Task {
            await loadProducts()
            await updateSubscriptionStatus()
        }
    }

    deinit {
        updateListenerTask?.cancel()
    }

    // MARK: - Load Products

    func loadProducts() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let storeProducts = try await Product.products(for: productIDs)
            products = storeProducts.sorted { product1, product2 in
                // Sort by duration: yearly first, then monthly, then weekly
                let order = [SubscriptionProductID.yearly.rawValue,
                            SubscriptionProductID.monthly.rawValue,
                            SubscriptionProductID.weekly.rawValue]
                let index1 = order.firstIndex(of: product1.id) ?? 0
                let index2 = order.firstIndex(of: product2.id) ?? 0
                return index1 < index2
            }
            print("[SubscriptionService] Loaded \(products.count) products")
        } catch {
            print("[SubscriptionService] Failed to load products: \(error)")
            errorMessage = "Failed to load subscription options"
        }
    }

    // MARK: - Purchase

    func purchase(_ product: Product) async throws -> Bool {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await product.purchase()

            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                await updateSubscriptionStatus()
                await transaction.finish()
                print("[SubscriptionService] Purchase successful: \(product.id)")
                return true

            case .userCancelled:
                print("[SubscriptionService] User cancelled purchase")
                return false

            case .pending:
                print("[SubscriptionService] Purchase pending")
                return false

            @unknown default:
                return false
            }
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
            try await AppStore.sync()
            await updateSubscriptionStatus()
            print("[SubscriptionService] Purchases restored")
        } catch {
            print("[SubscriptionService] Failed to restore purchases: \(error)")
            errorMessage = "Failed to restore purchases"
        }
    }

    // MARK: - Update Subscription Status

    func updateSubscriptionStatus() async {
        var foundActiveSubscription = false

        for await result in Transaction.currentEntitlements {
            do {
                let transaction = try checkVerified(result)

                if transaction.productType == .autoRenewable {
                    purchasedProductIDs.insert(transaction.productID)

                    // Check if in trial period
                    if let offerType = transaction.offerType, offerType == .introductory {
                        subscriptionStatus = .inTrial(expirationDate: transaction.expirationDate ?? Date())
                    } else {
                        subscriptionStatus = .subscribed(
                            expirationDate: transaction.expirationDate,
                            productId: transaction.productID
                        )
                    }
                    foundActiveSubscription = true
                }
            } catch {
                print("[SubscriptionService] Failed to verify transaction: \(error)")
            }
        }

        if !foundActiveSubscription {
            subscriptionStatus = .notSubscribed
            purchasedProductIDs.removeAll()
        }

        print("[SubscriptionService] Status updated: \(subscriptionStatus)")
    }

    // MARK: - Listen for Transactions

    private func listenForTransactions() -> Task<Void, Error> {
        return Task.detached { [weak self] in
            for await result in Transaction.updates {
                do {
                    let transaction = try await self?.checkVerifiedAsync(result)
                    if let transaction = transaction {
                        await self?.updateSubscriptionStatus()
                        await transaction.finish()
                    }
                } catch {
                    print("[SubscriptionService] Transaction verification failed: \(error)")
                }
            }
        }
    }

    // Non-isolated version for detached tasks
    private nonisolated func checkVerifiedAsync<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw StoreError.verificationFailed
        case .verified(let safe):
            return safe
        }
    }

    // MARK: - Verify Transaction

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw StoreError.verificationFailed
        case .verified(let safe):
            return safe
        }
    }

    // MARK: - Helper Methods

    func product(for id: SubscriptionProductID) -> Product? {
        products.first { $0.id == id.rawValue }
    }

    var yearlyProduct: Product? {
        product(for: .yearly)
    }

    var monthlyProduct: Product? {
        product(for: .monthly)
    }

    var weeklyProduct: Product? {
        product(for: .weekly)
    }

    /// Calculate savings percentage for yearly vs monthly
    var yearlySavingsPercentage: Int? {
        guard let yearly = yearlyProduct,
              let monthly = monthlyProduct else { return nil }

        let yearlyPrice = NSDecimalNumber(decimal: yearly.price).doubleValue
        let monthlyAnnualPrice = NSDecimalNumber(decimal: monthly.price).doubleValue * 12
        let savings = (monthlyAnnualPrice - yearlyPrice) / monthlyAnnualPrice * 100

        return Int(savings.rounded())
    }
}

// MARK: - Store Error

enum StoreError: Error {
    case verificationFailed
    case purchaseFailed
    case unknown
}
