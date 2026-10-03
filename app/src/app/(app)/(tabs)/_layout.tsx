import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useInbox } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useOrg } from '@/lib/org';
import { font, useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useTheme();
  const { isAdmin } = useOrg();
  const inbox = useInbox(useUserId());
  const unread = (inbox.data ?? []).filter((n) => !n.read_at).length;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primaryStrong,
        tabBarInactiveTintColor: c.textMuted,
        // Screens render their own H1, so the tab header would only repeat it.
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          ...(Platform.OS === 'web' ? { height: 72, paddingBottom: 12, paddingTop: 8 } : null),
        },
        tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontFamily: font.semibold },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'people' : 'people-outline'} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="shifts"
        options={{
          title: t('tabs.shifts'),
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: t('tabs.inbox'),
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: c.danger, color: c.onDanger, fontFamily: font.semibold },
          tabBarAccessibilityLabel: unread > 0 ? t('inbox.unread_label', { count: unread }) : t('tabs.inbox'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'notifications' : 'notifications-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: t('tabs.admin'),
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'grid' : 'grid-outline'} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
