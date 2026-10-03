// Light, calm, clinical palette. Every text/background pair used for text has
// a contrast ratio >= 4.5:1 (WCAG AA), checked in src/__tests__/contrast.test.ts.
// Light theme only for now: useTheme() always returns `light`.

export const light = {
  bg: '#F7FAFC',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF3F7',
  text: '#102A3A',
  textMuted: '#4B5D6B',
  border: '#D9E2EA',
  primary: '#0E7C86',
  primaryStrong: '#0A6670',
  primaryTint: '#E6F4F5',
  onPrimary: '#FFFFFF',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  dangerTint: '#FDECEA',
  dangerText: '#8E1F14',
  success: '#276F45',
  warning: '#8A5A00',
  warningTint: '#FFF4DB',
  info: '#1F5FA8',
  focus: '#E09F00',
  // Profession tags: always shown with an icon and a label, never colour alone.
  doctorBg: '#E7F0FB',
  doctorText: '#1A4F8B',
  nurseBg: '#E3F5EE',
  nurseText: '#146C4B',
  // Status badges.
  badgeWaitingBg: '#E6F4F5',
  badgeWaitingText: '#0A5B63',
  badgePausedBg: '#FFF4DB',
  badgePausedText: '#6B4600',
  badgeAssignedBg: '#E7F4EC',
  badgeAssignedText: '#1D5E37',
  badgeNeutralBg: '#EEF2F6',
  badgeNeutralText: '#3A4856',
  skeleton: '#E4EBF1',
};

export type Palette = typeof light;

export function useTheme(): Palette {
  return light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

// Inter, loaded in app/_layout.tsx. Custom fonts need one family per weight
// (fontWeight alone does not pick the right file on Android).
export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
};

// Subtle elevation instead of heavy borders.
export const shadow = {
  card: { boxShadow: '0 1px 2px rgba(16, 42, 58, 0.06), 0 4px 16px rgba(16, 42, 58, 0.06)' },
  raised: { boxShadow: '0 2px 4px rgba(16, 42, 58, 0.08), 0 12px 32px rgba(16, 42, 58, 0.10)' },
} as const;

export const maxContentWidth = 720;
