import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui';

interface Hit { display_name: string; lat: string; lon: string }

/** Free OpenStreetMap Nominatim search (no API key). Works only with internet access; failures are reported, not hidden. */
export function PlaceSearch({ onPick }: { onPick: (p: { lat: number; lng: number; label: string }) => void }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const search = async () => {
    if (q.trim().length < 3) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=${i18n.language}&q=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as Hit[];
      setHits(data);
      if (data.length === 0) setMsg(t('map.noPlaces'));
    } catch {
      setMsg(t('map.searchFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative">
      <div className="flex gap-2">
        <input className="input" value={q} placeholder={t('map.searchPlace')} aria-label={t('map.searchPlace')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
        <Button type="button" variant="secondary" loading={busy} onClick={() => void search()}>{t('common.search')}</Button>
      </div>
      {msg && <p className="mt-1 text-xs text-ink-500">{msg}</p>}
      {hits.length > 0 && (
        <ul className="absolute z-[1200] mt-1 max-h-48 w-full overflow-auto rounded-lg border border-ink-200 bg-white text-sm shadow-lg">
          {hits.map((h, i) => (
            <li key={i}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-ink-100" onClick={() => { onPick({ lat: Number(h.lat), lng: Number(h.lon), label: h.display_name }); setHits([]); setQ(h.display_name.split(',')[0]); }}>
                {h.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
