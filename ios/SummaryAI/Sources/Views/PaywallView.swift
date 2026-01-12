import SwiftUI
import StoreKit

// MARK: - Paywall View

/// Subscription paywall shown after onboarding
struct PaywallView: View {
    @ObservedObject var subscriptionService: SubscriptionService
    @Binding var hasCompletedPaywall: Bool
    @State private var selectedProduct: Product?
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                headerSection

                // Features list
                featuresSection

                // Subscription options
                subscriptionOptionsSection

                // Free trial info
                trialInfoSection

                // Start trial button
                startTrialButton

                // Restore purchases
                restorePurchasesButton

                // Terms and privacy
                legalSection

                Spacer(minLength: 40)
            }
            .padding(.top, 20)
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(spacing: 16) {
            // Close button (top right)
            HStack {
                Spacer()
                Button {
                    hasCompletedPaywall = true
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundColor(.secondary.opacity(0.6))
                }
                .padding(.trailing, 20)
            }

            // App icon
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 80, height: 80)
                    .shadow(color: .blue.opacity(0.3), radius: 10, y: 5)

                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 40))
                    .foregroundColor(.white)
            }

            VStack(spacing: 8) {
                Text("Unlock Meeting Mind")
                    .font(.title)
                    .fontWeight(.bold)

                Text("Try free for 7 days")
                    .font(.title3)
                    .foregroundColor(.blue)
                    .fontWeight(.medium)
            }
        }
    }

    // MARK: - Features Section

    private var featuresSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            featureRow(icon: "waveform", color: .blue, title: "Unlimited Recordings", subtitle: "Record meetings, lectures, and more")
            featureRow(icon: "doc.text.fill", color: .purple, title: "AI Summaries", subtitle: "Get instant notes and action items")
            featureRow(icon: "video.fill", color: .green, title: "Meeting Bot", subtitle: "Auto-join Zoom, Teams, and Meet")
            featureRow(icon: "bubble.left.and.bubble.right.fill", color: .orange, title: "Ask Questions", subtitle: "Chat with your recordings")
        }
        .padding(.horizontal, 24)
    }

    private func featureRow(icon: String, color: Color, title: String, subtitle: String) -> some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(color.opacity(0.15))
                    .frame(width: 44, height: 44)

                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundColor(color)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
        }
    }

    // MARK: - Subscription Options Section

    private var subscriptionOptionsSection: some View {
        VStack(spacing: 12) {
            // Yearly (recommended)
            if let yearly = subscriptionService.yearlyProduct {
                SubscriptionOptionCard(
                    product: yearly,
                    isSelected: selectedProduct?.id == yearly.id,
                    isRecommended: true,
                    savingsText: subscriptionService.yearlySavingsPercentage.map { "Save \($0)%" },
                    hasTrial: true
                ) {
                    selectedProduct = yearly
                }
            }

            // Monthly
            if let monthly = subscriptionService.monthlyProduct {
                SubscriptionOptionCard(
                    product: monthly,
                    isSelected: selectedProduct?.id == monthly.id,
                    isRecommended: false,
                    savingsText: nil,
                    hasTrial: false
                ) {
                    selectedProduct = monthly
                }
            }

            // Weekly
            if let weekly = subscriptionService.weeklyProduct {
                SubscriptionOptionCard(
                    product: weekly,
                    isSelected: selectedProduct?.id == weekly.id,
                    isRecommended: false,
                    savingsText: nil,
                    hasTrial: false
                ) {
                    selectedProduct = weekly
                }
            }
        }
        .padding(.horizontal)
        .onAppear {
            // Default to yearly selection
            if selectedProduct == nil {
                selectedProduct = subscriptionService.yearlyProduct
            }
        }
    }

    // MARK: - Trial Info Section

    private var trialInfoSection: some View {
        VStack(spacing: 8) {
            if selectedProduct?.id == SubscriptionProductID.yearly.rawValue {
                HStack(spacing: 6) {
                    Image(systemName: "gift.fill")
                        .foregroundColor(.blue)
                    Text("7-day free trial included")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
                .foregroundColor(.blue)

                Text("Cancel anytime during trial. No charge until trial ends.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Start Trial Button

    private var startTrialButton: some View {
        Button {
            if selectedProduct != nil {
                Task {
                    await purchaseSelectedProduct()
                }
            } else {
                // No products loaded (simulator/testing) - just dismiss
                hasCompletedPaywall = true
                dismiss()
            }
        } label: {
            HStack(spacing: 8) {
                if isPurchasing {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(0.9)
                }

                Text(buttonTitle)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(
                LinearGradient(
                    colors: [.blue, .purple],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .foregroundColor(.white)
            .cornerRadius(16)
        }
        .disabled(isPurchasing)
        .padding(.horizontal)
    }

    private var buttonTitle: String {
        guard let product = selectedProduct else {
            return "Continue"
        }

        if product.id == SubscriptionProductID.yearly.rawValue {
            return "Start Free Trial"
        } else {
            return "Subscribe for \(product.displayPrice)/\(periodLabel(for: product))"
        }
    }

    private func periodLabel(for product: Product) -> String {
        switch product.id {
        case SubscriptionProductID.yearly.rawValue: return "year"
        case SubscriptionProductID.monthly.rawValue: return "month"
        case SubscriptionProductID.weekly.rawValue: return "week"
        default: return "period"
        }
    }

    // MARK: - Restore Purchases Button

    private var restorePurchasesButton: some View {
        Button {
            Task {
                await subscriptionService.restorePurchases()
                if subscriptionService.subscriptionStatus.isActive {
                    hasCompletedPaywall = true
                }
            }
        } label: {
            Text("Restore Purchases")
                .font(.subheadline)
                .foregroundColor(.blue)
        }
    }

    // MARK: - Legal Section

    private var legalSection: some View {
        VStack(spacing: 8) {
            Text("Payment will be charged to your Apple ID account at confirmation of purchase. Subscription automatically renews unless canceled at least 24 hours before the end of the current period. Your account will be charged for renewal within 24 hours prior to the end of the current period. You can manage and cancel your subscriptions by going to Settings > Apple ID > Subscriptions.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 16) {
                Link("Terms of Use", destination: URL(string: "https://kreativekoala.llc/terms")!)
                    .font(.caption)

                Text("|")
                    .foregroundColor(.secondary)

                Link("Privacy Policy", destination: URL(string: "https://kreativekoala.llc/privacy")!)
                    .font(.caption)
            }
        }
        .padding(.horizontal, 24)
    }

    // MARK: - Purchase

    private func purchaseSelectedProduct() async {
        guard let product = selectedProduct else { return }

        isPurchasing = true
        defer { isPurchasing = false }

        do {
            let success = try await subscriptionService.purchase(product)
            if success {
                hasCompletedPaywall = true
                dismiss()
            }
        } catch {
            errorMessage = "Purchase failed. Please try again."
            showError = true
        }
    }
}

// MARK: - Subscription Option Card

struct SubscriptionOptionCard: View {
    let product: Product
    let isSelected: Bool
    let isRecommended: Bool
    let savingsText: String?
    let hasTrial: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                // Selection indicator
                ZStack {
                    Circle()
                        .stroke(isSelected ? Color.blue : Color.gray.opacity(0.3), lineWidth: 2)
                        .frame(width: 24, height: 24)

                    if isSelected {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 14, height: 14)
                    }
                }

                // Plan details
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(planName)
                            .font(.headline)
                            .foregroundColor(.primary)

                        if isRecommended {
                            Text("Best Value")
                                .font(.caption2)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(
                                    LinearGradient(
                                        colors: [.blue, .purple],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .cornerRadius(4)
                        }
                    }

                    // Show full period price below plan name
                    Text(fullPeriodPrice)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if hasTrial {
                        Text("7 days free trial")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }
                }

                Spacer()

                // Price - billed amount must be most prominent per App Store guidelines
                VStack(alignment: .trailing, spacing: 2) {
                    Text(product.displayPrice)
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundColor(.primary)

                    Text(periodSuffix)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if product.id != SubscriptionProductID.weekly.rawValue {
                        Text(perWeekPrice + "/wk")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    if let savings = savingsText {
                        Text(savings)
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundColor(.green)
                    }
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(.secondarySystemBackground))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isSelected ? Color.blue : Color.clear, lineWidth: 2)
                    )
            )
        }
        .buttonStyle(PlainButtonStyle())
    }

    private var planName: String {
        switch product.id {
        case SubscriptionProductID.yearly.rawValue: return "Yearly"
        case SubscriptionProductID.monthly.rawValue: return "Monthly"
        case SubscriptionProductID.weekly.rawValue: return "Weekly"
        default: return product.displayName
        }
    }

    private var fullPeriodPrice: String {
        switch product.id {
        case SubscriptionProductID.yearly.rawValue:
            return "\(product.displayPrice)/year"
        case SubscriptionProductID.monthly.rawValue:
            return "\(product.displayPrice)/month"
        case SubscriptionProductID.weekly.rawValue:
            return "\(product.displayPrice)/week"
        default:
            return product.displayPrice
        }
    }

    private var perWeekPrice: String {
        switch product.id {
        case SubscriptionProductID.yearly.rawValue:
            // Calculate weekly equivalent (52 weeks in a year)
            let weeklyPrice = product.price / 52
            return String(format: "$%.2f", NSDecimalNumber(decimal: weeklyPrice).doubleValue)
        case SubscriptionProductID.monthly.rawValue:
            // Calculate weekly equivalent (4.33 weeks in a month)
            let weeklyPrice = product.price / Decimal(4.33)
            return String(format: "$%.2f", NSDecimalNumber(decimal: weeklyPrice).doubleValue)
        case SubscriptionProductID.weekly.rawValue:
            return product.displayPrice
        default:
            return product.displayPrice
        }
    }

    private var periodSuffix: String {
        switch product.id {
        case SubscriptionProductID.yearly.rawValue: return "per year"
        case SubscriptionProductID.monthly.rawValue: return "per month"
        case SubscriptionProductID.weekly.rawValue: return "per week"
        default: return ""
        }
    }

    private var priceDescription: String {
        switch product.id {
        case SubscriptionProductID.yearly.rawValue:
            // Calculate monthly equivalent
            let monthlyPrice = product.price / 12
            return String(format: "%.2f/month", NSDecimalNumber(decimal: monthlyPrice).doubleValue)
        case SubscriptionProductID.monthly.rawValue:
            return "\(product.displayPrice)/month"
        case SubscriptionProductID.weekly.rawValue:
            return "\(product.displayPrice)/week"
        default:
            return product.displayPrice
        }
    }
}

// MARK: - Preview

#if DEBUG
struct PaywallView_Previews: PreviewProvider {
    static var previews: some View {
        PaywallView(
            subscriptionService: SubscriptionService(),
            hasCompletedPaywall: .constant(false)
        )
    }
}
#endif
