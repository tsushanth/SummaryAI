'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIntegrations } from '@/hooks/useIntegrations';
import {
  removeIntegration,
  saveIntegration,
  testIntegration,
  type IntegrationKind,
  type IntegrationView,
} from '@/lib/api/integrations';

interface KindSpec {
  kind: IntegrationKind;
  title: string;
  showUrl: boolean;
  urlLabel: string;
  urlPlaceholder: string;
  showSecret: boolean;
  secretLabel: string;
  showDatabase: boolean;
}

const SPECS: KindSpec[] = [
  {
    kind: 'webhook',
    title: 'Webhook',
    showUrl: true,
    urlLabel: 'Webhook URL (https)',
    urlPlaceholder: 'https://',
    showSecret: true,
    secretLabel: 'Signing secret (optional)',
    showDatabase: false,
  },
  {
    kind: 'slack',
    title: 'Slack',
    showUrl: true,
    urlLabel: 'Slack incoming webhook URL',
    urlPlaceholder: 'https://hooks.slack.com/services/...',
    showSecret: false,
    secretLabel: '',
    showDatabase: false,
  },
  {
    kind: 'notion',
    title: 'Notion',
    showUrl: false,
    urlLabel: '',
    urlPlaceholder: '',
    showSecret: true,
    secretLabel: 'Notion integration token',
    showDatabase: true,
  },
];

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function IntegrationCard({ spec, state, onChanged }: { spec: KindSpec; state?: IntegrationView; onChanged: () => Promise<void> }) {
  // Secrets are write-only: fields start empty and saved values are never shown.
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [databaseId, setDatabaseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ text, error: false });
      await onChanged();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Something went wrong', error: true });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await saveIntegration(spec.kind, {
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(secret.trim() ? { secret: secret.trim() } : {}),
        ...(databaseId.trim() ? { database_id: databaseId.trim() } : {}),
      });
      setUrl('');
      setSecret('');
      setDatabaseId('');
      return 'Saved';
    });

  const toggle = () =>
    run(async () => {
      await saveIntegration(spec.kind, { enabled: !state?.enabled });
    });

  const test = () =>
    run(async () => {
      const r = await testIntegration(spec.kind);
      return r.ok ? 'Test delivered' : `Test failed: ${r.error ?? 'unknown error'}`;
    });

  const remove = () =>
    run(async () => {
      await removeIntegration(spec.kind);
      return 'Removed';
    });

  const configured = !!state?.configured;
  const keep = 'Enter a new value to replace';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          {spec.title}
          {configured && (
            <span className="text-xs font-normal text-muted-foreground">
              {state?.enabled ? 'Enabled' : 'Disabled'}
            </span>
          )}
        </CardTitle>
        {configured && (
          <CardDescription>
            Configured{state?.display_host ? ` (${state.display_host})` : ''}
            {state?.database_id ? ` · database ${state.database_id}` : ''}
            {state?.last_status ? ` · last delivery: ${state.last_status}${state.last_error ? ` (${state.last_error})` : ''}` : ''}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {spec.showUrl && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{spec.urlLabel}</span>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={configured ? keep : spec.urlPlaceholder}
              autoComplete="off"
              inputMode="url"
            />
          </label>
        )}
        {spec.showSecret && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{spec.secretLabel}</span>
            <div className="flex gap-2">
              <Input
                type={spec.kind === 'notion' ? 'password' : 'text'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={state?.has_secret ? keep : ''}
                autoComplete="off"
              />
              {spec.kind === 'webhook' && (
                <Button type="button" variant="outline" onClick={() => setSecret(randomSecret())}>
                  Generate
                </Button>
              )}
            </div>
            {spec.kind === 'webhook' && secret && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Copy this now. After saving it is never shown again.
              </span>
            )}
          </label>
        )}
        {spec.showDatabase && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Notion database ID</span>
            <Input
              value={databaseId}
              onChange={(e) => setDatabaseId(e.target.value)}
              placeholder={state?.database_id ? keep : ''}
              autoComplete="off"
            />
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={busy || (!url.trim() && !secret.trim() && !databaseId.trim())}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>
          {configured && (
            <>
              <Button variant="outline" onClick={test} disabled={busy}>
                Send test
              </Button>
              <Button variant="outline" onClick={toggle} disabled={busy}>
                {state?.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button variant="ghost" onClick={remove} disabled={busy} className="text-destructive">
                Remove
              </Button>
            </>
          )}
        </div>
        {message && (
          <p role="status" className={message.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function IntegrationsSettings() {
  const { integrations, deliveries, isLoading, error, refresh } = useIntegrations();

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        After each meeting is processed, MeetingMind can send the summary and action items to a webhook, Slack or
        Notion. Secrets are stored encrypted and are never shown again.
      </p>
      {error && <p className="text-sm text-destructive">Could not load integrations: {String(error.message ?? error)}</p>}
      {SPECS.map((spec) => (
        <IntegrationCard
          key={spec.kind}
          spec={spec}
          state={integrations.find((i) => i.kind === spec.kind)}
          onChanged={refresh}
        />
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery log</CardTitle>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deliveries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">When</th>
                    <th className="py-1 pr-3 font-medium">Integration</th>
                    <th className="py-1 pr-3 font-medium">Event</th>
                    <th className="py-1 pr-3 font-medium">Status</th>
                    <th className="py-1 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(d.created_at).toLocaleString()}</td>
                      <td className="py-1.5 pr-3 capitalize">{d.kind}</td>
                      <td className="py-1.5 pr-3">{d.event}</td>
                      <td className={d.status === 'success' ? 'py-1.5 pr-3' : 'py-1.5 pr-3 text-destructive'}>
                        {d.status}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {d.error ?? (d.response_status ? `HTTP ${d.response_status}` : '')}
                        {d.attempts > 1 ? ` · ${d.attempts} attempts` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
