import SwiftUI
import RevenueCatUI
import RevenueCat

/// Remote paywall powered by RevenueCatUI — design & pricing controlled from RC dashboard.
/// Close button is part of the RC paywall template design.
struct RemotePaywallView: View {
    @Environment(\.dismiss) private var dismiss
    var triggerSource: String = "unknown"

    var body: some View {
        PaywallView(displayCloseButton: true)
            .onPurchaseCompleted { customerInfo in
                AnalyticsService.shared.logSubscriptionCompleted(
                    productId: customerInfo.activeSubscriptions.first ?? "unknown",
                    price: 0,
                    currency: ""
                )
                dismiss()
            }
            .onRestoreCompleted { customerInfo in
                if customerInfo.entitlements["premium"]?.isActive == true {
                    dismiss()
                }
            }
            .onAppear {
                AnalyticsService.shared.logPaywallViewed(source: triggerSource)
                Purchases.shared.attribution.setAttributes([
                    "last_paywall_source": triggerSource,
                    "last_paywall_date": ISO8601DateFormatter().string(from: Date())
                ])
            }
    }
}
