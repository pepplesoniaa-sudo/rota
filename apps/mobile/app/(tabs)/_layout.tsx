import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useTheme } from '../../src/ui/theme';

export default function TabsLayout(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.color.surface,
        },
        headerTintColor: theme.color.onSurface,
        headerTitleStyle: {
          fontWeight: '700',
        },
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.outlineVariant,
        },
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.onSurfaceVariant,
      }}
    >
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          tabBarLabel: 'Schedule',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>📅</Text>,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Activity Feed',
          tabBarLabel: 'Feed',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>📰</Text>,
        }}
      />
      <Tabs.Screen
        name="swaps"
        options={{
          title: 'Shift Swaps',
          tabBarLabel: 'Swaps',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🔄</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>⚙️</Text>,
        }}
      />
      <Tabs.Screen
        name="billing"
        options={{
          title: 'Billing',
          tabBarLabel: 'Billing',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>💳</Text>,
        }}
      />
    </Tabs>
  );
}
