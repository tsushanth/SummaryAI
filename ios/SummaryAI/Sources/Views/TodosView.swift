import SwiftUI
import Speech
import AVFoundation

// MARK: - Todos View

struct TodosView: View {
    @ObservedObject var viewModel: TodosViewModel
    @State private var showAddTodoSheet = false
    @State private var showVoiceRecording = false

    var body: some View {
        VStack(spacing: 0) {
            // Filter tabs
            filterTabsView

            // Content
            contentView
        }
        .sheet(isPresented: $showAddTodoSheet) {
            AddTodoSheet(viewModel: viewModel)
                .presentationDetents([.height(250)])
                .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $showVoiceRecording) {
            VoiceTodoRecordingView(viewModel: viewModel)
        }
        .task {
            if viewModel.todos.isEmpty {
                await viewModel.loadTodos()
            }
        }
        .refreshable {
            await viewModel.refreshTodos()
        }
        .alert("Error", isPresented: $viewModel.showError) {
            Button("OK", role: .cancel) {
                viewModel.clearError()
            }
        } message: {
            Text(viewModel.errorMessage ?? "An error occurred")
        }
    }

    // MARK: - Filter Tabs

    private var filterTabsView: some View {
        HStack(spacing: 4) {
            ForEach(TodosFilter.allCases, id: \.self) { filter in
                TodoFilterButton(
                    title: filter.title,
                    count: countForFilter(filter),
                    isSelected: viewModel.selectedFilter == filter
                ) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        viewModel.selectedFilter = filter
                    }
                }
            }

            Spacer()

            // Voice add button
            Button {
                showVoiceRecording = true
            } label: {
                Image(systemName: "mic.fill")
                    .font(.body)
                    .foregroundColor(.blue)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Manual add button
            Button {
                showAddTodoSheet = true
            } label: {
                Image(systemName: "plus.circle.fill")
                    .font(.title3)
                    .foregroundColor(.blue)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(.systemBackground))
    }

    private func countForFilter(_ filter: TodosFilter) -> Int {
        switch filter {
        case .all: return viewModel.todos.count
        case .active: return viewModel.activeTodosCount
        case .completed: return viewModel.completedTodosCount
        }
    }

    // MARK: - Content View

