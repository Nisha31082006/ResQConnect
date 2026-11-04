import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function About() {
  const { t } = useTranslation();
  const steps = ['report', 'prioritise', 'assign', 'verify'] as const;
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-3xl font-extrabold">{t('about.title')}</h1>
        <p className="mt-2 text-ink-700">{t('about.intro')}</p>
      </header>
      <section>
        <h2 className="mb-3 text-xl font-bold">{t('about.howTitle')}</h2>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="card flex gap-4 p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white">{i + 1}</span>
              <div>
                <div className="font-semibold">{t(`about.steps.${s}.title`)}</div>
                <p className="text-sm text-ink-700">{t(`about.steps.${s}.text`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="card p-5">
        <h2 className="mb-2 text-xl font-bold">{t('about.principlesTitle')}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
          {(['humans', 'honest', 'privacy', 'offline'] as const).map((p) => <li key={p}>{t(`about.principles.${p}`)}</li>)}
        </ul>
      </section>
      <section className="card border-amber-400 bg-amber-50 p-5">
        <h2 className="mb-2 text-xl font-bold text-amber-900">{t('about.limitsTitle')}</h2>
        <p className="text-sm text-amber-900">{t('about.limits')}</p>
      </section>
      <div className="text-center"><Link to="/register" className="btn-primary">{t('landing.ctaRegister')}</Link></div>
    </div>
  );
}
