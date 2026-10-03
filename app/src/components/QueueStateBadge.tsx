import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from './ui';

const TONES: Record<string, BadgeTone> = {
  waiting: 'waiting',
  paused: 'paused',
  assigned: 'assigned',
  not_joined: 'neutral',
  no_profession: 'neutral',
};

export function QueueStateBadge({ state }: { state: string }) {
  const { t } = useTranslation();
  return <Badge label={t(`states.${state}`)} tone={TONES[state] ?? 'neutral'} />;
}
