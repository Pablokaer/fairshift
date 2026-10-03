import { light, type Palette } from '../lib/theme';

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Every text-on-background combination the UI uses.
const pairs: [keyof Palette, keyof Palette][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surfaceAlt'],
  ['text', 'primaryTint'],
  ['text', 'warningTint'],
  ['text', 'dangerTint'],
  ['textMuted', 'bg'],
  ['textMuted', 'surface'],
  ['textMuted', 'surfaceAlt'],
  ['textMuted', 'primaryTint'],
  ['textMuted', 'warningTint'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primaryStrong', 'surface'],
  ['primaryStrong', 'surfaceAlt'],
  ['primaryStrong', 'primaryTint'],
  ['onPrimary', 'primary'],
  ['onDanger', 'danger'],
  ['danger', 'surface'],
  ['danger', 'dangerTint'],
  ['dangerText', 'dangerTint'],
  ['success', 'surface'],
  ['success', 'badgeAssignedBg'],
  ['warning', 'surface'],
  ['warning', 'warningTint'],
  ['info', 'surface'],
  ['info', 'surfaceAlt'],
  ['doctorText', 'doctorBg'],
  ['nurseText', 'nurseBg'],
  ['badgeWaitingText', 'badgeWaitingBg'],
  ['badgePausedText', 'badgePausedBg'],
  ['badgeAssignedText', 'badgeAssignedBg'],
  ['badgeNeutralText', 'badgeNeutralBg'],
];

describe('light theme meets WCAG AA (4.5:1) for text', () => {
  it.each(pairs)('%s on %s', (fg, bg) => {
    expect(contrast(light[fg], light[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('doctor and nurse tags are distinguishable by colour as well as label and icon', () => {
    expect(light.doctorBg).not.toBe(light.nurseBg);
    expect(light.doctorText).not.toBe(light.nurseText);
  });
});
