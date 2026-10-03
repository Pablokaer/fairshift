import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl } from 'react-native';
import { Banner, Body, Button, Card, Chip, Empty, Gap, ListRow, Loading, Row, Screen, Small } from '@/components/ui';
import { rpc, useAudit, useProfessionals, useQueueOverview, type AuditFilters } from '@/lib/api';
import { saveTextFile } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { font, space } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';

const CATEGORIES = ['entry', 'shift', 'assignment', 'member', 'org', 'queue', 'account'] as const;
const PERIODS = [7, 30, 90, 0] as const;

export default function Audit() {
  const { t, i18n } = useTranslation();
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const { current } = useOrg();
  const queues = useQueueOverview(current?.org_id);
  const people = useProfessionals(current?.org_id);
  const [types, setTypes] = useState<string[]>([]);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(subject ?? null);
  const [days, setDays] = useState<number>(30);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters: AuditFilters = {
    types: types.length ? types : null,
    queueId,
    subjectId,
    from: days ? new Date(Date.now() - days * 86_400_000).toISOString() : null,
  };
  const audit = useAudit(current?.org_id, filters);
  if (!current) return <Loading label={t('common.loading')} />;
  const tz = current.org.timezone;

  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const csv = await rpc('export_audit_csv', {
        p_org: current.org_id,
        p_types: filters.types ?? undefined,
        p_queue: filters.queueId ?? undefined,
        p_subject: filters.subjectId ?? undefined,
        p_from: filters.from ?? undefined,
      });
      await saveTextFile(`fairshift-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv as unknown as string, 'text/csv');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={audit.isRefetching} onRefresh={() => audit.refetch()} />}>
      <Small>{t('admin.audit_explainer')}</Small>
      <Gap />
      <Body style={{ fontFamily: font.semibold }}>{t('admin.event_type')}</Body>
      <Row>
        {CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={t(`audit_categories.${c}`)}
            selected={types.includes(c)}
            onPress={() => setTypes(types.includes(c) ? types.filter((x) => x !== c) : [...types, c])}
          />
        ))}
      </Row>
      <Gap size={space.sm} />
      <Body style={{ fontFamily: font.semibold }}>{t('admin.queue')}</Body>
      <Row>
        <Chip label={t('common.all')} selected={!queueId} onPress={() => setQueueId(null)} />
        {queues.data?.map((q) => (
          <Chip key={q.queue_id} label={t(`queues.${q.profession}`)} selected={queueId === q.queue_id} onPress={() => setQueueId(q.queue_id)} />
        ))}
      </Row>
      <Gap size={space.sm} />
      <Body style={{ fontFamily: font.semibold }}>{t('admin.person')}</Body>
      <Row>
        <Chip label={t('admin.everyone')} selected={!subjectId} onPress={() => setSubjectId(null)} />
        {people.data?.slice(0, 60).map((m) => (
          <Chip
            key={m.user_id}
            label={m.display_name || t('common.deleted_user')}
            selected={subjectId === m.user_id}
            onPress={() => setSubjectId(m.user_id)}
          />
        ))}
      </Row>
      <Gap size={space.sm} />
      <Body style={{ fontFamily: font.semibold }}>{t('admin.period')}</Body>
      <Row>
        {PERIODS.map((d) => (
          <Chip key={d} label={d ? t('admin.last_days', { count: d }) : t('admin.all_time')} selected={days === d} onPress={() => setDays(d)} />
        ))}
      </Row>
      <Gap />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button testID="export-csv" title={t('admin.export_csv')} icon="download-outline" variant="secondary" onPress={exportCsv} loading={exporting} />
      <Gap />
      {audit.isLoading ? <Loading label={t('common.loading')} cards={1} /> : null}
      {audit.data?.length === 0 ? <Empty title={t('admin.no_events')} icon="list-outline" /> : null}
      {audit.data && audit.data.length > 0 ? (
        <Card>
          {audit.data.map((e, i) => (
            <ListRow
              key={e.id}
              title={t(`audit_types.${e.type}`, { defaultValue: e.type })}
              subtitle={[
                fmtDateTime(e.created_at, tz, i18n.language),
                e.queue_profession ? t(`queues.${e.queue_profession}`) : null,
                e.subject_name !== null ? `${t('admin.subject')}: ${e.subject_name || t('common.deleted_user')}` : null,
                `${t('admin.actor')}: ${e.actor_id ? e.actor_name || t('common.deleted_user') : t('admin.system')}`,
                (e.payload as { position?: number } | null)?.position ? t('admin.position_short', { position: (e.payload as { position: number }).position }) : null,
                (e.payload as { assignee_is_manager?: boolean } | null)?.assignee_is_manager ? t('admin.manager_flag') : null,
                e.reason ? `${t('admin.reason')}: ${e.reason}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              last={i === audit.data.length - 1}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
