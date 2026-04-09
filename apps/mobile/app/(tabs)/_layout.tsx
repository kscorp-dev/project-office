import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { COLORS } from '../../src/constants/theme';

// Simple icon component using text symbols (no external icon lib dependency)
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    dashboard: '◻',
    mail: '✉',
    approval: '✓',
    messenger: '💬',
    more: '⋯',
  };
  const { Text } = require('react-native');
  return (
    <Text style={{ fontSize: 20, color: focused ? COLORS.primary[500] : COLORS.gray[400] }}>
      {icons[name] || '•'}
    </Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.white, elevation: 0, shadowOpacity: 0 },
        headerTitleStyle: { fontWeight: '700', fontSize: 18, color: COLORS.gray[800] },
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopColor: COLORS.gray[100],
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
        },
        tabBarActiveTintColor: COLORS.primary[600],
        tabBarInactiveTintColor: COLORS.gray[400],
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: '홈',
          headerTitle: 'Project Office',
          tabBarIcon: ({ focused }) => <TabIcon name="dashboard" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="mail"
        options={{
          title: '메일',
          tabBarIcon: ({ focused }) => <TabIcon name="mail" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="approval"
        options={{
          title: '결재',
          tabBarIcon: ({ focused }) => <TabIcon name="approval" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="messenger"
        options={{
          title: '메신저',
          tabBarIcon: ({ focused }) => <TabIcon name="messenger" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: '더보기',
          tabBarIcon: ({ focused }) => <TabIcon name="more" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
