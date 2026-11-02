/** Sidebar entries. Icons are mapped by name in components/layout/Sidebar.tsx so this file stays importable by node tests. */
export type NavIconName = 'Mic' | 'Search' | 'MessageSquare' | 'Calendar' | 'Phone' | 'ListTodo' | 'Settings';

export const NAV_ITEMS: { name: string; href: string; icon: NavIconName }[] = [
  { name: 'Recordings', href: '/recordings', icon: 'Mic' },
  { name: 'Search', href: '/search', icon: 'Search' },
  { name: 'Ask AI', href: '/chat', icon: 'MessageSquare' },
  { name: 'Meetings', href: '/meetings', icon: 'Calendar' },
  { name: 'Phone', href: '/phone', icon: 'Phone' },
  { name: 'Todos', href: '/todos', icon: 'ListTodo' },
  { name: 'Settings', href: '/settings', icon: 'Settings' },
];
