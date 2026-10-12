'use client';

import Link from 'next/link';
import { Mic } from 'lucide-react';

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Simple header */}
      <header className="border-b">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-center">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Mic className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">Meeting Mind</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main>{children}</main>
    </div>
  );
}
