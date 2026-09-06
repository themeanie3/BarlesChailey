import type { ConfigContext, ExpoConfig } from 'expo/config';

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

const APP_ENV = env('APP_ENV') ?? env('EAS_BUILD_PROFILE') ?? 'development';
const isProd = APP_ENV === 'production';
const criticalAlerts = env('EXPO_PUBLIC_CRITICAL_ALERTS') === '1';
const googleIosUrlScheme = env('EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME');
const easProjectId = env('EAS_PROJECT_ID');

const plugins: NonNullable<ExpoConfig['plugins']> = [
  'expo-router',
  'expo-secure-store',
  'expo-dev-client',
  ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#b71c1c' }],
  [
    'expo-location',
    {
      locationWhenInUsePermission: 'BarlesChailey uses your location to show how far you are from active fire and EMS calls.',
      locationAlwaysAndWhenInUsePermission:
        'Allow "Always" so BarlesChailey can page you about serious calls near you while the app is closed.',
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
    },
  ],
  [
    'expo-notifications',
    {
      icon: './assets/notification-icon.png',
      color: '#b71c1c',
      defaultChannel: 'alerts',
      enableBackgroundRemoteNotifications: false,
    },
  ],
  ['expo-maps', { requestLocationPermission: false }],
  ['expo-build-properties', { ios: { deploymentTarget: '16.4' }, android: { compileSdkVersion: 36, targetSdkVersion: 36 } }],
];
// Native Google Sign-In needs the reversed iOS client id at prebuild time; without it the app falls back to email codes.
if (googleIosUrlScheme) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }]);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isProd ? 'BarlesChailey' : `BarlesChailey (${APP_ENV})`,
  slug: 'barleschailey',
  owner: env('EXPO_ACCOUNT_OWNER'),
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'barleschailey',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0b0c10',
  runtimeVersion: { policy: 'appVersion' },
  updates: easProjectId ? { url: `https://u.expo.dev/${easProjectId}`, fallbackToCacheTimeout: 0 } : undefined,
  ios: {
    bundleIdentifier: isProd ? 'org.rvfd.barleschailey' : `org.rvfd.barleschailey.${APP_ENV}`,
    supportsTablet: false,
    buildNumber: '1',
    // Location + push are the whole point of the app; the strings below are what Apple reviewers read.
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription:
        'BarlesChailey uses your location to show how far you are from active fire and EMS calls.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Allow "Always" so BarlesChailey can page you about serious calls near you while the app is closed. Your location is only shared with the Rockville VFD alert server and only your latest position is kept.',
      UIBackgroundModes: ['location', 'remote-notification'],
      CFBundleAllowMixedLocalizations: true,
    },
    entitlements: {
      'aps-environment': isProd ? 'production' : 'development',
      'com.apple.developer.usernotifications.time-sensitive': true,
      ...(criticalAlerts ? { 'com.apple.developer.usernotifications.critical-alerts': true } : {}),
    },
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: isProd ? 'org.rvfd.barleschailey' : `org.rvfd.barleschailey.${APP_ENV}`,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#b71c1c' },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'POST_NOTIFICATIONS'],
  },
  plugins,
  experiments: { typedRoutes: false },
  extra: {
    appEnv: APP_ENV,
    criticalAlerts,
    googleConfigured: Boolean(env('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID') && env('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID')),
    eas: easProjectId ? { projectId: easProjectId } : undefined,
  },
});
