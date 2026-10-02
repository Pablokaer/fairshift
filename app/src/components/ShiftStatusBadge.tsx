import { useTranslation } from 'react-i18next';
import { Badge } from './ui';

const TONES: Record<string, 'waiting' | 'paused' | 'offered' | 'assigned' | 'neutral'> = {
  draft: 'neutral',
  published: 'waiting',
  offered: 'offered',
  assigned: 'assigned',
  completed: 'assigned',
  no_show: 'paused',
  cancelled: 'neutral',
  unfilled: 'paused',
};

export function ShiftStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge label={t(`shift_status.${status}`)} tone={TONES[status] ?? 'neutral'} />;
}
