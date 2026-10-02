import { useTranslation } from 'react-i18next';
import { Badge } from './ui';

const TONES: Record<string, 'waiting' | 'paused' | 'offered' | 'assigned' | 'neutral'> = {
  waiting: 'waiting',
  paused: 'paused',
  offered: 'offered',
  assigned: 'assigned',
  not_joined: 'neutral',
};

export function QueueStateBadge({ state }: { state: string }) {
  const { t } = useTranslation();
  return <Badge label={t(`states.${state}`)} tone={TONES[state] ?? 'neutral'} />;
}