    @ViewBuilder
    private var contentView: some View {
        switch viewModel.state {
        case .idle, .loading:
            loadingView
        case .loaded:
            if viewModel.filteredTodos.isEmpty {
                emptyFilterView
            } else {
                todoListView
            }
        case .empty:
            emptyView
        case .error(let message):
            errorView(message: message)
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
            Text("Loading todos...")
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Todo List View

    private var todoListView: some View {
        List {
            ForEach(viewModel.filteredTodos) { todo in
                TodoRowView(todo: todo) {
                    Task { await viewModel.toggleTodo(todo) }
                }
                .task {
                    await viewModel.loadMoreIfNeeded(currentItem: todo)
                }
            }
            .onDelete { offsets in
                Task { await viewModel.deleteTodos(at: offsets) }
            }

            // Loading more indicator
            if viewModel.hasMorePages {
                HStack {
                    Spacer()
                    ProgressView()
                        .padding()
                    Spacer()
                }
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
    }

    // MARK: - Empty View

    private var emptyView: some View {
        VStack(spacing: 24) {
            ZStack {
                Circle()
                    .fill(Color.green.opacity(0.1))
                    .frame(width: 120, height: 120)

                Image(systemName: "checklist")
                    .font(.system(size: 60))
                    .foregroundColor(.green)
            }

            VStack(spacing: 8) {
                Text("No todos yet")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Tap the microphone to speak your tasks, or tap + to add manually")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            HStack(spacing: 16) {
                Button {
                    showVoiceRecording = true
                } label: {
                    Label("Voice", systemImage: "mic.fill")
                        .font(.headline)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    showAddTodoSheet = true
                } label: {
                    Label("Add", systemImage: "plus")
                        .font(.headline)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Empty Filter View

    private var emptyFilterView: some View {
        VStack(spacing: 16) {
            Image(systemName: viewModel.selectedFilter == .completed ? "checkmark.circle" : "circle")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text(viewModel.selectedFilter == .completed ? "No completed todos" : "No active todos")
                .font(.headline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 60))
                .foregroundColor(.orange)

            VStack(spacing: 8) {
                Text("Something Went Wrong")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text(message)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await viewModel.loadTodos() }
            } label: {
                Label("Try Again", systemImage: "arrow.clockwise")
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Todo Filter Button

struct TodoFilterButton: View {
    let title: String
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 2) {
                Text(title)
                    .font(.caption2)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)

                if count > 0 {
                    Text("\(count)")
                        .font(.caption2)
                        .fontWeight(.medium)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(isSelected ? Color.white.opacity(0.3) : Color.secondary.opacity(0.2))
                        .cornerRadius(4)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(isSelected ? Color.blue : Color(.secondarySystemBackground))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(10)
        }
    }
}

// MARK: - Todo Row View

struct TodoRowView: View {
    let todo: TodoItem
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Checkbox
            Button(action: onToggle) {
                Image(systemName: todo.isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundColor(todo.isCompleted ? .green : .secondary)
            }
            .buttonStyle(.plain)

            // Todo content
            VStack(alignment: .leading, spacing: 4) {
                Text(todo.title)
                    .font(.body)
                    .strikethrough(todo.isCompleted)
                    .foregroundColor(todo.isCompleted ? .secondary : .primary)

                if let description = todo.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                HStack(spacing: 8) {
                    // Priority badge
                    HStack(spacing: 2) {
                        Image(systemName: todo.priority.icon)
                            .font(.caption2)
                        Text(todo.priority.displayName)
                            .font(.caption2)
                    }
                    .foregroundColor(priorityColor)

                    // Due date if set
                    if let dueDate = todo.dueDate {
                        Text(dueDate.formatted(date: .abbreviated, time: .omitted))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private var priorityColor: Color {
        switch todo.priority {
        case .low: return .green
        case .medium: return .orange
        case .high: return .red
        }
    }
}

// MARK: - Add Todo Sheet

struct AddTodoSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: TodosViewModel
    @State private var title = ""
    @State private var selectedPriority: TodoPriority = .medium

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TextField("What do you need to do?", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .font(.body)

                Picker("Priority", selection: $selectedPriority) {
                    ForEach(TodoPriority.allCases, id: \.self) { priority in
                        Text(priority.displayName).tag(priority)
                    }
                }
                .pickerStyle(.segmented)

                Spacer()
            }
            .padding()
            .navigationTitle("New Todo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            await viewModel.createTodo(title: title, priority: selectedPriority)
                            dismiss()
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

// MARK: - Voice Todo Recording View

struct VoiceTodoRecordingView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: TodosViewModel
    @StateObject private var speechRecognizer = SpeechRecognizer()
    @State private var isRecording = false
    @State private var transcribedText = ""
    @State private var showSaveConfirmation = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Instructions
                Text(isRecording ? "Listening..." : "Tap the microphone and speak your todos")
                    .font(.headline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)

                // Transcribed text
                if !transcribedText.isEmpty {
                    ScrollView {
                        Text(transcribedText)
                            .font(.body)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(12)
                    }
                    .frame(maxHeight: 200)
                } else {
                    Text("Your spoken todos will appear here")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .frame(height: 100)
                }

                Spacer()

                // Recording button
                Button {
                    if isRecording {
                        stopRecording()
                    } else {
                        startRecording()
                    }
                } label: {
                    ZStack {
                        Circle()
                            .fill(isRecording ? Color.red : Color.blue)
                            .frame(width: 80, height: 80)

                        if isRecording {
                            // Pulsing animation
                            Circle()
                                .stroke(Color.red.opacity(0.5), lineWidth: 4)
                                .frame(width: 100, height: 100)
                                .scaleEffect(isRecording ? 1.2 : 1.0)
                                .opacity(isRecording ? 0 : 1)
                                .animation(.easeInOut(duration: 1).repeatForever(autoreverses: false), value: isRecording)
                        }

                        Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 30))
                            .foregroundColor(.white)
                    }
                }

                // Tips
                VStack(spacing: 8) {
                    Text("Tips:")
                        .font(.caption)
                        .fontWeight(.semibold)

                    Text("Speak each task clearly. Separate tasks with phrases like 'next' or pause between items.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 40)

                Spacer()
            }
            .padding()
            .navigationTitle("Voice Todos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if isRecording {
                            stopRecording()
                        }
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveTodos()
                    }
                    .disabled(transcribedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .onAppear {
            speechRecognizer.requestAuthorization()
        }
        .onDisappear {
            if isRecording {
                stopRecording()
            }
        }
        .onChange(of: speechRecognizer.transcript) { _, newValue in
            transcribedText = newValue
        }
    }

    private func startRecording() {
        speechRecognizer.startTranscribing()
        isRecording = true
    }

    private func stopRecording() {
        speechRecognizer.stopTranscribing()
        isRecording = false
    }

    private func saveTodos() {
        guard !transcribedText.isEmpty else { return }

        Task {
            let _ = await viewModel.createTodosFromText(transcribedText)
            dismiss()
        }
    }
}

// MARK: - Speech Recognizer

@MainActor
class SpeechRecognizer: ObservableObject {
    @Published var transcript = ""
    @Published var isAvailable = false

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

    func requestAuthorization() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                self?.isAvailable = status == .authorized
            }
        }
    }

    func startTranscribing() {
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            return
        }

        // Reset
        transcript = ""
        recognitionTask?.cancel()
        recognitionTask = nil

        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("Audio session error: \(error)")
            return
        }

        // Create recognition request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else { return }

        recognitionRequest.shouldReportPartialResults = true

        // Start audio engine
        audioEngine = AVAudioEngine()
        guard let audioEngine = audioEngine else { return }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            recognitionRequest.append(buffer)
        }

        audioEngine.prepare()

        do {
            try audioEngine.start()
        } catch {
            print("Audio engine error: \(error)")
            return
        }

        // Start recognition
        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                DispatchQueue.main.async {
                    self.transcript = result.bestTranscription.formattedString
                }
            }

            if error != nil || result?.isFinal == true {
                self.stopTranscribing()
            }
        }
    }

    func stopTranscribing() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil
    }
}

// MARK: - Preview

#if DEBUG
struct TodosView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            TodosView(viewModel: TodosViewModel(apiClient: SummaryAIAPIClient()))
        }
    }
}
#endif
