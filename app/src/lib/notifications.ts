import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Ask for permission and register this device's Expo push token.
 * Web has no push here: it relies on the in-app inbox, live updates and e-mail.
 */
export async function registerForPush(): Promise<'registered' | 'denied' | 'unsupported'> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('shifts', {
        name: 'Shift assignments',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
      await Notifications.setNotificationChannelAsync('default', {
        name: 'General',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return 'unsupported';
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    return 'registered';
  } catch {
    // e.g. Expo Go on Android (no remote push since SDK 53): fall back to inbox + e-mail.
    return 'unsupported';
  }
}

/** Navigate when the user taps a notification (data.url is an in-app route). */
export function useNotificationNavigation() {
  const last = Platform.OS === 'web' ? null : Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = last?.notification.request.content.data?.url;
    if (typeof url === 'string' && last?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      router.push(url as never);
    }
  }, [last]);
}
