'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { chatAcrossMeetings } from '@/lib/api/intelligence';
import type { ChatCitation } from '@/types/api';

interface Message {
  id: number;
  question: string;
  answer: string | null;
  citations: ChatCitation[];
  failed: boolean;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const nextId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const asking = messages.some((m) => m.answer === null && !m.failed);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length]);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (question.length < 3 || asking) return;
    const id = nextId.current++;
    setInput('');
    setMessages((prev) => [...prev, { id, question, answer: null, citations: [], failed: false }]);
    try {
      const res = await chatAcrossMeetings(question);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, answer: res.answer || '...', citations: res.citations ?? [] } : m))
      );
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, failed: true } : m)));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-4 py-5 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Ask your meetings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Answers come from your summaries and transcripts, with links to the meetings they came from.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <EmptyState
              icon={<MessageSquare />}
              title="Ask across all your meetings"
              message="Try: What did we decide about pricing? Who owes me a reply? What came up in last week's calls with Acme?"
            />
          )}
          {messages.map((m) => (
            <div key={m.id} className="space-y-2">
              <p className="text-base font-semibold text-foreground">{m.question}</p>
              <Card className="border-l-[3px] border-l-primary">
                <CardContent className="pt-4">
                  {m.failed ? (
                    <p role="alert" className="text-sm text-destructive">
                      Could not get an answer. Try again.
                    </p>
                  ) : m.answer === null ? (
                    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Searching your meetings...
                    </p>
                  ) : (
                    <p className="minute whitespace-pre-wrap text-foreground/90">{m.answer}</p>
                  )}
                </CardContent>
              </Card>
              {m.citations.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Sources</p>
                  <ul className="space-y-2">
                    {m.citations.map((c, i) => (
                      <li key={`${c.recording_id}-${i}`}>
                        <Link
                          href={`/recordings/${c.recording_id}`}
                          className="block rounded-md border border-border bg-card p-3 hover:bg-accent"
                        >
                          <span className="block truncate text-sm font-medium">{c.title || 'Recording'}</span>
                          {c.snippet && (
                            <span className="mt-0.5 line-clamp-3 block text-xs text-muted-foreground">
                              {c.snippet}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={ask} className="border-t border-border bg-card p-3 sm:p-4">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your meetings..."
            aria-label="Question"
            maxLength={1000}
            className="h-11 flex-1"
          />
          <Button type="submit" disabled={input.trim().length < 3 || asking}>
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            Ask
          </Button>
        </div>
      </form>
    </div>
  );
}
