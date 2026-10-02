// Colors chosen for WCAG AA: every text/background pair below has a contrast
// ratio >= 4.5:1 (checked in src/lib/__tests__/contrast.test.ts).
import { useColorScheme } from 'react-native';

export const light = {
  bg: '#F4F6F8',
  surface: '#FFFFFF',
  surfaceAlt: '#E9EEF2',
  text: '#0F1D2B',
  textMuted: '#4A5A6A',
  border: '#C5CFD8',
  primary: '#0B5C73',
  onPrimary: '#FFFFFF',
  danger: '#A61B1B',
  onDanger: '#FFFFFF',
  success: '#1D6B35',
  warning: '#8A5300',
  info: '#1F4FA3',
  focus: '#E09F00',
  badgeWaitingBg: '#DCEBF7',
  badgeWaitingText: '#123E6B',
  badgePausedBg: '#F1E7D3',
  badgePausedText: '#5E3B00',
  badgeOfferedBg: '#FFF1C2',
  badgeOfferedText: '#5A4000',
  badgeAssignedBg: '#D7F0DE',
  badgeAssignedText: '#14502A',
  badgeNeutralBg: '#E6E9ED',
  badgeNeutralText: '#2E3B48',
};

export type Palette = typeof light;

export const dark: Palette = {
  bg: '#0E151C',
  surface: '#16212B',
  surfaceAlt: '#1F2D39',
  text: '#ECF1F5',
  textMuted: '#A9B7C4',
  border: '#36495A',
  primary: '#66C7DE',
  onPrimary: '#06222B',
  danger: '#FF8A80',
  onDanger: '#2B0505',
  success: '#7FD69A',
  warning: '#F2C063',
  info: '#93B8FF',
  focus: '#FFD166',
  badgeWaitingBg: '#1C3A57',
  badgeWaitingText: '#D6E8FA',
  badgePausedBg: '#4A3714',
  badgePausedText: '#F8E5C0',
  badgeOfferedBg: '#544200',
  badgeOfferedText: '#FFF3C4',
  badgeAssignedBg: '#1B4A2B',
  badgeAssignedText: '#D3F5DD',
  badgeNeutralBg: '#2C3843',
  badgeNeutralText: '#E1E7EC',
};

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 14 };
