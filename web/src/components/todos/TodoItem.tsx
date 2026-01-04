'use client';

import { useState } from 'react';
import { Check, Trash2, Edit2, X, Link } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import type { Todo } from '@/types/api';

interface TodoItemProps {
  todo: Todo;
  onToggle: () => void;
  onEdit: (title: string) => void;
  onDelete: () => void;
}

export function TodoItem({ todo, onToggle, onEdit, onDelete }: TodoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);

  const handleSave = () => {
    if (editTitle.trim() && editTitle !== todo.title) {
      onEdit(editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(todo.title);
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

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 bg-white border rounded-lg group transition-colors',
        isCompleted ? 'bg-gray-50' : 'hover:border-gray-300'
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          'flex-shrink-0 w-5 h-5 rounded-full border-2 transition-colors',
          isCompleted
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 hover:border-green-500'
        )}
      >
        {isCompleted && <Check className="h-3 w-3 m-auto" />}
      </button>

      {isEditing ? (
        <div className="flex-1 flex gap-2">
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="flex-1"
          />
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                'text-sm',
                isCompleted ? 'text-gray-400 line-through' : 'text-gray-900'
              )}
            >
              {todo.title}
            </p>
            {todo.recording_id && (
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                <Link className="h-3 w-3" />
                Linked to recording
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            >
              <Edit2 className="h-4 w-4" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
