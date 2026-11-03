import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { CameraProvider } from '@/components/camera/CameraProvider';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { SessionProvider, useSession } from '@/lib/auth/session';
import { startAppCheck } from '@/lib/firebase/app-check';
import { startUploadQueue } from '@/lib/firebase/upload-queue';
import { applyTheme, usePreferences } from '@/lib/preferences';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on a nested screen keeps a back button present.
  anchor: '(tabs)',
};

// Before any callable function runs.
startAppCheck();
// Before the first frame, so a dark-mode user never sees a light flash.
applyTheme();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  if (!loaded) {
    return null;
  }

  return (
    <SessionProvider>
      <CameraProvider>
        <RootLayoutNav />
      </CameraProvider>
    </SessionProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { user, initializing, profile } = useSession();
  const { mode, introSeen } = usePreferences();
  const c = Colors[colorScheme];
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: c.primary, background: c.background, card: c.background, text: c.text, border: c.border },
  };

  // Keep the splash up until Firebase has restored any signed-in user and their profile, so neither
  // the sign-in nor the welcome screen flashes.
  useEffect(() => {
    if (!initializing) {
      SplashScreen.hideAsync();
    }
  }, [initializing]);

  // Upload photos captured offline. Storage rules need the signed-in user, so only run while signed in.
  useEffect(() => (user ? startUploadQueue() : undefined), [user]);

  if (initializing) {
    return null;
  }

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '700' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.background },
        }}>
        <Stack.Protected guard={!!user && !!profile && !!mode}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="inspection/new" options={{ title: 'New inspection' }} />
          <Stack.Screen name="inspection/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="inspection/[id]/[section]" options={{ title: '' }} />
          <Stack.Screen name="inspection/[id]/review" options={{ title: 'Review and sign off' }} />
          <Stack.Screen name="connect" options={{ title: 'Connect adapter', presentation: 'modal' }} />
          <Stack.Screen name="diagnose" options={{ title: 'Explain a problem' }} />
          <Stack.Screen name="engine-check/index" options={{ title: 'Engine sound check' }} />
          <Stack.Screen name="engine-check/record" options={{ headerShown: false }} />
          <Stack.Screen name="engine-check/[id]" options={{ title: 'Engine sound check' }} />
          <Stack.Screen name="profile" options={{ title: 'Your details' }} />
          <Stack.Screen name="plans" options={{ title: 'Reports and billing' }} />
          <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
          <Stack.Screen name="obd/car-mode" options={{ headerShown: false }} />
          <Stack.Screen name="obd/dashboard-edit" options={{ title: 'Edit dashboards' }} />
          <Stack.Screen name="obd/health" options={{ title: 'Health check' }} />
          <Stack.Screen name="obd/sensors" options={{ title: 'All sensors' }} />
          <Stack.Screen name="obd/graphs" options={{ title: 'Graphs' }} />
          <Stack.Screen name="obd/performance" options={{ title: 'Performance' }} />
          <Stack.Screen name="obd/battery" options={{ title: 'Battery test' }} />
          <Stack.Screen name="garage/trips" options={{ title: 'Trips' }} />
          <Stack.Screen name="garage/trip/[id]" options={{ title: 'Trip' }} />
          <Stack.Screen name="garage/vehicle" options={{ title: 'Car details' }} />
          <Stack.Screen name="garage/maintenance" options={{ title: 'Service' }} />
          <Stack.Screen name="garage/settings" options={{ title: 'Car settings' }} />
        </Stack.Protected>
        <Stack.Protected guard={!!user && !profile}>
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!!user && !!profile && !mode}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!user && !introSeen}>
          <Stack.Screen name="intro" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!user && introSeen}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        {/* Email links can arrive on a fresh install, before the intro has been seen. */}
        <Stack.Protected guard={!user}>
          <Stack.Screen name="finish-sign-in" options={{ title: 'Signing in' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
