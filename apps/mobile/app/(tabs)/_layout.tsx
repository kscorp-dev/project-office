import { Tabs } from 'expo-router';
import { Platform, Text } from 'react-native';
import { COLORS } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';

function TabIcon({ name, focused, color }: { name: string; focused: boolean; color: string }) {
  const icons: Record<string, string> = {
    dashboard: '◻',
    mail: '✉',
    approval: '✓',
    messenger: '💬',
    more: '⋯',
  };
  return (
    <Text style={{ fontSize: 20, color }}>
      {icons[name] || '•'}
    </Text>
  );
}

export default function TabLayout() {
  const { c, isDark } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.surface, elevation: 0, shadowOpacity: 0, borderBottomWidth: isDark ? 1 : 0, borderBottomColor: c.divider },
        headerTitleStyle: { fontWeight: '700', fontSize: 18, color: c.text },
        sceneStyle: { backgroundColor: c.bg },
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.divider,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
        },
        tabBarActiveTintColor: COLORS.primary[isDark ? 400 : 600],
        tabBarInactiveTintColor: c.textSubtle,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: '홈',
          headerTitle: 'Project Office',
          tabBarIcon: ({ focused, color }) => <TabIcon name="dashboard" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mail"
        options={{
          title: '메일',
          tabBarIcon: ({ focused, color }) => <TabIcon name="mail" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="approval"
        options={{
          title: '결재',
          tabBarIcon: ({ focused, color }) => <TabIcon name="approval" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messenger"
        options={{
          title: '메신저',
          tabBarIcon: ({ focused, color }) => <TabIcon name="messenger" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: '더보기',
          tabBarIcon: ({ focused, color }) => <TabIcon name="more" focused={focused} color={color} />,
        }}
      />
    </Tabs>
  );
}
