import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from './ui';

const SHIFT_TONES: Record<string, BadgeTone> = {
  draft: 'neutral',
  open: 'paused',
  filled: 'assigned',
  completed: 'waiting',
  cancelled: 'neutral',
};

const ASSIGNMENT_TONES: Record<string, BadgeTone> = {
  active: 'assigned',
  completed: 'waiting',
  no_show: 'danger',
  cancelled: 'neutral',
  withdrawn: 'neutral',
};

export function ShiftStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge label={t(`shift_status.${status}`)} tone={SHIFT_TONES[status] ?? 'neutral'} />;
}

export function AssignmentBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge label={t(`assignment.${status}`)} tone={ASSIGNMENT_TONES[status] ?? 'neutral'} />;
}
