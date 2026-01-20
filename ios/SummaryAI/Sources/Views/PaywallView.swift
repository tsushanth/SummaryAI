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
        VStack(spacing: 0) {
            // Close button at top right
            HStack {
                Spacer()
                Button {
                    hasCompletedPaywall = true
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundColor(.secondary.opacity(0.6))
                }
                .padding(.trailing, 16)
                .padding(.top, 8)
            }

            // Header
            headerSectionCompact

            Spacer(minLength: 12)

            // Compact features
            featuresSectionCompact
                .padding(.horizontal, 20)

            // "No commitment, cancel anytime" checkmark
            HStack(spacing: 5) {
                Image(systemName: "checkmark")
                    .font(.caption)
                    .fontWeight(.bold)
                Text("No commitment, cancel anytime")
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .foregroundColor(.primary)
            .padding(.top, 12)

            Spacer(minLength: 8)

            // Subscription options (3 plans)
            subscriptionOptionsSectionCompact
                .padding(.horizontal)
                .padding(.top, 8)

            // Continue in app button
            startTrialButton
                .padding(.top, 12)

            // Save 30% Online button
            webDiscountButton
                .padding(.top, 8)

            // Footer links
            footerLinks
                .padding(.top, 12)
                .padding(.bottom, 16)
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - Header Section (Compact)

    private var headerSectionCompact: some View {
        VStack(spacing: 4) {
            Text("Never Take Notes Again!")
                .font(.title)
                .fontWeight(.bold)
                .italic()
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal)
    }

    // MARK: - Features Section (Compact)

    private var featuresSectionCompact: some View {
        VStack(alignment: .leading, spacing: 8) {
            featureRowCompact(
                text: "Record and transcribe unlimited meetings with auto speaker detection."
            )
            featureRowCompact(
                text: "Instantly generate summaries and to-dos in any language."
            )
            featureRowCompact(
                text: "Ask questions to quickly access details from past meetings."
            )
        }
    }

    private func featureRowCompact(text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "sparkles")
                .font(.system(size: 14))
                .foregroundColor(.blue)
                .frame(width: 16)

            Text(text)
                .font(.caption)
                .foregroundColor(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Subscription Options Section (3 plans, compact)

    private var subscriptionOptionsSectionCompact: some View {
        VStack(spacing: 6) {
            // Annual Plan (with trial and discount badge)
            if let yearly = subscriptionService.yearlyProduct {
                CompactSubscriptionCard(
                    planName: "Annual",
                    price: yearly.displayPrice,
                    trialText: "7-day free trial",
                    badgeText: "Best Value",
                    isSelected: selectedProduct?.id == yearly.id
                ) {
                    selectedProduct = yearly
                }
            }

            // Monthly Plan
            if let monthly = subscriptionService.monthlyProduct {
                CompactSubscriptionCard(
                    planName: "Monthly",
                    price: monthly.displayPrice,
                    trialText: nil,
                    badgeText: nil,
                    isSelected: selectedProduct?.id == monthly.id
                ) {
                    selectedProduct = monthly
                }
            }

            // Weekly Plan
            if let weekly = subscriptionService.weeklyProduct {
                CompactSubscriptionCard(
                    planName: "Weekly",
                    price: weekly.displayPrice,
                    trialText: nil,
                    badgeText: nil,
                    isSelected: selectedProduct?.id == weekly.id
                ) {
                    selectedProduct = weekly
                }
            }
        }
        .onAppear {
            // Default to yearly selection
            if selectedProduct == nil {
                selectedProduct = subscriptionService.yearlyProduct
            }
        }
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
            HStack(spacing: 6) {
                if isPurchasing {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(0.8)
                }

                Text(buttonTitle)
                    .font(.subheadline)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(
                LinearGradient(
                    colors: [.blue, .purple],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .foregroundColor(.white)
            .cornerRadius(12)
        }
        .disabled(isPurchasing)
        .padding(.horizontal)
    }

    private var buttonTitle: String {
        return "Continue in app"
    }


    // MARK: - Web Discount Button (Wave-style)

    private var webDiscountButton: some View {
        Link(destination: URL(string: "https://meetingmind.org/subscription")!) {
            Text("Save 30% Online")
                .font(.subheadline)
                .fontWeight(.semibold)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(
                    LinearGradient(
                        colors: [Color(red: 0.4, green: 0.6, blue: 1.0), Color(red: 0.8, green: 0.4, blue: 0.9)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .foregroundColor(.white)
                .cornerRadius(12)
        }
        .padding(.horizontal)
    }

    // MARK: - Footer Links (Terms, Privacy, Restore)

    private var footerLinks: some View {
        HStack(spacing: 20) {
            Link("Terms", destination: URL(string: "https://kreativekoala.llc/terms")!)
                .font(.caption)
                .foregroundColor(.secondary)

            Link("Privacy", destination: URL(string: "https://kreativekoala.llc/privacy")!)
                .font(.caption)
                .foregroundColor(.secondary)

            Button {
                Task {
                    await subscriptionService.restorePurchases()
                    if subscriptionService.subscriptionStatus.isActive {
                        hasCompletedPaywall = true
                    }
                }
            } label: {
                Text("Restore")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
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

// MARK: - Compact Subscription Card

struct CompactSubscriptionCard: View {
    let planName: String
    let price: String
    let trialText: String?
    let badgeText: String?
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                // Plan name and price
                HStack(spacing: 8) {
                    Text(planName)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.blue)

                    Text(price)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                // Trial text and badge
                HStack(spacing: 8) {
                    if let badge = badgeText {
                        Text(badge)
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(Color.blue)
                            .cornerRadius(4)
                    }

                    if let trial = trialText {
                        Text(trial)
                            .font(.caption2)
                            .foregroundColor(.green)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(.systemBackground))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(isSelected ? Color.blue : Color.gray.opacity(0.3), lineWidth: isSelected ? 2 : 1)
                    )
            )
        }
        .buttonStyle(PlainButtonStyle())
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
