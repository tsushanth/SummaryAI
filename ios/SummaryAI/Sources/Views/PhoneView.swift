import SwiftUI

// MARK: - Main Phone View

/// Main phone view with tabs for calls and dialer
struct PhoneView: View {
    @EnvironmentObject var apiClient: SummaryAIAPIClient
    @StateObject private var viewModel: PhoneViewModel

    @State private var selectedSegment: PhoneSegment = .dialer
    @State private var showVerificationSheet = false

    init() {
        _viewModel = StateObject(wrappedValue: PhoneViewModel(apiClient: SummaryAIAPIClient()))
    }

    var body: some View {
        NavigationStack {
            Group {
                // Show verification screen if no verified phones
                if !viewModel.hasVerifiedPhones && viewModel.state != .loading {
                    NoVerifiedPhoneView(onVerifyClick: {
                        showVerificationSheet = true
                    })
                } else {
                    VStack(spacing: 0) {
                        // Segment picker
                        Picker("Section", selection: $selectedSegment) {
                            Text("History").tag(PhoneSegment.calls)
                            Text("Dialer").tag(PhoneSegment.dialer)
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal)
                        .padding(.vertical, 8)

                        // Content based on segment
                        switch selectedSegment {
                        case .calls:
                            PhoneCallsListView(
                                viewModel: viewModel,
                                onCallClick: { call in
                                    viewModel.callFromHistory(call)
                                }
                            )
                        case .dialer, .settings:
                            NativeDialerView(
                                dialerNumber: $viewModel.dialerNumber,
                                hasVerifiedPhone: viewModel.hasVerifiedPhones,
                                showConsentDialog: viewModel.showRecordingConsentDialog && !viewModel.hasActiveCall,
                                onShowConsentDialog: {
                                    viewModel.showConsentDialog()
                                },
                                onDismissConsentDialog: {
                                    viewModel.dismissConsentDialog()
                                },
                                onConfirmConsentAndCall: {
                                    Task {
                                        await viewModel.acceptConsentAndCall()
                                    }
                                },
                                onVerifyPhone: {
                                    showVerificationSheet = true
                                }
                            )
                        }
                    }
                }
            }
            .navigationTitle("Phone")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                viewModel.updateApiClient(apiClient)
                Task {
                    await viewModel.loadData()
                }
            }
            .alert("Error", isPresented: $viewModel.showError) {
                Button("OK") {
                    viewModel.clearError()
                }
            } message: {
                Text(viewModel.errorMessage ?? "An error occurred")
            }
            // Verification sheet for AI recording feature
            .sheet(isPresented: $showVerificationSheet) {
                PhoneVerificationSheet(viewModel: viewModel)
            }
            // Active call sheet when AI recording is in progress
            .sheet(isPresented: .constant(viewModel.hasActiveCall), onDismiss: nil) {
                ActiveCallView(viewModel: viewModel)
                    .interactiveDismissDisabled(viewModel.hasActiveCall)
            }
        }
    }
}

// MARK: - Phone Segment

enum PhoneSegment: String, CaseIterable {
    case calls
    case dialer
    case settings

    var title: String {
        switch self {
        case .calls: return "Calls"
        case .dialer: return "Dialer"
        case .settings: return "Settings"
        }
    }
}

// MARK: - No Verified Phone View

