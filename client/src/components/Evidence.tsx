import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchBlobUrl } from '../services/api';

/** Uploaded files require the bearer token, so images are fetched as blobs instead of plain <img src>. */
export function EvidenceItem({ url, name, mime }: { url: string; name?: string; mime: string }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let created: string | null = null;
    fetchBlobUrl(url).then((u) => { created = u; if (!revoked) setSrc(u); else URL.revokeObjectURL(u); }).catch(() => setFailed(true));
    return () => { revoked = true; if (created) URL.revokeObjectURL(created); };
  }, [url]);
  if (failed) return <span className="text-xs text-red-700">{t('common.fileLoadFailed')}</span>;
  if (!src) return <span className="text-xs text-ink-500">{t('common.loading')}</span>;
  return mime.startsWith('image/') ? (
    <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={name ?? t('common.attachments')} className="h-28 w-28 rounded border border-ink-200 object-cover" /></a>
  ) : (
    <a href={src} download={name} className="btn-secondary">📎 {name ?? t('common.attachments')}</a>
  );
}
export function EvidenceList({ items }: { items: { url: string; originalName?: string; mimeType: string }[] }) {
  if (!items.length) return null;
  return <div className="flex flex-wrap gap-2">{items.map((e) => <EvidenceItem key={e.url} url={e.url} name={e.originalName} mime={e.mimeType} />)}</div>;
}
