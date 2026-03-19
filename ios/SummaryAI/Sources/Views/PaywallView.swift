import SwiftUI
import RevenueCat

struct LegacyPaywallView: View {
    @ObservedObject var subscriptionService: SubscriptionService
    @Binding var hasCompletedPaywall: Bool
    @State private var selectedPackage: Package?
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""
    @Environment(\.dismiss) private var dismiss

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

            // Features — what you get with Meeting Mind PRO
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
                if subscriptionService.availablePackages.isEmpty && subscriptionService.isLoading {
                    ProgressView("Loading plans...")
                        .padding()
                }

                if let yearly = subscriptionService.yearlyPackage {
                    PlanRow(
                        name: "Annual",
                        price: yearly.localizedPriceString,
                        period: "/year",
                        badge: "Best Value",
                        subtitle: "7-day free trial",
                        isSelected: selectedPackage?.identifier == yearly.identifier
                    ) { selectedPackage = yearly }
                }

                if let monthly = subscriptionService.monthlyPackage {
                    PlanRow(
                        name: "Monthly",
                        price: monthly.localizedPriceString,
                        period: "/month",
                        badge: nil,
                        subtitle: nil,
                        isSelected: selectedPackage?.identifier == monthly.identifier
                    ) { selectedPackage = monthly }
                }

                if let weekly = subscriptionService.weeklyPackage {
                    PlanRow(
                        name: "Weekly",
                        price: weekly.localizedPriceString,
                        period: "/week",
                        badge: nil,
                        subtitle: nil,
                        isSelected: selectedPackage?.identifier == weekly.identifier
                    ) { selectedPackage = weekly }
                }
            }
            .padding(.horizontal)
            .task {
                if subscriptionService.offerings == nil {
                    await subscriptionService.loadOfferings()
                }
                if selectedPackage == nil {
                    selectedPackage = subscriptionService.yearlyPackage
                }
                AnalyticsService.shared.logPaywallViewed(source: "onboarding")
            }

            Spacer(minLength: 0)

            // Buttons
            VStack(spacing: 10) {
                // Subscribe button
                Button {
                    if selectedPackage != nil {
                        Task { await purchase() }
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
                Text("Cancel anytime. No commitment.")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack(spacing: 16) {
                    Link("Terms", destination: URL(string: "https://kreativekoala.llc/terms")!)
                    Link("Privacy", destination: URL(string: "https://kreativekoala.llc/privacy")!)
                    Button("Restore") {
                        Task {
                            await subscriptionService.restorePurchases()
                            if subscriptionService.subscriptionStatus.isActive {
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

    private func purchase() async {
        guard let package = selectedPackage else { return }
        isPurchasing = true
        defer { isPurchasing = false }

        AnalyticsService.shared.logSubscriptionStarted(productId: package.storeProduct.productIdentifier)

        do {
            let success = try await subscriptionService.purchase(package)
            if success {
                let price = (package.storeProduct.price as NSDecimalNumber).doubleValue
                let currency = package.storeProduct.currencyCode ?? "USD"
                AnalyticsService.shared.logSubscriptionCompleted(
                    productId: package.storeProduct.productIdentifier,
                    price: price,
                    currency: currency
                )
                AnalyticsService.shared.setSubscriptionStatus(true)
                hasCompletedPaywall = true
                dismiss()
            }
        } catch {
            AnalyticsService.shared.logSubscriptionFailed(
                productId: package.storeProduct.productIdentifier,
                error: error.localizedDescription
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

                    if let subtitle = subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }

                Spacer()

                // Price
                HStack(spacing: 2) {
                    Text(price)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                    Text(period)
                        .font(.caption)
                        .foregroundColor(.secondary)
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
            subscriptionService: SubscriptionService(),
            hasCompletedPaywall: .constant(false)
        )
    }
}
#endif
