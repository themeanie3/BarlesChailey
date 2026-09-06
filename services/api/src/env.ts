export interface Env {
  // secrets
  DATABASE_URL: string;
  DATABASE_AUTHENTICATED_URL?: string;
  PUSH_SECRET: string;
  GOOGLE_MAPS_API_KEY?: string;
  EXPO_ACCESS_TOKEN?: string;
  API_KEY_PEPPER: string;
  // vars
  APP_ENV: 'development' | 'staging' | 'production';
  FEED_SOURCE: string;
  FEED_TIMEZONE: string;
  STALE_AFTER_SECONDS: string;
  CLEAR_GRACE_SECONDS: string;
  NEON_AUTH_URL: string;
  NEON_AUTH_JWKS_URL: string;
  NEON_AUTH_JWT_ISSUER?: string;
  ADMIN_EMAILS: string;
  ALERT_INTERRUPTION_LEVEL: 'active' | 'time-sensitive' | 'critical';
  ALERTS_CRITICAL_SOUND: string;
  CORS_ORIGINS: string;
}

export function intVar(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function boolVar(v: string | undefined): boolean {
  return v === 'true' || v === '1' || v === 'yes';
}

export function listVar(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
