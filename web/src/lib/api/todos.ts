import { apiClient } from './client';
import type { CreateTodoRequest, UpdateTodoRequest, ListTodosResponse, Todo } from '@/types/api';

export async function getTodos(status?: string): Promise<ListTodosResponse> {
  const searchParams = new URLSearchParams();
  if (status && status !== 'all') {
    searchParams.set('status', status);
  }

  const query = searchParams.toString();
  return apiClient<ListTodosResponse>(`/api/todos${query ? `?${query}` : ''}`);
}

export async function getTodosByRecording(recordingId: string): Promise<ListTodosResponse> {
  return apiClient<ListTodosResponse>(`/api/recordings/${recordingId}/todos`);
}

export async function createTodo(data: CreateTodoRequest): Promise<Todo> {
  const response = await apiClient<{ todo: Todo }>('/api/todos', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.todo;
}

export async function updateTodo(
  id: string,
  data: UpdateTodoRequest
): Promise<Todo> {
  const response = await apiClient<{ todo: Todo }>(`/api/todos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return response.todo;
}

export async function toggleTodo(id: string): Promise<Todo> {
  const response = await apiClient<{ todo: Todo }>(`/api/todos/${id}/toggle`, {
    method: 'POST',
  });
  return response.todo;
}

export async function deleteTodo(id: string): Promise<void> {
  await apiClient(`/api/todos/${id}`, {
    method: 'DELETE',
  });
}
