'use client';

import { Chip } from '@/components/ui/chip';

interface TodoFiltersProps {
  currentFilter: string;
  onFilterChange: (filter: string) => void;
}

const filters = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
];

export function TodoFilters({ currentFilter, onFilterChange }: TodoFiltersProps) {
  return (
    <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter todos">
      {filters.map((filter) => (
        <Chip
          key={filter.value}
          selected={currentFilter === filter.value}
          onClick={() => onFilterChange(filter.value)}
        >
          {filter.label}
        </Chip>
      ))}
    </div>
  );
}
