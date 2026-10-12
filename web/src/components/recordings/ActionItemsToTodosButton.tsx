'use client';

import { useState } from 'react';
import { ListPlus, Loader2 } from 'lucide-react';
import { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { actionItemsToTodos } from '@/lib/api/intelligence';

/** Creates todos from the summary's action items (server skips ones already added). */
export function ActionItemsToTodosButton({ recordingId }: { recordingId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { todos, skipped } = await actionItemsToTodos(recordingId);
      const added = todos.length;
      setMessage({
        text:
          added === 0
            ? 'All action items are already in your todos'
            : skipped > 0
              ? `Added ${added} to your todos (${skipped} already there)`
              : `Added ${added} to your todos`,
        error: false,
      });
      // Refresh any cached todo lists (keys all start with 'todos')
      void mutate((key) => Array.isArray(key) && key[0] === 'todos');
    } catch {
      setMessage({ text: 'Could not add action items to todos', error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ListPlus className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {busy ? 'Adding...' : 'Add to my todos'}
      </Button>
      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={message.error ? 'mt-2 text-sm text-destructive' : 'mt-2 text-sm text-muted-foreground'}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
