import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../lib/api';

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/** The live board. Polls every 15 s while the app is in the foreground. */
export function useActiveIncidents(includeSimulated = false) {
  const active = useAppActive();
  return useQuery({
    queryKey: ['incidents', 'active', includeSimulated],
    queryFn: () => api.incidents({ status: 'active', limit: 100, includeSimulated }),
    refetchInterval: active ? 15_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

export function useFeedStatus() {
  const active = useAppActive();
  return useQuery({ queryKey: ['feed-status'], queryFn: api.feedStatus, refetchInterval: active ? 15_000 : false, staleTime: 5_000 });
}

export function useIncident(id: string | undefined) {
  const active = useAppActive();
  return useQuery({
    queryKey: ['incident', id],
    queryFn: () => api.incident(id!),
    enabled: Boolean(id),
    refetchInterval: active ? 15_000 : false,
  });
}

export function useMyAlerts() {
  return useQuery({ queryKey: ['my-alerts'], queryFn: () => api.myAlerts(50), staleTime: 15_000 });
}
