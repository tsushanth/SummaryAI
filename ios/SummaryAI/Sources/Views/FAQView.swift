import SwiftUI

// MARK: - FAQ View

/// Help and FAQ section with expandable questions
struct FAQView: View {
    @State private var expandedQuestions: Set<String> = []

    private let faqItems: [FAQItem] = [
        FAQItem(
            question: "How does Meeting Mind work?",
            answer: "Meeting Mind uses advanced speech recognition and AI to transcribe your recordings and generate intelligent summaries. Simply record your meeting or conversation, and our system will automatically transcribe the audio, identify speakers, and create a concise summary with key points and action items."
        ),
        FAQItem(
            question: "Is there a limit on recording time?",
            answer: "Free users can record up to 10 minutes per recording. Pro users enjoy unlimited recording time with no restrictions on file size or duration."
        ),
        FAQItem(
            question: "Are my recordings private?",
            answer: "Yes, absolutely. Your recordings are encrypted and stored securely. Only you have access to your recordings and transcripts. We never share your data with third parties or use it to train our AI models."
        ),
        FAQItem(
            question: "How accurate are the transcriptions?",
            answer: "Our transcription accuracy is typically above 95% for clear audio in supported languages. Accuracy may vary based on audio quality, background noise, accents, and technical terminology. You can always edit transcripts to correct any errors."
        ),
        FAQItem(
            question: "Can I use it to record online meetings?",
            answer: "Yes! You can use Meeting Mind to record audio from any source, including online meetings on Zoom, Google Meet, Teams, and other platforms. Simply start a recording while in your meeting. Note: Always ensure you have permission from all participants before recording."
        ),
        FAQItem(
            question: "Can I use Meeting Mind while using other apps or with my screen off?",
            answer: "Yes, Meeting Mind supports background recording. You can start a recording and then switch to other apps or turn off your screen - the recording will continue. A status bar indicator will show that recording is in progress."
        ),
        FAQItem(
            question: "Can I access Meeting Mind on multiple devices?",
            answer: "Yes, your Meeting Mind account syncs across all your devices. Sign in with the same account on any iOS device to access all your recordings, transcripts, and summaries."
        ),
        FAQItem(
            question: "Can I record multiple languages?",
            answer: "Yes, Meeting Mind supports over 120 languages for transcription. You can select the language before recording, or use auto-detect to let our system identify the language automatically."
        ),
        FAQItem(
            question: "How do I export my recordings?",
            answer: "You can export your summaries and transcripts in multiple formats including PDF and plain text. Open any recording, tap the share button, and choose your preferred export format."
        ),
        FAQItem(
            question: "What happens if I cancel my subscription?",
            answer: "If you cancel your Pro subscription, you'll retain access to Pro features until the end of your billing period. After that, your account will revert to the free tier, but all your existing recordings and data will remain accessible."
        )
    ]

    var body: some View {
        List {
            Section {
                Text("Common Questions or problems")
                    .font(.title2)
                    .fontWeight(.bold)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 16, leading: 0, bottom: 16, trailing: 0))
            }

            ForEach(faqItems) { item in
                FAQItemView(
                    item: item,
                    isExpanded: expandedQuestions.contains(item.id)
                ) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        if expandedQuestions.contains(item.id) {
                            expandedQuestions.remove(item.id)
                        } else {
                            expandedQuestions.insert(item.id)
                        }
                    }
                }
            }

            // Contact section
            Section {
                VStack(spacing: 16) {
                    Text("Having issues with your subscription?")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    Button {
                        // Open contact
                        if let url = URL(string: "mailto:support@summaryai.app") {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("Contact Us")
                            .font(.subheadline)
                            .foregroundColor(.blue)
                    }

                    Button {
                        // Restore purchases
                    } label: {
                        Text("Restore Purchase")
                            .font(.subheadline)
                            .foregroundColor(.blue)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Help & FAQ")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - FAQ Item Model

struct FAQItem: Identifiable {
    let id = UUID().uuidString
    let question: String
    let answer: String
}

// MARK: - FAQ Item View

struct FAQItemView: View {
    let item: FAQItem
    let isExpanded: Bool
    let onTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onTap) {
                HStack {
                    Text(item.question)
                        .font(.body)
                        .foregroundColor(.primary)
                        .multilineTextAlignment(.leading)

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 16)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(item.answer)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.bottom, 16)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

// MARK: - Help Button

/// Floating help button for quick access
struct HelpButton: View {
    @State private var showFAQ = false

    var body: some View {
        Button {
            showFAQ = true
        } label: {
            Image(systemName: "questionmark.circle.fill")
                .font(.title2)
                .foregroundColor(.blue)
        }
        .sheet(isPresented: $showFAQ) {
            NavigationStack {
                FAQView()
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button("Done") {
                                showFAQ = false
                            }
                        }
                    }
            }
        }
    }
}

// MARK: - Preview

#if DEBUG
struct FAQView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            FAQView()
        }
    }
}
#endif
