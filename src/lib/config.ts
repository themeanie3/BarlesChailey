import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  appEnv?: string;
  criticalAlerts?: boolean;
  googleConfigured?: boolean;
  eas?: { projectId?: string };
};

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.warn(`[config] ${name} is not set; see .env.example`);
    return '';
  }
  return value;
}

export const config = {
  appEnv: extra.appEnv ?? 'development',
  apiUrl: required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL).replace(/\/+$/, ''),
  neonAuthUrl: required('EXPO_PUBLIC_NEON_AUTH_URL', process.env.EXPO_PUBLIC_NEON_AUTH_URL).replace(/\/+$/, ''),
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  googleConfigured: Boolean(extra.googleConfigured && process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  criticalAlerts: Boolean(extra.criticalAlerts),
  easProjectId: extra.eas?.projectId ?? Constants.easConfig?.projectId ?? '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  timezone: 'America/New_York',
} as const;
