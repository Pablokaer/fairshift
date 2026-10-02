import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl } from 'react-native';
import { Banner, Body, Button, Card, Chip, Empty, Gap, ListRow, Loading, Row, Screen, Small } from '@/components/ui';
import { rpc, useAudit, useMembers, useQueues, type AuditFilters } from '@/lib/api';
import { saveTextFile } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';

const CATEGORIES = ['entry', 'offer', 'shift', 'assignment', 'member', 'pool', 'invite', 'queue', 'account'] as const;
const PERIODS = [7, 30, 90, 0] as const;

export default function Audit() {
  const { t, i18n } = useTranslation();
  const { current } = useOrg();
  const queues = useQueues(current?.org_id);
  const members = useMembers(current?.org_id);
  const [types, setTypes] = useState<string[]>([]);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
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
      <Gap size={space.sm} />
      <Body style={{ fontWeight: '600' }}>{t('admin.event_type')}</Body>
      <Row>
        {CATEGORIES.map((c) => (
          <Chip key={c} label={t(`audit_categories.${c}`)} selected={types.includes(c)} onPress={() => setTypes(types.includes(c) ? types.filter((x) => x !== c) : [...types, c])} />
        ))}
      </Row>
      <Gap size={space.sm} />
      <Body style={{ fontWeight: '600' }}>{t('admin.queue')}</Body>
      <Row>
        <Chip label={t('admin.all_queues')} selected={!queueId} onPress={() => setQueueId(null)} />
        {queues.data?.map((q) => <Chip key={q.id} label={q.name} selected={queueId === q.id} onPress={() => setQueueId(q.id)} />)}
      </Row>
      <Gap size={space.sm} />
      <Body style={{ fontWeight: '600' }}>{t('admin.person')}</Body>
      <Row>
        <Chip label={t('admin.everyone')} selected={!subjectId} onPress={() => setSubjectId(null)} />
        {members.data?.slice(0, 40).map((m) => (
          <Chip key={m.user_id} label={m.display_name || t('common.deleted_user')} selected={subjectId === m.user_id} onPress={() => setSubjectId(m.user_id)} />
        ))}
      </Row>
      <Gap size={space.sm} />
      <Body style={{ fontWeight: '600' }}>{t('admin.period')}</Body>
      <Row>
        {PERIODS.map((d) => <Chip key={d} label={d ? t('admin.last_days', { count: d }) : t('admin.all_time')} selected={days === d} onPress={() => setDays(d)} />)}
      </Row>
      <Gap />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button testID="export-csv" title={t('admin.export_csv')} icon="download" variant="secondary" onPress={exportCsv} loading={exporting} />
      <Gap />
      {audit.isLoading ? <Loading label={t('common.loading')} /> : null}
      {audit.data?.length === 0 ? <Empty title={t('admin.no_events')} /> : null}
      {audit.data && audit.data.length > 0 ? (
        <Card>
          {audit.data.map((e) => (
            <ListRow
              key={e.id}
              title={t(`audit_types.${e.type}`, { defaultValue: e.type })}
              subtitle={[
                fmtDateTime(e.created_at, tz, i18n.language),
                e.queue_name,
                e.subject_name !== null ? `${t('admin.subject')}: ${e.subject_name || t('common.deleted_user')}` : null,
                `${t('admin.actor')}: ${e.actor_id ? e.actor_name || t('common.deleted_user') : t('admin.system')}`,
                e.reason ? `${t('admin.reason')}: ${e.reason}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
