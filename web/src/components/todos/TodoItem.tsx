'use client';

import { useState } from 'react';
import { Check, Trash2, Edit2, X, Link, User, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/chip';
import { cn } from '@/lib/utils/cn';
import type { Todo } from '@/types/api';

/** Optional extra fields edited alongside the title. due_date is YYYY-MM-DD or ''. */
export interface TodoExtras {
  assignee: string;
  due_date: string;
}

interface TodoItemProps {
  todo: Todo;
  onToggle: () => void;
  onEdit: (title: string, extras?: TodoExtras) => void;
  onDelete: () => void;
}

/** Calendar date part of a date or ISO datetime string. */
function dateOnly(value: string | null | undefined): string {
  return value && value.length >= 10 ? value.slice(0, 10) : '';
}

export function TodoItem({ todo, onToggle, onEdit, onDelete }: TodoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editAssignee, setEditAssignee] = useState(todo.assignee ?? '');
  const [editDue, setEditDue] = useState(dateOnly(todo.due_date));

  const handleSave = () => {
    const title = editTitle.trim();
    const assignee = editAssignee.trim();
    const changed =
      title !== todo.title ||
      assignee !== (todo.assignee ?? '') ||
      editDue !== dateOnly(todo.due_date);
    if (title && changed) {
      onEdit(title, { assignee, due_date: editDue });
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(todo.title);
    setEditAssignee(todo.assignee ?? '');
    setEditDue(dateOnly(todo.due_date));
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const isCompleted = todo.status === 'completed';
  const due = dateOnly(todo.due_date);

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 bg-card border rounded-lg group transition-colors',
        isCompleted ? 'bg-muted' : 'hover:border-input'
      )}
    >
      <button
        onClick={onToggle}
        aria-label={isCompleted ? 'Mark as not completed' : 'Mark as completed'}
        className={cn(
          'flex-shrink-0 w-5 h-5 rounded-full border-2 transition-colors',
          isCompleted
            ? 'bg-success border-success text-success-foreground'
            : 'border-input hover:border-success'
        )}
      >
        {isCompleted && <Check className="h-3 w-3 m-auto" />}
      </button>

      {isEditing ? (
        <div className="flex-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            aria-label="Todo title"
            className="flex-1 min-w-[12rem]"
          />
          <Input
            value={editAssignee}
            onChange={(e) => setEditAssignee(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Assignee"
            aria-label="Assignee"
            maxLength={200}
            className="sm:w-40"
          />
          <Input
            type="date"
            value={editDue}
            onChange={(e) => setEditDue(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Due date"
            className="sm:w-40"
          />
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancel} aria-label="Cancel edit">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                'text-sm',
                isCompleted ? 'text-muted-foreground line-through' : 'text-foreground'
              )}
            >
              {todo.title}
            </p>
            {(todo.assignee || due || todo.recording_id) && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {todo.assignee && (
                  <StatusPill>
                    <User className="mr-1 h-3 w-3" aria-hidden="true" />
                    {todo.assignee}
                  </StatusPill>
                )}
                {due && (
                  <StatusPill>
                    <CalendarDays className="mr-1 h-3 w-3" aria-hidden="true" />
                    Due {due}
                  </StatusPill>
                )}
                {todo.recording_id && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Link className="h-3 w-3" />
                    Linked to recording
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              onClick={() => setIsEditing(true)}
              aria-label="Edit todo"
              className="p-1.5 text-muted-foreground hover:text-muted-foreground hover:bg-accent rounded"
            >
              <Edit2 className="h-4 w-4" />
            </button>
            <button
              onClick={onDelete}
              aria-label="Delete todo"
              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
