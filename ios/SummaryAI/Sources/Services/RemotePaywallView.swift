import SwiftUI
import PaywallKit
import RevenueCat

/// PaywallKit-powered paywall replacing the RevenueCatUI remote paywall.
struct RemotePaywallView: View {
    @Environment(\.dismiss) private var dismiss
    var triggerSource: String = "unknown"
    @State private var didConvert = false
    @State private var paywallProducts: [PaywallProduct] = []

    @ObservedObject private var subscriptionService = SubscriptionService()

    var body: some View {
        PaywallKit.PaywallView(
            appId: "meetingmind",
            appName: "Meeting Mind Pro",
            features: [
                PaywallFeature(icon: "\u{1F399}", title: "Meeting Recording", description: "Record any meeting"),
                PaywallFeature(icon: "\u{1F4DD}", title: "AI Summaries", description: "Instant meeting notes"),
                PaywallFeature(icon: "\u{2705}", title: "Action Items", description: "Auto-extracted tasks"),
                PaywallFeature(icon: "\u{1F4CA}", title: "Meeting Analytics", description: "Track your meetings"),
                PaywallFeature(icon: "\u{2601}\u{FE0F}", title: "Cloud Sync", description: "Access anywhere")
            ],
            products: paywallProducts,
            theme: PaywallTheme(accent: Color(red: 0.0, green: 0.48, blue: 1.0), accent2: Color(red: 0.5, green: 0.3, blue: 0.9)),
            showWinback: true,
            onPurchase: { productId in
                await purchaseProduct(productId: productId)
            },
            onRestore: {
                await restorePurchases()
            },
            onDismiss: {
                if !didConvert {
                    PaywallCoordinator.shared.trackDismiss()
                }
                dismiss()
            }
        )
        .task {
            await loadProducts()
        }
        .onAppear {
            Purchases.shared.attribution.setAttributes([
                "last_paywall_source": triggerSource,
                "last_paywall_date": ISO8601DateFormatter().string(from: Date())
            ])
            AnalyticsService.shared.logPaywallViewed(source: triggerSource)
        }
    }

    // MARK: - Product Loading

    private func loadProducts() async {
        if subscriptionService.offerings == nil {
            await subscriptionService.loadOfferings()
        }

        let packages = subscriptionService.availablePackages
        paywallProducts = packages.compactMap { pkg -> PaywallProduct? in
            let product = pkg.storeProduct
            let period: PaywallProduct.Period
            switch pkg.packageType {
            case .weekly: period = .weekly
            case .monthly: period = .monthly
            case .annual: period = .yearly
            case .lifetime: period = .lifetime
            default:
                if product.productIdentifier.contains("lifetime") { period = .lifetime }
                else if product.productIdentifier.contains("yearly") || product.productIdentifier.contains("annual") { period = .yearly }
                else if product.productIdentifier.contains("monthly") { period = .monthly }
                else if product.productIdentifier.contains("weekly") { period = .weekly }
                else { return nil }
            }

            var trialDays: Int? = nil
            if let intro = product.introductoryDiscount,
               intro.paymentMode == .freeTrial {
                let sub = intro.subscriptionPeriod
                switch sub.unit {
                case .day: trialDays = sub.value
                case .week: trialDays = sub.value * 7
                case .month: trialDays = sub.value * 30
                case .year: trialDays = sub.value * 365
                @unknown default: trialDays = sub.value
                }
            }

            return PaywallProduct(
                id: product.productIdentifier,
                localizedPrice: product.localizedPriceString,
                price: product.price,
                currencyCode: product.currencyCode ?? "USD",
                trialDays: trialDays,
                period: period
            )
        }
    }

    // MARK: - Purchase

    private func purchaseProduct(productId: String) async {
        let packages = subscriptionService.availablePackages

        guard let package = packages.first(where: {
            $0.storeProduct.productIdentifier == productId
        }) else {
            print("[MeetingMindPaywall] No package found for \(productId)")
            return
        }

        do {
            let success = try await subscriptionService.purchase(package)
            if success {
                didConvert = true
                let price = (package.storeProduct.price as NSDecimalNumber).doubleValue
                let currency = package.storeProduct.currencyCode ?? "USD"
                AnalyticsService.shared.logSubscriptionCompleted(
                    productId: package.storeProduct.productIdentifier,
                    price: price,
                    currency: currency
                )
                await MainActor.run { dismiss() }
            }
        } catch {
            print("[MeetingMindPaywall] Purchase failed: \(error)")
        }
    }

    // MARK: - Restore

    private func restorePurchases() async {
        await subscriptionService.restorePurchases()
        if subscriptionService.subscriptionStatus.isActive {
            didConvert = true
            await MainActor.run { dismiss() }
        }
    }
}
