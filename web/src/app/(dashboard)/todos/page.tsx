'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TodoList } from '@/components/todos/TodoList';
import { TodoForm } from '@/components/todos/TodoForm';
import { TodoFilters } from '@/components/todos/TodoFilters';
import { useTodos } from '@/hooks/useTodos';

export default function TodosPage() {
  const [filter, setFilter] = useState('all');
  const { todos, isLoading, addTodo, editTodo, removeTodo, toggleTodo } = useTodos(
    filter !== 'all' ? { status: filter } : undefined
  );

  const handleAddTodo = async (title: string) => {
    await addTodo({ title });
  };

  const handleEditTodo = (id: string, title: string) => {
    editTodo(id, { title });
  };

  // Filter todos client-side for immediate feedback
  const filteredTodos = filter === 'all'
    ? todos
    : todos.filter((todo) => todo.status === filter);

  // Group todos by status for display
  const pendingTodos = filteredTodos.filter((t) => t.status === 'pending');
  const inProgressTodos = filteredTodos.filter((t) => t.status === 'in_progress');
  const completedTodos = filteredTodos.filter((t) => t.status === 'completed');

  const stats = {
    total: todos.length,
    pending: todos.filter((t) => t.status === 'pending').length,
    inProgress: todos.filter((t) => t.status === 'in_progress').length,
    completed: todos.filter((t) => t.status === 'completed').length,
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Todos</h1>
        <p className="text-gray-500">Manage your action items from recordings</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-sm text-gray-500">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
            <p className="text-sm text-gray-500">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
            <p className="text-sm text-gray-500">In Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
            <p className="text-sm text-gray-500">Completed</p>
          </CardContent>
        </Card>
      </div>

      {/* Add Todo Form */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <TodoForm onSubmit={handleAddTodo} disabled={isLoading} />
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="mb-6">
        <TodoFilters currentFilter={filter} onFilterChange={setFilter} />
      </div>

      {/* Todo List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : filter === 'all' ? (
        <div className="space-y-6">
          {inProgressTodos.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 mb-3">In Progress</h2>
              <TodoList
                todos={inProgressTodos}
                onToggle={toggleTodo}
                onEdit={handleEditTodo}
                onDelete={removeTodo}
              />
            </div>
          )}
          {pendingTodos.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 mb-3">Pending</h2>
              <TodoList
                todos={pendingTodos}
                onToggle={toggleTodo}
                onEdit={handleEditTodo}
                onDelete={removeTodo}
              />
            </div>
          )}
          {completedTodos.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 mb-3">Completed</h2>
              <TodoList
                todos={completedTodos}
                onToggle={toggleTodo}
                onEdit={handleEditTodo}
                onDelete={removeTodo}
              />
            </div>
          )}
          {filteredTodos.length === 0 && (
            <TodoList
              todos={[]}
              onToggle={toggleTodo}
              onEdit={handleEditTodo}
              onDelete={removeTodo}
            />
          )}
        </div>
      ) : (
        <TodoList
          todos={filteredTodos}
          onToggle={toggleTodo}
          onEdit={handleEditTodo}
          onDelete={removeTodo}
        />
      )}
    </div>
  );
}
