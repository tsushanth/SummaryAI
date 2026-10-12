'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TodoExtras } from './TodoItem';

interface TodoFormProps {
  onSubmit: (title: string, extras?: TodoExtras) => Promise<void>;
  disabled?: boolean;
}

export function TodoForm({ onSubmit, disabled }: TodoFormProps) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(title.trim(), { assignee: assignee.trim(), due_date: dueDate });
      setTitle('');
      setAssignee('');
      setDueDate('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        placeholder="Add a new todo..."
        aria-label="New todo"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={disabled || isSubmitting}
        className="flex-1"
      />
      <Input
        placeholder="Assignee"
        aria-label="Assignee"
        value={assignee}
        maxLength={200}
        onChange={(e) => setAssignee(e.target.value)}
        disabled={disabled || isSubmitting}
        className="sm:w-40"
      />
      <Input
        type="date"
        aria-label="Due date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        disabled={disabled || isSubmitting}
        className="sm:w-40"
      />
      <Button type="submit" disabled={!title.trim() || disabled || isSubmitting}>
        <Plus className="h-4 w-4 mr-1" />
        Add
      </Button>
    </form>
  );
}
