'use client';

import { CheckCircle } from 'lucide-react';
import { TodoItem } from './TodoItem';
import type { Todo } from '@/types/api';

interface TodoListProps {
  todos: Todo[];
  onToggle: (id: string) => void;
  onEdit: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function TodoList({ todos, onToggle, onEdit, onDelete }: TodoListProps) {
  if (todos.length === 0) {
    return (
      <div className="text-center py-12">
        <CheckCircle className="h-12 w-12 mx-auto text-gray-300 mb-3" />
        <p className="text-gray-500">No todos found</p>
        <p className="text-sm text-gray-400">Add a new todo above to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {todos.map((todo) => (
        <TodoItem
          key={todo.id}
          todo={todo}
          onToggle={() => onToggle(todo.id)}
          onEdit={(title) => onEdit(todo.id, title)}
          onDelete={() => onDelete(todo.id)}
        />
      ))}
    </div>
  );
}
