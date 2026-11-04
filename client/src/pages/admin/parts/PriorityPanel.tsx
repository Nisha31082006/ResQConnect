import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../../../services/api';
import { Alert, Button, Card, Field, PriorityBadge, Select, TextArea } from '../../../components/ui';
import { Reasons } from '../../../components/Reasons';
import { useToast } from '../../../context/ToastContext';
import { PRIORITIES } from '../../../utils/enums';
import { errorMessage } from '../../../utils/errors';
import { formatDateTime } from '../../../utils/format';
import type { Emergency, PriorityLevel } from '../../../types';

/**
 * The rule engine only RECOMMENDS. Nothing is assigned until an admin confirms here.
 * Choosing a different level is an override and requires a written reason (also enforced by the API).
 */
export function PriorityPanel({ e, onChanged }: { e: Emergency; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const live = e.liveRecommendation ?? e.recommendedPriority;
  const [level, setLevel] = useState<PriorityLevel>(e.finalPriority?.level ?? live.level);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const overriding = level !== live.level;
  const save = async () => {
    if (overriding && reason.trim().length < 3) return setErr(t('priority.reasonRequired'));
    setBusy(true);
    setErr('');
    try {
      await post(`/emergencies/${e.id}/priority`, { level, ...(overriding ? { overrideReason: reason.trim() } : {}) });
      toast.success(t('priority.saved'));
      setReason('');
      onChanged();
    } catch (x) {
      setErr(errorMessage(x, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t('priority.panelTitle')}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-3 grid grid-cols-2 gap-2 rounded border border-ink-200 bg-ink-50 p-2 text-sm">
            <div><div className="text-xs text-ink-500">{t('priority.citizenSelected')}</div>{e.citizenPriority ? <PriorityBadge level={e.citizenPriority} /> : <span className="text-ink-500">{t('priority.citizenNone')}</span>}</div>
            <div><div className="text-xs text-ink-500">{t('priority.systemRecommended')}</div><PriorityBadge level={live.level} /></div>
            {e.citizenPriority && e.citizenPriority !== live.level && <p className="col-span-2 text-xs text-amber-800">{t('priority.differs')}</p>}
          </div>
          <p className="mb-1 text-sm font-semibold">{t('priority.recommended')} <PriorityBadge level={live.level} /> <span className="font-mono text-xs">({t('priority.score', { score: live.score })})</span></p>
          <Reasons reasons={live.reasons} />
          {e.priorityReviewNeeded && <div className="mt-2"><Alert tone="warn">{t('priority.reviewNeeded')}</Alert></div>}
        </div>
        <div className="space-y-3">
          {e.finalPriority ? (
            <Alert tone="ok">
              {t('priority.confirmedAs')} <PriorityBadge level={e.finalPriority.level} /> · {formatDateTime(e.finalPriority.decidedAt, i18n.language)}
              {e.finalPriority.overridden && <span> · {t('priority.overridden')}: “{e.finalPriority.overrideReason}”</span>}
            </Alert>
          ) : <Alert tone="warn">{t('priority.notConfirmed')}</Alert>}
          {err && <Alert tone="danger">{err}</Alert>}
          <Field label={t('priority.finalLevel')} required>
            {(id) => <Select id={id} value={level} onChange={(x) => setLevel(x.target.value as PriorityLevel)}>{PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}{p === live.level ? ` (${t('priority.recommendedShort')})` : ''}</option>)}</Select>}
          </Field>
          {overriding && <Field label={t('priority.overrideReason')} required>{(id) => <TextArea id={id} rows={2} value={reason} onChange={(x) => setReason(x.target.value)} />}</Field>}
          <Button loading={busy} onClick={() => void save()}>{overriding ? t('priority.override') : t('priority.confirm')}</Button>
        </div>
      </div>
    </Card>
  );
}
