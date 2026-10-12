'use client';

import useSWR from 'swr';
import { getFolders, getTags } from '@/lib/api/organize';

export function useFolders() {
  const { data, error, isLoading, mutate } = useSWR('folders', getFolders);
  return { folders: data ?? [], isLoading, error, refresh: mutate };
}

export function useTags() {
  const { data, error, isLoading, mutate } = useSWR('tags', getTags);
  return { tags: data ?? [], isLoading, error, refresh: mutate };
}
