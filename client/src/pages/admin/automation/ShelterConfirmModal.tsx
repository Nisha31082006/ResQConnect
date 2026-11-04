import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../../services/api';
import { Alert, Button, Modal, Spinner, Table } from '../../../components/ui';
import { useToast } from '../../../context/ToastContext';
import { errorMessage } from '../../../utils/errors';
import { ReasonList } from './ReasonList';
import type { ShelterRecommendation } from './types';

/** Suggested shelters for one emergency. Confirming records an approved referral; arrival is confirmed later by the coordinator. */
export function ShelterConfirmBody({ emergencyId, onDone }: { emergencyId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [rec, setRec] = useState<ShelterRecommendation | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let live = true;
    get<ShelterRecommendation>(`/automation/emergencies/${emergencyId}/shelter-recommendation`).then((r) => live && setRec(r)).catch((x) => live && setErr(errorMessage(x, t)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emergencyId]);
  const confirm = async (shelterId: string) => {
    setBusy(shelterId);
    setErr('');
    try { await post(`/automation/emergencies/${emergencyId}/shelter/confirm`, { shelterId }); toast.success(t('automation.shelters.confirmed')); onDone(); } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(''); }
  };
  if (!rec) return err ? <Alert tone="danger">{err}</Alert> : <Spinner />;
  return (
    <div className="space-y-3">
      {err && <Alert tone="danger">{err}</Alert>}
      <Alert tone="info">{t('automation.shelters.advisory')}</Alert>
      {rec.planned && <Alert tone="ok">{t('automation.shelters.alreadyPlanned', { people: rec.planned.people })}</Alert>}
      <p className="text-sm">{t('automation.shelters.peopleToPlace', { count: rec.people })}{rec.neededFacilities.length > 0 && <> · {t('automation.shelters.neededFacilities')}: {rec.neededFacilities.map((f) => t(`facility.${f}`)).join(', ')}</>}</p>
      <Table
        head={[t('common.name'), t('automation.shelters.distance'), t('automation.shelters.available'), t('shelter.facilities'), t('automation.shelters.why'), '']}
        empty={rec.shelters.length === 0 ? <p className="p-4 text-sm text-ink-500">{t('automation.shelters.none', rec.excluded)}</p> : undefined}
      >
        {rec.shelters.map((s) => (
          <tr key={s.id}>
            <td className="td font-semibold">{s.name}<div className="text-xs font-normal text-ink-500">{s.address}</div></td>
            <td className="td whitespace-nowrap">{t('automation.km', { km: s.distanceKm })}</td>
            <td className="td whitespace-nowrap">{t('shelter.availability', { available: s.availableSpaces, capacity: s.capacity })}</td>
            <td className="td text-xs">{s.facilities.map((f) => t(`facility.${f}`)).join(', ') || '—'}{s.missingFacilities.length > 0 && <div className="text-amber-800">{t('automation.shelters.missing')}: {s.missingFacilities.map((f) => t(`facility.${f}`)).join(', ')}</div>}</td>
            <td className="td"><span className="font-mono text-xs">{t('automation.teams.score', { score: s.score })}</span><ReasonList reasons={s.reasons} /></td>
            <td className="td"><Button disabled={Boolean(rec.planned)} loading={busy === s.id} onClick={() => void confirm(s.id)}>✔ {t('automation.shelters.confirm')}</Button></td>
          </tr>
        ))}
      </Table>
      {rec.shelters.length > 0 && (rec.excluded.insufficientCapacity > 0 || rec.excluded.tooFar > 0) && <p className="text-xs text-ink-500">{t('automation.shelters.excluded', rec.excluded)}</p>}
    </div>
  );
}

export function ShelterConfirmModal({ emergencyId, onClose, onDone }: { emergencyId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open wide title={t('automation.shelters.reviewTitle')} onClose={onClose}>
      <ShelterConfirmBody emergencyId={emergencyId} onDone={() => { onDone(); onClose(); }} />
    </Modal>
  );
}
