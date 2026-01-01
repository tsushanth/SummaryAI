import SwiftUI

// MARK: - Search View

/// Dedicated search view for finding content across recordings
struct SearchView: View {
    @StateObject private var viewModel = SearchViewModel()
    @State private var isSearchFieldFocused = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                searchBar

                Divider()

                // Content
                Group {
                    switch viewModel.state {
                    case .idle:
                        if viewModel.searchQuery.isEmpty {
                            recentSearchesView
                        } else {
                            emptyPromptView
                        }

                    case .searching:
                        searchingView

                    case .results:
                        searchResultsView

                    case .empty:
                        noResultsView

                    case .error(let message):
                        errorView(message: message)
                    }
                }
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if !viewModel.searchQuery.isEmpty {
                        Button("Clear") {
                            viewModel.clearSearch()
                        }
                    }
                }
            }
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)

            TextField("Search transcripts...", text: $viewModel.searchQuery)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            if !viewModel.searchQuery.isEmpty {
                Button {
                    viewModel.clearSearch()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .padding()
    }

    // MARK: - Recent Searches

    private var recentSearchesView: some View {
        Group {
            if viewModel.recentSearches.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 48))
                        .foregroundColor(.secondary)

                    Text("Search Recordings")
                        .font(.headline)

                    Text("Find specific content in your transcripts by entering keywords above.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    Section {
                        ForEach(viewModel.recentSearches, id: \.self) { query in
                            Button {
                                viewModel.searchRecent(query)
                            } label: {
                                HStack {
                                    Image(systemName: "clock.arrow.circlepath")
                                        .foregroundColor(.secondary)

                                    Text(query)
                                        .foregroundColor(.primary)

                                    Spacer()

                                    Image(systemName: "arrow.up.left")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    } header: {
                        HStack {
                            Text("Recent Searches")
                            Spacer()
                            Button("Clear") {
                                viewModel.clearRecentSearches()
                            }
                            .font(.caption)
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
    }

    // MARK: - Empty Prompt

    private var emptyPromptView: some View {
        VStack(spacing: 12) {
            Text("Enter at least 2 characters to search")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Searching

    private var searchingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)

            Text("Searching...")
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Search Results

    private var searchResultsView: some View {
        List {
            ForEach(viewModel.results) { result in
                SearchResultRow(
                    result: result,
                    formatTimestamp: viewModel.formatTimestamp
                )
            }
        }
        .listStyle(.plain)
    }

    // MARK: - No Results

    private var noResultsView: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No Results")
                .font(.headline)

            Text("No matches found for \"\(viewModel.searchQuery)\"")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Text("Try different keywords or check your spelling.")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(.orange)

            Text("Search Failed")
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button("Try Again") {
                Task {
                    await viewModel.performSearch(query: viewModel.searchQuery)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Search Result Row

struct SearchResultRow: View {
    let result: SearchResult
    let formatTimestamp: (Double) -> String

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Recording header
            NavigationLink {
                RecordingDetailView(recordingId: result.recording.id)
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(result.recording.title)
                            .font(.headline)
                            .foregroundColor(.primary)

                        HStack(spacing: 8) {
                            Text(result.recording.createdAt.formatted(date: .abbreviated, time: .omitted))
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text("•")
                                .foregroundColor(.secondary)

                            Text("\(result.matchCount) match\(result.matchCount == 1 ? "" : "es")")
                                .font(.caption)
                                .foregroundColor(.orange)
                        }
                    }

                    Spacer()
                }
            }

            // Matching segments preview
            if !result.matchingSegments.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    // Show first 2 matches, or all if expanded
                    let segmentsToShow = isExpanded
                        ? result.matchingSegments
                        : Array(result.matchingSegments.prefix(2))

                    ForEach(segmentsToShow) { segment in
                        NavigationLink {
                            RecordingDetailView(recordingId: result.recording.id)
                            // TODO: Pass segment to jump to timestamp
                        } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Text(formatTimestamp(segment.startTime))
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .foregroundColor(.blue)
                                    .frame(width: 40, alignment: .leading)

                                Text(segment.highlightedText)
                                    .font(.subheadline)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                            }
                            .padding(8)
                            .background(Color(.tertiarySystemBackground))
                            .cornerRadius(8)
                        }
                        .buttonStyle(.plain)
                    }

                    // Show more/less button
                    if result.matchingSegments.count > 2 {
                        Button {
                            withAnimation {
                                isExpanded.toggle()
                            }
                        } label: {
                            HStack {
                                Text(isExpanded ? "Show less" : "Show \(result.matchingSegments.count - 2) more")
                                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            }
                            .font(.caption)
                            .foregroundColor(.blue)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Searchable Modifier for RecordingsListView

/// Extension to add search bar to recordings list
struct SearchableRecordingsModifier: ViewModifier {
    @State private var showSearch = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        showSearch = true
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                }
            }
            .sheet(isPresented: $showSearch) {
                SearchView()
            }
    }
}

extension View {
    func searchableRecordings() -> some View {
        modifier(SearchableRecordingsModifier())
    }
}

// MARK: - Preview

#if DEBUG
struct SearchView_Previews: PreviewProvider {
    static var previews: some View {
        SearchView()
    }
}
#endif
