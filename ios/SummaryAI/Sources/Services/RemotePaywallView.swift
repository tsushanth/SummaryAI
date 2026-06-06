import SwiftUI
import PaywallKit
import RatingKit

/// PaywallKit-powered paywall with StoreKit 2 purchases.
struct RemotePaywallView: View {
    @Environment(\.dismiss) private var dismiss
    var triggerSource: String = "unknown"
    @State private var didPurchaseOrRestore = false
    @ObservedObject private var store = StoreManager.shared

    private var placement: String {
        PromoCodeManager.shared.activeCode != nil ? "promo_code_onboarding" : "app_open"
    }

    var body: some View {
        PaywallKit.PaywallView(
            appId: "meetingmind",
            placement: placement,
            appName: "Meeting Mind Pro",
            features: [
                PaywallFeature(icon: "\u{1F399}", title: "Meeting Recording", description: "Record any meeting"),
                PaywallFeature(icon: "\u{1F4DD}", title: "AI Summaries", description: "Instant meeting notes"),
                PaywallFeature(icon: "\u{2705}", title: "Action Items", description: "Auto-extracted tasks"),
                PaywallFeature(icon: "\u{1F4CA}", title: "Meeting Analytics", description: "Track your meetings"),
                PaywallFeature(icon: "\u{2601}\u{FE0F}", title: "Cloud Sync", description: "Access anywhere")
            ],
            products: store.paywallProducts,
            theme: PaywallTheme(accent: Color(red: 0.0, green: 0.48, blue: 1.0), accent2: Color(red: 0.5, green: 0.3, blue: 0.9)),
            showWinback: false,
            onPurchase: { productId in
                let result = await store.purchase(productId: productId)
                if case .purchased = result {
                    didPurchaseOrRestore = true
                    await PremiumManager.shared.validateSubscriptionState()
                    // Log purchase to Facebook with actual price
                    let product = store.paywallProducts.first { $0.id == productId }
                    let price = Double(truncating: (product?.price ?? 0) as NSDecimalNumber)
                    let currency = product?.currencyCode ?? "USD"
                    FacebookSDKHelper.shared.logSubscription(price: price, currency: currency, productId: productId)
                    if product?.trialDays != nil {
                        FacebookSDKHelper.shared.logTrialStarted(productId: productId)
                    }
                    await MainActor.run {
                        RatingKit.shared.trackPurchase()
                        dismiss()
                    }
                    return true
                }
                return false
            },
            onRestore: {
                await store.restore()
                await PremiumManager.shared.validateSubscriptionState()
                if PremiumManager.shared.isPremium {
                    didPurchaseOrRestore = true
                    await MainActor.run { dismiss() }
                }
            },
            onDismiss: {
                if !didPurchaseOrRestore {
                    PaywallCoordinator.shared.trackDismiss()
                }
                dismiss()
            }
        )
        .task {
            if store.paywallProducts.isEmpty {
                await store.loadProducts()
            }
        }
        .onAppear {
            AnalyticsService.shared.logPaywallViewed(source: triggerSource)
        }
    }
}
