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
                        .font(.title2)
                        .foregroundColor(.secondary.opacity(0.6))
                }
                .padding(.trailing, 20)
                .padding(.top, 12)
            }

            // Header with decorative background
            headerSectionCompact
                .padding(.top, 8)

            Spacer()

            // Compact features (Wave-style: 3 bullet points)
            featuresSectionCompact
                .padding(.horizontal, 24)

            // "No commitment, cancel anytime" checkmark
            HStack(spacing: 6) {
                Image(systemName: "checkmark")
                    .fontWeight(.bold)
                Text("No commitment, cancel anytime")
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .foregroundColor(.primary)
            .padding(.top, 20)

            Spacer()

            // Subscription options (Wave-style: 2 compact cards)
            subscriptionOptionsSectionCompact
                .padding(.horizontal)
                .padding(.top, 16)

            // Continue in app button
            startTrialButton
                .padding(.top, 16)

            // Save 30% Online button
            webDiscountButton
                .padding(.top, 12)

            // Footer links
            footerLinks
                .padding(.top, 16)
                .padding(.bottom, 24)
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - Header Section (Compact - Wave style)

    private var headerSectionCompact: some View {
        VStack(spacing: 8) {
            Text("Never Take Notes Again!")
                .font(.largeTitle)
                .fontWeight(.bold)
                .italic()
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal)
    }

    // MARK: - Features Section (Compact - Wave style)

    private var featuresSectionCompact: some View {
        VStack(alignment: .leading, spacing: 12) {
            featureRowCompact(
                text: "Record and transcribe unlimited meetings while speakers are auto-detected for you."
            )
            featureRowCompact(
                text: "Instantly generate summaries and to-dos in any language and share them with one tap."
            )
            featureRowCompact(
                text: "Ask Meeting Mind questions to quickly access any details from meetings you can't recall."
            )
        }
    }

    private func featureRowCompact(text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 16))
                .foregroundColor(.blue)
                .frame(width: 20)

            Text(text)
                .font(.subheadline)
                .foregroundColor(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Subscription Options Section (Compact - Wave style)

    private var subscriptionOptionsSectionCompact: some View {
        VStack(spacing: 10) {
            // Annual Plan (with trial and discount badge)
            if let yearly = subscriptionService.yearlyProduct {
                CompactSubscriptionCard(
                    planName: "Annual Plan",
                    price: yearly.displayPrice,
                    trialText: "3-day free trial",
                    badgeText: "Limited Time: 70% off",
                    isSelected: selectedProduct?.id == yearly.id
                ) {
                    selectedProduct = yearly
                }
            }

            // Weekly Plan
            if let weekly = subscriptionService.weeklyProduct {
                CompactSubscriptionCard(
                    planName: "Weekly Plan",
                    price: weekly.displayPrice,
                    trialText: "No free trial",
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
        return "Continue in app"
    }


    // MARK: - Web Discount Button (Wave-style)

    private var webDiscountButton: some View {
        Link(destination: URL(string: "https://meetingmind.org/subscription")!) {
            Text("Save 30% Online")
                .fontWeight(.semibold)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(
                    LinearGradient(
                        colors: [Color(red: 0.4, green: 0.6, blue: 1.0), Color(red: 0.8, green: 0.4, blue: 0.9)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .foregroundColor(.white)
                .cornerRadius(16)
        }
        .padding(.horizontal)
    }

    // MARK: - Footer Links (Terms, Privacy, Restore)

    private var footerLinks: some View {
        HStack(spacing: 24) {
            Link("Terms", destination: URL(string: "https://kreativekoala.llc/terms")!)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Link("Privacy", destination: URL(string: "https://kreativekoala.llc/privacy")!)
                .font(.subheadline)
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
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.top, 8)
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

// MARK: - Compact Subscription Card (Wave style)

struct CompactSubscriptionCard: View {
    let planName: String
    let price: String
    let trialText: String
    let badgeText: String?
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                // Plan name and price
                VStack(alignment: .leading, spacing: 4) {
                    Text(planName)
                        .font(.headline)
                        .foregroundColor(.blue)

                    Text(price)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                // Trial text and badge
                VStack(alignment: .trailing, spacing: 4) {
                    if let badge = badgeText {
                        Text(badge)
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.blue)
                            .cornerRadius(4)
                    }

                    Text(trialText)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(.systemBackground))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
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