/// Full-screen view shown when user has no verified phone numbers
struct NoVerifiedPhoneView: View {
    var onVerifyClick: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            // Icon with gradient background
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color.blue, Color.green],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 100, height: 100)

                Image(systemName: "phone.fill")
                    .font(.system(size: 44))
                    .foregroundColor(.white)
            }

            VStack(spacing: 12) {
                Text("Verify Your Phone")
                    .font(.title)
                    .fontWeight(.bold)

                Text("To make calls through the app, you need to verify your phone number first. We'll call you with a verification code.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Spacer()

            Button(action: onVerifyClick) {
                HStack {
                    Image(systemName: "phone.badge.checkmark")
                    Text("Verify Phone Number")
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(Color.blue)
                .cornerRadius(12)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Phone Calls List View

struct PhoneCallsListView: View {
    @ObservedObject var viewModel: PhoneViewModel
    var onCallClick: ((PhoneCall) -> Void)?

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView("Loading calls...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .empty:
                EmptyCallsView()

            case .error(let message):
                ErrorView(message: message) {
                    Task { await viewModel.loadData() }
                }

            case .loaded, .idle:
                if viewModel.phoneCalls.isEmpty {
                    EmptyCallsView()
                } else {
                    callsList
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if viewModel.isRefreshing {
                    ProgressView()
                        .scaleEffect(0.8)
                } else {
                    Button {
                        Task { await viewModel.refreshData() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
    }

    private var callsList: some View {
        VStack(spacing: 0) {
            // Processing banner when a call just ended
            if viewModel.isProcessingRecording {
                HStack(spacing: 8) {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Processing recording...")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color(.systemGray6))
            }

            List {
                ForEach(viewModel.phoneCalls) { call in
                    PhoneCallRow(call: call, onCallClick: onCallClick)
                        .onAppear {
                            Task {
                                await viewModel.loadMoreCallsIfNeeded(currentCall: call)
                            }
                        }
                }
            }
            .listStyle(.plain)
            .refreshable {
                await viewModel.refreshData()
            }
        }
    }
}

// MARK: - Phone Call Row

struct PhoneCallRow: View {
    let call: PhoneCall
    var onCallClick: ((PhoneCall) -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            // Status icon
            ZStack {
                Circle()
                    .fill(statusColor.opacity(0.15))
                    .frame(width: 44, height: 44)

                Image(systemName: call.status.icon)
                    .font(.system(size: 18))
                    .foregroundColor(statusColor)
            }

            // Call info
            VStack(alignment: .leading, spacing: 4) {
                Text(call.toName ?? call.formattedToNumber)
                    .font(.headline)

                HStack(spacing: 8) {
                    Text(call.status.displayName)
                        .font(.caption)
                        .foregroundColor(statusColor)

                    if call.recordingDuration != nil {
                        Text("•")
                            .foregroundColor(.secondary)
                        Text(call.formattedDuration)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    if call.isRecording {
                        HStack(spacing: 4) {
                            Circle()
                                .fill(.red)
                                .frame(width: 8, height: 8)
                            Text("Recording")
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }
                }
            }

            Spacer()

            // Call back button and timestamp
            VStack(alignment: .trailing, spacing: 8) {
                Text(formatDate(call.startedAt ?? call.createdAt))
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack(spacing: 12) {
                    // Call back button
                    Button {
                        onCallClick?(call)
                    } label: {
                        Image(systemName: "phone.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.white)
                            .frame(width: 32, height: 32)
                            .background(Color.green)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)

                    // Recording link if available
                    if let recordingId = call.recordingId {
                        NavigationLink(destination: RecordingDetailView(recordingId: recordingId)) {
                            Image(systemName: "waveform")
                                .font(.system(size: 14))
                                .foregroundColor(.blue)
                                .frame(width: 32, height: 32)
                                .background(Color.blue.opacity(0.15))
                                .clipShape(Circle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch call.status {
        case .completed:
            return .green
        case .inProgress, .recording:
            return .blue
        case .ringing:
            return .orange
        case .failed, .busy, .noAnswer:
            return .red
        case .cancelled, .initiated:
            return .gray
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Empty Calls View

struct EmptyCallsView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "phone.circle")
                .font(.system(size: 60))
                .foregroundColor(.gray.opacity(0.5))

            Text("No calls yet")
                .font(.title2)
                .fontWeight(.medium)

            Text("Make a call using the dialer to get started")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Phone Dialer View

struct PhoneDialerView: View {
    @ObservedObject var viewModel: PhoneViewModel
    @FocusState private var isNumberFocused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Phone number input
                VStack(spacing: 8) {
                    TextField("Phone number", text: $viewModel.dialerNumber)
                        .font(.system(size: 28, weight: .medium, design: .monospaced))
                        .multilineTextAlignment(.center)
                        .keyboardType(.phonePad)
                        .focused($isNumberFocused)

                    TextField("Contact name (optional)", text: $viewModel.dialerContactName)
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(16)
                .padding(.horizontal)

                // Dial pad
                DialPadView(number: $viewModel.dialerNumber)

                // Selected phone picker
                if !viewModel.verifiedPhones.isEmpty {
                    HStack {
                        Text("Calling from:")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        Picker("From", selection: $viewModel.selectedPhone) {
                            ForEach(viewModel.verifiedPhones) { phone in
                                Text(viewModel.formatPhoneNumber(phone.phoneNumber))
                                    .tag(phone as VerifiedPhone?)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    .padding(.horizontal)
                }

                // Call button
                Button {
                    Task {
                        await viewModel.initiateCall()
                    }
                } label: {
                    Image(systemName: "phone.fill")
                        .font(.title)
                        .foregroundColor(.white)
                        .frame(width: 72, height: 72)
                        .background(viewModel.dialerNumber.isEmpty ? Color.gray : Color.green)
                        .clipShape(Circle())
                }
                .disabled(viewModel.dialerNumber.isEmpty)
                .padding(.top, 8)
            }
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
    }
}

// MARK: - Native Dialer View

/// Dialer for making calls - all calls are recorded automatically
struct NativeDialerView: View {
    @Binding var dialerNumber: String
    var hasVerifiedPhone: Bool = false
    var showConsentDialog: Bool = false
    var onShowConsentDialog: (() -> Void)?
    var onDismissConsentDialog: (() -> Void)?
    var onConfirmConsentAndCall: (() -> Void)?
    var onVerifyPhone: (() -> Void)?

    var body: some View {
        VStack(spacing: 16) {
            // Phone number input
            TextField("Enter phone number", text: $dialerNumber)
                .font(.system(size: 28, weight: .medium, design: .monospaced))
                .multilineTextAlignment(.center)
                .keyboardType(.phonePad)
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(16)
                .padding(.horizontal)
                .padding(.top, 16)

            // Dial pad
            DialPadView(number: $dialerNumber)

            Spacer()

            // Single call button - all calls are recorded
            VStack(spacing: 8) {
                Button {
                    if hasVerifiedPhone {
                        onShowConsentDialog?()
                    } else {
                        onVerifyPhone?()
                    }
                } label: {
                    Image(systemName: "phone.fill")
                        .font(.title)
                        .foregroundColor(.white)
                        .frame(width: 72, height: 72)
                        .background(dialerNumber.isEmpty ? Color.gray : (hasVerifiedPhone ? Color.green : Color(.systemGray4)))
                        .clipShape(Circle())
                }
                .disabled(dialerNumber.isEmpty)

                if !hasVerifiedPhone {
                    Text("Verify phone to make calls")
                        .font(.caption)
                        .foregroundColor(.secondary)
                } else {
                    Text("All calls are recorded")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.bottom, 32)
        }
        // Consent Dialog - auto-recording flow
        .alert("Recording Notice", isPresented: .constant(showConsentDialog)) {
            Button("Start Call", role: .destructive) {
                onConfirmConsentAndCall?()
            }
            Button("Cancel", role: .cancel) {
                onDismissConsentDialog?()
            }
        } message: {
            Text("This call will be automatically recorded for transcription.\n\nA recording notification will be played to the other party.\n\nPlease ensure recording is legal in your jurisdiction.")
        }
    }
}

// MARK: - Dial Pad View

struct DialPadView: View {
    @Binding var number: String

    private let keys: [[String]] = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["*", "0", "#"]
    ]

    private let letters: [String: String] = [
        "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL",
        "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ"
    ]

    var body: some View {
        VStack(spacing: 16) {
            ForEach(keys, id: \.self) { row in
                HStack(spacing: 24) {
                    ForEach(row, id: \.self) { key in
                        DialKeyView(key: key, subtitle: letters[key]) {
                            number += key
                        }
                    }
                }
            }

            // Backspace row
            HStack(spacing: 24) {
                Color.clear.frame(width: 70, height: 70)

                DialKeyView(key: "+", subtitle: nil) {
                    if number.isEmpty {
                        number = "+"
                    }
                }

                Button {
                    if !number.isEmpty {
                        number.removeLast()
                    }
                } label: {
                    Image(systemName: "delete.left")
                        .font(.title2)
                        .foregroundColor(.primary)
                        .frame(width: 70, height: 70)
                }
            }
        }
    }
}

struct DialKeyView: View {
    let key: String
    let subtitle: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(key)
                    .font(.system(size: 28, weight: .regular))

                if let subtitle = subtitle {
                    Text(subtitle)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }
            .frame(width: 70, height: 70)
            .background(Color(.systemGray5))
            .clipShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Phone Settings View

struct PhoneSettingsView: View {
    @ObservedObject var viewModel: PhoneViewModel
    @State private var showVerification = false

    var body: some View {
        List {
            Section {
                Button {
                    showVerification = true
                } label: {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.green)
                        Text("Add Phone Number")
                    }
                }
            }

            if !viewModel.verifiedPhones.isEmpty {
                Section("Verified Numbers") {
                    ForEach(viewModel.verifiedPhones) { phone in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(viewModel.formatPhoneNumber(phone.phoneNumber))
                                    .font(.headline)

                                if let verifiedAt = phone.verifiedAt {
                                    Text("Verified \(verifiedAt, style: .relative) ago")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }

                            Spacer()

                            if viewModel.selectedPhone?.id == phone.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            viewModel.selectedPhone = phone
                        }
                    }
                    .onDelete { indexSet in
                        for index in indexSet {
                            let phone = viewModel.verifiedPhones[index]
                            Task {
                                await viewModel.deleteVerifiedPhone(phone)
                            }
                        }
                    }
                }
            }

            Section {
                HStack {
                    Image(systemName: "info.circle")
                        .foregroundColor(.blue)
                    Text("Phone calls are placed through your verified number. Recordings are transcribed and saved to your recordings.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .sheet(isPresented: $showVerification) {
            PhoneVerificationSheet(viewModel: viewModel)
        }
    }
}

// MARK: - Phone Verification Sheet

struct PhoneVerificationSheet: View {
    @ObservedObject var viewModel: PhoneViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Icon
                Image(systemName: "phone.badge.checkmark")
                    .font(.system(size: 60))
                    .foregroundStyle(.linearGradient(
                        colors: [.blue, .green],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                    .padding(.top, 40)

                // Title
                Text("Verify Phone Number")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("We'll call you and read your verification code")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)

                // Phone number input
                if viewModel.verificationState == .idle || viewModel.verificationState == .sendingCode {
                    VStack(spacing: 16) {
                        TextField("Phone number", text: $viewModel.verificationPhoneNumber)
                            .font(.title3)
                            .keyboardType(.phonePad)
                            .multilineTextAlignment(.center)
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(12)
                            .padding(.horizontal)

                        Button {
                            Task {
                                await viewModel.sendVerificationCode()
                            }
                        } label: {
                            HStack {
                                if viewModel.verificationState == .sendingCode {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Image(systemName: "phone.arrow.up.right")
                                    Text("Call Me")
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(viewModel.verificationPhoneNumber.isEmpty || viewModel.verificationState == .sendingCode)
                        .padding(.horizontal)
                    }
                }

                // Verification code input
                if viewModel.verificationState == .codeSent || viewModel.verificationState == .verifying {
                    VStack(spacing: 16) {
                        Text("Calling \(viewModel.verificationPhoneNumber)...")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        Text("Answer the call to hear your code")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        TextField("6-digit code", text: $viewModel.verificationCode)
                            .font(.system(size: 32, weight: .medium, design: .monospaced))
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.center)
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(12)
                            .padding(.horizontal)

                        Button {
                            Task {
                                await viewModel.checkVerificationCode()
                            }
                        } label: {
                            HStack {
                                if viewModel.verificationState == .verifying {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Text("Verify")
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.green)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(viewModel.verificationCode.count != 6 || viewModel.verificationState == .verifying)
                        .padding(.horizontal)

                        Button("Resend code") {
                            Task {
                                await viewModel.sendVerificationCode()
                            }
                        }
                        .font(.subheadline)
                    }
                }

                // Success state
                if viewModel.verificationState == .verified {
                    VStack(spacing: 16) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.green)

                        Text("Phone Verified!")
                            .font(.title2)
                            .fontWeight(.bold)

                        Button("Done") {
                            viewModel.resetVerification()
                            dismiss()
                        }
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                        .padding(.horizontal)
                    }
                }

                // Error state
                if case .error(let message) = viewModel.verificationState {
                    VStack(spacing: 16) {
                        Text(message)
                            .foregroundColor(.red)
                            .font(.subheadline)

                        Button("Try Again") {
                            viewModel.resetVerification()
                        }
                        .foregroundColor(.blue)
                    }
                }

                Spacer()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        viewModel.resetVerification()
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Active Call View

struct ActiveCallView: View {
    @ObservedObject var viewModel: PhoneViewModel
    @Environment(\.dismiss) private var dismiss

    // Check if call is still active
    private var isCallActive: Bool {
        switch viewModel.activeCallState {
        case .initiating, .ringing, .connected, .recording:
            return true
        default:
            return false
        }
    }

    var body: some View {
        VStack(spacing: 32) {
            // Drag indicator - only show when call is not active
            if !isCallActive {
                Capsule()
                    .fill(Color(.systemGray4))
                    .frame(width: 40, height: 5)
                    .padding(.top, 8)
            } else {
                Spacer()
                    .frame(height: 13)
            }

            Spacer()

            // Recording indicator - always show when connected (auto-recording)
            if viewModel.activeCallState == .connected || viewModel.activeCallState == .recording {
                HStack(spacing: 8) {
                    Circle()
                        .fill(.red)
                        .frame(width: 12, height: 12)
                    Text("Recording")
                        .font(.headline)
                        .foregroundColor(.red)
                }
            }

            // Call status
            Text(callStatusText)
                .font(.title3)
                .foregroundColor(.secondary)

            // Contact info
            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(Color(.systemGray5))
                        .frame(width: 100, height: 100)

                    Image(systemName: "person.fill")
                        .font(.system(size: 40))
                        .foregroundColor(.gray)
                }

                Text(viewModel.activeCall?.toName ?? viewModel.activeCall?.formattedToNumber ?? "Unknown")
                    .font(.title)
                    .fontWeight(.semibold)

                if let call = viewModel.activeCall, call.toName != nil {
                    Text(call.formattedToNumber)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Call controls - simplified (no manual record buttons)
            HStack(spacing: 48) {
                // Mute button
                CallControlButton(
                    icon: viewModel.isMuted ? "mic.slash.fill" : "mic.fill",
                    label: viewModel.isMuted ? "Unmute" : "Mute",
                    color: viewModel.isMuted ? .red : .gray,
                    isActive: viewModel.isMuted
                ) {
                    viewModel.toggleMute()
                }

                // Speaker button
                CallControlButton(
                    icon: viewModel.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.fill",
                    label: "Speaker",
                    color: viewModel.isSpeakerOn ? .blue : .gray,
                    isActive: viewModel.isSpeakerOn
                ) {
                    viewModel.toggleSpeaker()
                }
            }

            // End call button
            Button {
                Task {
                    await viewModel.hangupCall()
                }
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.title)
                    .foregroundColor(.white)
                    .frame(width: 70, height: 70)
                    .background(Color.red)
                    .clipShape(Circle())
            }
            .padding(.bottom, 40)
        }
        .padding()
        .background(Color(.systemBackground))
        .onChange(of: viewModel.activeCallState) { newState in
            if newState == .none || newState == .ended {
                // Delay dismiss to show ended state briefly
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    if !viewModel.hasActiveCall {
                        dismiss()
                    }
                }
            }
        }
    }

    private var callStatusText: String {
        switch viewModel.activeCallState {
        case .none: return ""
        case .initiating: return "Connecting..."
        case .ringing: return "Ringing..."
        case .connected, .recording: return "Connected"
        case .ended: return "Call Ended"
        case .error(let msg): return msg
        }
    }
}

struct CallControlButton: View {
    let icon: String
    let label: String
    let color: Color
    var isActive: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundColor(isActive ? .white : color)
                    .frame(width: 60, height: 60)
                    .background(isActive ? color : Color(.systemGray5))
                    .clipShape(Circle())

                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}

// MARK: - Error View

struct ErrorView: View {
    let message: String
    let retryAction: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 50))
                .foregroundColor(.orange)

            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button("Retry") {
                retryAction()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    PhoneView()
        .environmentObject(SummaryAIAPIClient())
}
