import { Sidebar } from '@/components/layout/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col bg-background md:flex-row">
      <Sidebar />
      <main id="main" className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
