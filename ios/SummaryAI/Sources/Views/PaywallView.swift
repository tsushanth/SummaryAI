import SwiftUI
import PaywallKit

struct LegacyPaywallView: View {
    @Binding var hasCompletedPaywall: Bool
    @State private var selectedProductId: String?
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store = StoreManager.shared

    var body: some View {
        VStack(spacing: 16) {
            // Close button
            HStack {
                Spacer()
                Button {
                    PaywallCoordinator.shared.trackDismiss()
                    hasCompletedPaywall = true
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(.secondary.opacity(0.7))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Close")
            }
            .padding(.horizontal)
            .padding(.top, 12)

            // Header
            VStack(spacing: 6) {
                Text("Never Take Notes Again!")
                    .font(.title2)
                    .fontWeight(.bold)
                    .multilineTextAlignment(.center)

                Text("AI-powered meeting transcription & summaries")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)

            // Features
            VStack(alignment: .leading, spacing: 8) {
                FeatureRow(icon: "waveform", text: "Unlimited meeting recordings with real-time speaker detection")
                FeatureRow(icon: "doc.text", text: "AI-generated summaries, key takeaways, and action items")
                FeatureRow(icon: "bubble.left.and.bubble.right", text: "Ask AI questions about any recorded meeting")
                FeatureRow(icon: "globe", text: "Transcription in 120+ languages")
                FeatureRow(icon: "square.and.arrow.up", text: "Export transcripts as PDF or text files")
            }
            .padding(.horizontal, 24)

            // Plans
            VStack(spacing: 8) {
                if store.paywallProducts.isEmpty {
                    ProgressView("Loading plans...")
                        .padding()
                }

                ForEach(store.paywallProducts, id: \.id) { product in
                    PlanRow(
                        name: product.period.rawValue.capitalized,
                        price: product.localizedPrice,
                        period: "/\(product.period.rawValue)",
                        badge: product.period == .yearly ? "Best Value" : nil,
                        subtitle: product.trialDays.map { "\($0)-day free trial" },
                        isSelected: selectedProductId == product.id
                    ) { selectedProductId = product.id }
                }
            }
            .padding(.horizontal)
            .task {
                if store.paywallProducts.isEmpty {
                    await store.loadProducts()
                }
                if selectedProductId == nil {
                    selectedProductId = store.paywallProducts.first { $0.period == .yearly }?.id
                        ?? store.paywallProducts.first?.id
                }
                AnalyticsService.shared.logPaywallViewed(source: "onboarding")
            }

            Spacer(minLength: 0)

            // Buttons
            VStack(spacing: 10) {
                // Subscribe button
                Button {
                    if let id = selectedProductId {
                        Task { await purchase(productId: id) }
                    } else {
                        hasCompletedPaywall = true
                        dismiss()
                    }
                } label: {
                    HStack {
                        if isPurchasing {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(0.8)
                        }
                        Text("Continue")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(isPurchasing)

                // Web discount
                Link(destination: URL(string: "https://meetingmind.org/subscription")!) {
                    Text("Save 30% on Web")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(Color.blue.opacity(0.1))
                        .foregroundColor(.blue)
                        .cornerRadius(10)
                }
            }
            .padding(.horizontal)

            // Footer
            VStack(spacing: 8) {
                // Auto-renewal disclosure (required by App Store Review Guidelines)
                let selectedProduct = store.paywallProducts.first { $0.id == selectedProductId }
                if let product = selectedProduct, let trialDays = product.trialDays {
                    Text("After your \(trialDays)-day free trial, you will automatically be charged \(product.localizedPrice)/\(product.period.rawValue). Subscription auto-renews unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in App Store Settings.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                } else {
                    Text("Subscription auto-renews at the end of each period unless cancelled at least 24 hours before. Manage or cancel anytime in App Store Settings.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: 16) {
                    Link("Terms", destination: URL(string: "https://kreativekoala.llc/terms")!)
                    Link("Privacy", destination: URL(string: "https://kreativekoala.llc/privacy")!)
                    Button("Restore") {
                        Task {
                            await store.restore()
                            await PremiumManager.shared.validateSubscriptionState()
                            if PremiumManager.shared.isPremium {
                                hasCompletedPaywall = true
                            }
                        }
                    }
                }
                .font(.caption)
                .foregroundColor(.secondary)
            }
            .padding(.bottom, 16)
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
    }

    private func purchase(productId: String) async {
        isPurchasing = true
        defer { isPurchasing = false }

        AnalyticsService.shared.logSubscriptionStarted(productId: productId)

        // Look up actual price from loaded products
        let product = store.paywallProducts.first { $0.id == productId }
        let price = Double(truncating: (product?.price ?? 0) as NSDecimalNumber)
        let currency = product?.currencyCode ?? "USD"

        let result = await store.purchase(productId: productId)
        switch result {
        case .purchased:
            await PremiumManager.shared.validateSubscriptionState()
            AnalyticsService.shared.setSubscriptionStatus(true)
            AnalyticsService.shared.logSubscriptionCompleted(productId: productId, price: price, currency: currency)
            FacebookSDKHelper.shared.logSubscription(price: price, currency: currency, productId: productId)
            // Log trial start if this product has a free trial
            if product?.trialDays != nil {
                FacebookSDKHelper.shared.logTrialStarted(productId: productId)
            }
            hasCompletedPaywall = true
            dismiss()
        case .cancelled:
            break
        case .pending:
            break
        case .failed:
            AnalyticsService.shared.logSubscriptionFailed(
                productId: productId,
                error: "Purchase failed"
            )
            errorMessage = "Purchase failed. Please try again."
            showError = true
        }
    }
}

// MARK: - Feature Row

private struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(.blue)
                .frame(width: 20)
            Text(text)
                .font(.subheadline)
                .foregroundColor(.primary)
        }
    }
}

// MARK: - Plan Row

private struct PlanRow: View {
    let name: String
    let price: String
    let period: String
    let badge: String?
    let subtitle: String?
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                // Radio indicator
                Circle()
                    .strokeBorder(isSelected ? Color.blue : Color.gray.opacity(0.4), lineWidth: 2)
                    .background(Circle().fill(isSelected ? Color.blue : Color.clear))
                    .frame(width: 20, height: 20)
                    .overlay(
                        Circle()
                            .fill(Color.white)
                            .frame(width: 8, height: 8)
                            .opacity(isSelected ? 1 : 0)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(name)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)

                        if let badge = badge {
                            Text(badge)
                                .font(.caption2)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.orange)
                                .cornerRadius(4)
                        }
                    }

                }

                Spacer()

                // Price — billed amount must be most prominent
                VStack(alignment: .trailing, spacing: 2) {
                    HStack(spacing: 2) {
                        Text(price)
                            .font(.body)
                            .fontWeight(.bold)
                            .foregroundColor(.primary)
                        Text(period)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    if let subtitle = subtitle {
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundColor(.green)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.blue : Color.gray.opacity(0.3), lineWidth: isSelected ? 2 : 1)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Preview

#if DEBUG
struct LegacyPaywallView_Previews: PreviewProvider {
    static var previews: some View {
        LegacyPaywallView(
            hasCompletedPaywall: .constant(false)
        )
    }
}
#endif
