import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertPreferences } from '@barleschailey/feed';
import { api, ApiError } from '../lib/api';

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled,
    staleTime: 30_000,
    retry: (count, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 403)) && count < 2,
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AlertPreferences>) => api.updatePreferences(patch),
    onSuccess: ({ preferences }) => {
      qc.setQueryData(['me'], (old: Awaited<ReturnType<typeof api.me>> | undefined) => (old ? { ...old, preferences } : old));
    },
  });
}
