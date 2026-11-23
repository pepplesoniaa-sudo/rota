import type { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Rota',
  slug: 'rota',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.rota.mobile',
  },
  android: {
    package: 'com.rota.mobile',
  },
  web: {
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    [
      'expo-font',
      {
        fonts: [
          'node_modules/@expo-google-fonts/inter/Inter_400Regular.ttf',
          'node_modules/@expo-google-fonts/inter/Inter_500Medium.ttf',
          'node_modules/@expo-google-fonts/inter/Inter_600SemiBold.ttf',
          'node_modules/@expo-google-fonts/inter/Inter_700Bold.ttf',
        ],
      },
    ],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1',
    eas: {
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID ?? 'c902db9e-8f9d-4f89-8257-bf903270dc6b',
    },
  },
});
