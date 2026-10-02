import { dark, light, type Palette } from '../lib/theme';

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

const pairs: [keyof Palette, keyof Palette][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surfaceAlt'],
  ['textMuted', 'bg'],
  ['textMuted', 'surface'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['onPrimary', 'primary'],
  ['onDanger', 'danger'],
  ['danger', 'surface'],
  ['success', 'surface'],
  ['warning', 'surface'],
  ['info', 'surface'],
  ['badgeWaitingText', 'badgeWaitingBg'],
  ['badgePausedText', 'badgePausedBg'],
  ['badgeOfferedText', 'badgeOfferedBg'],
  ['badgeAssignedText', 'badgeAssignedBg'],
  ['badgeNeutralText', 'badgeNeutralBg'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme meets WCAG AA (4.5:1) for text', (_name, p) => {
  it.each(pairs)('%s on %s', (fg, bg) => {
    expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
