import Foundation
import Combine

// MARK: - Todos View State

enum TodosViewState: Equatable {
    case idle
    case loading
    case loaded
    case empty
    case error(String)
}

// MARK: - Todos Filter

enum TodosFilter: String, CaseIterable {
    case all
    case active
    case completed

    var title: String {
        switch self {
        case .all: return "All"
        case .active: return "Active"
        case .completed: return "Completed"
        }
    }
}

// MARK: - Todos View Model

@MainActor
class TodosViewModel: ObservableObject {
    // MARK: - Properties

    private let apiClient: SummaryAIAPIClient

    @Published private(set) var todos: [TodoItem] = []
    @Published private(set) var state: TodosViewState = .idle
    @Published var selectedFilter: TodosFilter = .all
    @Published var showError = false
    @Published var errorMessage: String?

    // Pagination
    private var currentPage = 1
    private var totalPages = 1
    @Published private(set) var hasMorePages = false
    private var isLoadingMore = false

    // MARK: - Computed Properties

    var filteredTodos: [TodoItem] {
        switch selectedFilter {
        case .all:
            return todos
        case .active:
            return todos.filter { !$0.isCompleted }
        case .completed:
            return todos.filter { $0.isCompleted }
        }
    }

    var activeTodosCount: Int {
        todos.filter { !$0.isCompleted }.count
    }

    var completedTodosCount: Int {
        todos.filter { $0.isCompleted }.count
    }

    // MARK: - Initialization

    init(apiClient: SummaryAIAPIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Load Todos

    func loadTodos() async {
        guard state != .loading else { return }

        state = .loading
        currentPage = 1

        do {
            let response = try await apiClient.getTodos(page: 1, perPage: 50)
            todos = response.todos
            totalPages = response.meta.totalPages
            hasMorePages = response.meta.page < response.meta.totalPages

            state = todos.isEmpty ? .empty : .loaded
        } catch {
            state = .error(error.localizedDescription)
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    func refreshTodos() async {
        currentPage = 1
        do {
            let response = try await apiClient.getTodos(page: 1, perPage: 50)
            todos = response.todos
            totalPages = response.meta.totalPages
            hasMorePages = response.meta.page < response.meta.totalPages
            state = todos.isEmpty ? .empty : .loaded
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    func loadMoreIfNeeded(currentItem: TodoItem) async {
        guard hasMorePages,
              !isLoadingMore,
              let lastTodo = filteredTodos.last,
              lastTodo.id == currentItem.id else {
            return
        }

        isLoadingMore = true
        currentPage += 1

        do {
            let response = try await apiClient.getTodos(page: currentPage, perPage: 50)
            todos.append(contentsOf: response.todos)
            hasMorePages = response.meta.page < response.meta.totalPages
        } catch {
            currentPage -= 1
            print("Failed to load more todos: \(error)")
        }

        isLoadingMore = false
    }

    // MARK: - Create Todo

    func createTodo(title: String, priority: TodoPriority = .medium) async {
        let request = CreateTodoRequest(title: title, priority: priority)

        do {
            let todo = try await apiClient.createTodo(request: request)
            todos.insert(todo, at: 0)
            state = .loaded
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    func createTodosFromText(_ text: String, recordingId: String? = nil) async -> [TodoItem] {
        let request = CreateTodosFromTextRequest(text: text, recordingId: recordingId)

        do {
            let newTodos = try await apiClient.createTodosFromText(request: request)
            todos.insert(contentsOf: newTodos, at: 0)
            state = todos.isEmpty ? .empty : .loaded
            return newTodos
        } catch {
            errorMessage = error.localizedDescription
            showError = true
            return []
        }
    }

    // MARK: - Toggle Todo

    func toggleTodo(_ todo: TodoItem) async {
        // Optimistically update UI
        if let index = todos.firstIndex(where: { $0.id == todo.id }) {
            var updatedTodo = todos[index]
            updatedTodo.isCompleted.toggle()
            updatedTodo.completedAt = updatedTodo.isCompleted ? Date() : nil
            todos[index] = updatedTodo
        }

        do {
            let updatedTodo = try await apiClient.toggleTodo(id: todo.id)
            // Update with server response
            if let index = todos.firstIndex(where: { $0.id == todo.id }) {
                todos[index] = updatedTodo
            }
        } catch {
            // Revert on error
            if let index = todos.firstIndex(where: { $0.id == todo.id }) {
                todos[index] = todo
            }
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    // MARK: - Delete Todo

    func deleteTodo(_ todo: TodoItem) async {
        // Optimistically remove
        let originalTodos = todos
        todos.removeAll { $0.id == todo.id }

        if todos.isEmpty {
            state = .empty
        }

        do {
            try await apiClient.deleteTodo(id: todo.id)
        } catch {
            // Revert on error
            todos = originalTodos
            state = .loaded
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    func deleteTodos(at offsets: IndexSet) async {
        let todosToDelete = offsets.map { filteredTodos[$0] }

        for todo in todosToDelete {
            await deleteTodo(todo)
        }
    }

    // MARK: - Clear Error

    func clearError() {
        showError = false
        errorMessage = nil
    }
}
