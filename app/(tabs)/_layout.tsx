import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/components/Themed';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useObd } from '@/lib/obd/connection';

function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} color={color} size={26} />;
  };
}

export default function TabLayout() {
  const { colors } = useTheme();
  const obd = useObd();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tabIconSelected,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontWeight: '600' },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', fontSize: 22 },
        headerTitleAlign: 'left',
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false, tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="inspections" options={{ title: 'Inspections', tabBarIcon: tabIcon('inspections') }} />
      <Tabs.Screen
        name="drive"
        options={{
          title: 'Drive',
          tabBarIcon: tabIcon('drive'),
          // A dot on the tab while a car is connected, so it's clear data is live.
          tabBarBadge: obd.status === 'connected' ? '' : undefined,
          tabBarBadgeStyle: { backgroundColor: obd.simulated ? '#8E44AD' : '#2e7d32', minWidth: 10, maxHeight: 10, top: 4 },
        }}
      />
      <Tabs.Screen name="garage" options={{ title: 'Garage', tabBarIcon: tabIcon('garage') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: tabIcon('account') }} />
    </Tabs>
  );
}
