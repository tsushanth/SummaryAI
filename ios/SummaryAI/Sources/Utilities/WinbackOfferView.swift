//
//  WinbackOfferView.swift
//  SummaryAI (Meeting Mind)
//
//  Winback offer shown to users who dismissed the paywall 3+ times.
//  Uses StoreManager (StoreKit 2) via PaywallKit.
//

import SwiftUI
import PaywallKit

struct WinbackOfferView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store = StoreManager.shared
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""

    private var yearlyProduct: PaywallProduct? {
        store.paywallProducts.first { $0.period == .yearly }
    }

    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.15),
                    Color(red: 0.10, green: 0.08, blue: 0.25)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 28) {

                    // MARK: - Badge
                    Text("SPECIAL OFFER")
                        .font(.system(size: 12, weight: .bold))
                        .tracking(1.5)
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background(
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [.blue, .purple],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                        )
                        .padding(.top, 40)

                    // MARK: - Headline
                    VStack(spacing: 8) {
                        Text("We miss you!")
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(.primary)

                        Text("Unlock the full power of Meeting Mind for effortless meetings")
                            .font(.system(size: 16))
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }

                    // MARK: - Value Props
                    VStack(spacing: 16) {
                        WinbackFeatureRow(
                            icon: "waveform",
                            title: "Unlimited Meeting Recordings",
                            subtitle: "Record any meeting, lecture, or conversation",
                            accentColor: .blue
                        )
                        WinbackFeatureRow(
                            icon: "doc.text.fill",
                            title: "AI Summaries & Action Items",
                            subtitle: "Never miss a key takeaway again",
                            accentColor: .purple
                        )
                        WinbackFeatureRow(
                            icon: "person.2.fill",
                            title: "Speaker Identification",
                            subtitle: "Know who said what with smart detection",
                            accentColor: .blue
                        )
                        WinbackFeatureRow(
                            icon: "bubble.left.and.bubble.right.fill",
                            title: "AI Chat for Recordings",
                            subtitle: "Ask questions about any recorded meeting",
                            accentColor: .purple
                        )
                        WinbackFeatureRow(
                            icon: "globe",
                            title: "120+ Languages",
                            subtitle: "Transcription and translation support",
                            accentColor: .blue
                        )
                    }
                    .padding(.horizontal, 24)

                    // MARK: - CTA Button
                    Button {
                        Task { await purchaseYearly() }
                    } label: {
                        HStack {
                            if isPurchasing {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                VStack(spacing: 2) {
                                    if let yearly = yearlyProduct {
                                        Text("\(yearly.localizedPrice)/year")
                                            .font(.system(size: 18, weight: .bold))
                                    }
                                    Text("Start with Free Trial")
                                        .font(.system(size: 13))
                                }
                            }
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 60)
                        .background(
                            LinearGradient(
                                colors: [.blue, .purple],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(16)
                        .shadow(color: .blue.opacity(0.4), radius: 12, y: 6)
                    }
                    .disabled(isPurchasing || yearlyProduct == nil)
                    .padding(.horizontal, 24)

                    // MARK: - Dismiss
                    Button {
                        dismiss()
                    } label: {
                        Text("No thanks")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                    .padding(.bottom, 8)

                    // Auto-renewal disclosure (required by App Store Review Guidelines)
                    if let yearly = yearlyProduct {
                        Group {
                            if let trialDays = yearly.trialDays {
                                Text("After your " + String(trialDays) + "-day free trial, you will automatically be charged " + yearly.localizedPrice + "/year. Subscription auto-renews unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in App Store Settings.")
                            } else {
                                Text("You will automatically be charged " + yearly.localizedPrice + "/year. Subscription auto-renews unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in App Store Settings.")
                            }
                        }
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 24)
                    }
                }
            }
        }
        .task {
            if store.paywallProducts.isEmpty {
                await store.loadProducts()
            }
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - Purchase

    private func purchaseYearly() async {
        guard let yearly = yearlyProduct else {
            errorMessage = "Subscription not available. Please try again later."
            showError = true
            return
        }

        isPurchasing = true
        defer { isPurchasing = false }

        let price = Double(truncating: yearly.price as NSDecimalNumber)
        let currency = yearly.currencyCode

        let result = await store.purchase(productId: yearly.id)
        switch result {
        case .purchased:
            await PremiumManager.shared.validateSubscriptionState()
            AnalyticsService.shared.logSubscriptionCompleted(productId: yearly.id, price: price, currency: currency)
            FacebookSDKHelper.shared.logSubscription(price: price, currency: currency, productId: yearly.id)
            dismiss()
        case .cancelled:
            break
        case .pending:
            break
        case .failed:
            errorMessage = "Purchase failed. Please try again."
            showError = true
        }
    }
}

// MARK: - Feature Row

private struct WinbackFeatureRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let accentColor: Color

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(accentColor.opacity(0.15))
                    .frame(width: 48, height: 48)

                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(accentColor)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.primary)

                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
            }

            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
                .font(.system(size: 20))
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(.systemGray6))
        )
    }
}

// MARK: - Preview

#Preview {
    WinbackOfferView()
}
