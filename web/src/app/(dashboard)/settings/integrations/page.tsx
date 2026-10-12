'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { IntegrationsSettings } from '@/components/integrations/IntegrationsSettings';

export default function IntegrationsPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Settings
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Send summaries elsewhere</h1>
        <p className="text-muted-foreground">Webhook, Slack, Notion</p>
      </div>
      <IntegrationsSettings />
    </div>
  );
}
