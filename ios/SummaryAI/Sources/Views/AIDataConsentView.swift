//
//  AIDataConsentView.swift
//  SummaryAI
//
//  Displays AI data sharing disclosures and collects user consent
//

import SwiftUI

struct AIDataConsentView: View {
    let isOnboarding: Bool
    @StateObject private var consentManager = AIDataConsentManager.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "shield.checkered")
                            .font(.system(size: 44))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.blue, .purple],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .padding(.bottom, 4)

                        Text("AI Data Sharing")
                            .font(.system(size: 28, weight: .bold))

                        Text("Meeting Mind uses cloud-based AI services to transcribe your recordings and generate summaries. Here's exactly what data is shared and with whom.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.bottom, 8)

                    // Disclosure cards
                    disclosureCard(
                        icon: "waveform",
                        iconColor: .blue,
                        title: "Audio Transcription",
                        description: "Your audio recordings are sent to our backend server, which uses Deepgram for speech-to-text transcription.",
                        services: ["Deepgram — converts speech to text with speaker identification"]
                    )

                    disclosureCard(
                        icon: "doc.text",
                        iconColor: .purple,
                        title: "AI Summaries & Action Items",
                        description: "Your transcribed text is sent to OpenAI to generate meeting summaries, action items, and answer questions about your recordings.",
                        services: ["OpenAI (GPT-4) — generates summaries, extracts action items, and powers Q&A"]
                    )

                    disclosureCard(
                        icon: "phone.fill",
                        iconColor: .green,
                        title: "Phone Calls",
                        description: "When using the phone feature, call audio is routed through Twilio for recording and transcription.",
                        services: ["Twilio — VoIP calling and call recording"]
                    )

                    disclosureCard(
                        icon: "server.rack",
                        iconColor: .orange,
                        title: "Authentication & Storage",
                        description: "Your account information and files are stored securely via Supabase.",
                        services: ["Supabase — authentication, database, and file storage"]
                    )

                    disclosureCard(
                        icon: "iphone",
                        iconColor: .gray,
                        title: "What Stays on Your Device",
                        description: "Your app settings, preferences, and local cache remain on your device and are never shared.",
                        services: []
                    )

                    // Privacy note
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.blue)
                            .padding(.top, 2)

                        Text("Your data is transmitted securely via HTTPS and is not used to train AI models. You can revoke consent at any time in Settings.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 4)

                    // Links
                    HStack(spacing: 16) {
                        Link("Privacy Policy", destination: URL(string: "https://kreativekoala.llc/privacy")!)
                            .font(.caption)
                        Link("Terms of Service", destination: URL(string: "https://kreativekoala.llc/terms")!)
                            .font(.caption)
                    }
                    .padding(.horizontal, 4)

                    // Buttons
                    VStack(spacing: 12) {
                        Button {
                            consentManager.grantConsent()
                            if isOnboarding {
                                // Onboarding flow will detect consent change and proceed
                            } else {
                                dismiss()
                            }
                        } label: {
                            Text("I Understand & Agree")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .frame(height: 56)
                                .background(
                                    LinearGradient(
                                        colors: [.blue, .blue.opacity(0.8)],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .foregroundColor(.white)
                                .cornerRadius(16)
                        }

                        if isOnboarding {
                            Button {
                                consentManager.revokeConsent()
                                // Proceed without consent — AI features will be unavailable
                            } label: {
                                Text("Continue Without AI Features")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                        } else {
                            if consentManager.hasConsented {
                                Button {
                                    consentManager.revokeConsent()
                                    dismiss()
                                } label: {
                                    Text("Revoke Consent")
                                        .font(.subheadline)
                                        .foregroundColor(.red)
                                }
                            }

                            Button {
                                dismiss()
                            } label: {
                                Text("Close")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !isOnboarding {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
            }
        }
    }

    // MARK: - Disclosure Card

    @ViewBuilder
    private func disclosureCard(
        icon: String,
        iconColor: Color,
        title: String,
        description: String,
        services: [String]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(iconColor)
                    .frame(width: 32, height: 32)
                    .background(iconColor.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                Text(title)
                    .font(.system(size: 16, weight: .semibold))
            }

            Text(description)
                .font(.subheadline)
                .foregroundColor(.secondary)

            ForEach(services, id: \.self) { service in
                HStack(spacing: 8) {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.system(size: 12))
                        .foregroundColor(iconColor.opacity(0.7))
                    Text(service)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.leading, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

#Preview {
    AIDataConsentView(isOnboarding: true)
}
