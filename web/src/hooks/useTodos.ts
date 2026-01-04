'use client';

import useSWR from 'swr';
import { getTodos, createTodo, updateTodo, deleteTodo, getTodosByRecording } from '@/lib/api/todos';
import type { Todo, CreateTodoRequest, UpdateTodoRequest } from '@/types/api';

export function useTodos(filters?: { status?: string; recording_id?: string }) {
  const key = filters?.recording_id
    ? ['todos', 'recording', filters.recording_id]
    : ['todos', filters?.status || 'all'];

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => {
      if (filters?.recording_id) {
        return getTodosByRecording(filters.recording_id);
      }
      return getTodos(filters?.status);
    },
    {
      revalidateOnFocus: false,
    }
  );

  const addTodo = async (request: CreateTodoRequest): Promise<Todo | null> => {
    try {
      const newTodo = await createTodo(request);
      mutate();
      return newTodo;
    } catch (error) {
      console.error('Error creating todo:', error);
      return null;
    }
  };

  const editTodo = async (id: string, request: UpdateTodoRequest): Promise<boolean> => {
    try {
      // Optimistic update
      if (data?.todos) {
        mutate(
          {
            ...data,
            todos: data.todos.map((todo) =>
              todo.id === id ? { ...todo, ...request } : todo
            ),
          },
          false
        );
      }

      await updateTodo(id, request);
      mutate();
      return true;
    } catch (error) {
      console.error('Error updating todo:', error);
      mutate(); // Revert on error
      return false;
    }
  };

  const removeTodo = async (id: string): Promise<boolean> => {
    try {
      // Optimistic update
      if (data?.todos) {
        mutate(
          {
            ...data,
            todos: data.todos.filter((todo) => todo.id !== id),
          },
          false
        );
      }

      await deleteTodo(id);
      mutate();
      return true;
    } catch (error) {
      console.error('Error deleting todo:', error);
      mutate(); // Revert on error
      return false;
    }
  };

  const toggleTodo = async (id: string): Promise<boolean> => {
    const todo = data?.todos?.find((t) => t.id === id);
    if (!todo) return false;

    const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
    return editTodo(id, { status: newStatus });
  };

  return {
    todos: data?.todos || [],
    isLoading,
    error,
    addTodo,
    editTodo,
    removeTodo,
    toggleTodo,
    refresh: mutate,
  };
}
