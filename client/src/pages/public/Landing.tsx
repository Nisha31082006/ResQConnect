import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { homePathFor } from '../../utils/format';

export default function Landing() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const features = ['sos', 'priority', 'teams', 'offline', 'map', 'shelters'] as const;
  return (
    <div>
      <section className="bg-gradient-to-br from-brand-900 to-brand-600 px-4 py-16 text-white">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-extrabold sm:text-5xl">{t('landing.title')}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-red-50">{t('landing.subtitle')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to={user ? '/citizen/sos' : '/login'} className="sos-pulse rounded-xl bg-white px-6 py-3 text-lg font-extrabold text-red-800">🆘 {t('landing.ctaSos')}</Link>
            <Link to={user ? homePathFor(user.role) : '/register'} className="rounded-xl border-2 border-white px-6 py-3 text-lg font-bold">{user ? t('nav.openApp') : t('landing.ctaRegister')}</Link>
            <Link to="/emergency-sms" className="rounded-xl border-2 border-white/60 px-6 py-3 text-lg font-semibold">📱 {t('landing.ctaSms')}</Link>
          </div>
          <p className="mx-auto mt-6 max-w-xl text-xs text-red-100">{t('landing.disclaimer')}</p>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <article key={f} className="card p-5">
            <h2 className="text-lg font-bold">{t(`landing.features.${f}.title`)}</h2>
            <p className="mt-1 text-sm text-ink-700">{t(`landing.features.${f}.text`)}</p>
          </article>
        ))}
      </section>
      <section className="bg-white px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-6 text-center text-2xl font-bold">{t('landing.rolesTitle')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(['citizen', 'volunteer', 'team_leader', 'admin', 'food_provider', 'shelter_coordinator'] as const).map((r) => (
              <div key={r} className="rounded-lg border border-ink-200 p-4">
                <div className="font-semibold">{t(`role.${r}`)}</div>
                <p className="text-sm text-ink-500">{t(`landing.roles.${r}`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
