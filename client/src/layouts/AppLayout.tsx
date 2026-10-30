import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { NotificationBell } from '../components/NotificationBell';
import { homePathFor } from '../utils/format';
import type { Role } from '../types';

interface NavItem { to: string; label: string; icon: string; end?: boolean }

export function navFor(role: Role): NavItem[] {
  switch (role) {
    case 'citizen':
      return [
        { to: '/citizen', label: 'nav.dashboard', icon: '🏠', end: true },
        { to: '/citizen/sos', label: 'nav.sos', icon: '🆘' },
        { to: '/citizen/report', label: 'nav.report', icon: '📝' },
        { to: '/citizen/requests', label: 'nav.myRequests', icon: '📋' },
        { to: '/citizen/map', label: 'nav.map', icon: '🗺' },
        { to: '/citizen/shelters', label: 'nav.shelters', icon: '⛺' },
        { to: '/citizen/roads', label: 'nav.roads', icon: '🚧' },
      ];
    case 'volunteer':
    case 'team_leader':
      return [
        { to: '/responder', label: 'nav.assigned', icon: '📍', end: true },
        { to: '/responder/team', label: 'nav.team', icon: '👥' },
        { to: '/responder/map', label: 'nav.map', icon: '🗺' },
        { to: '/responder/roads', label: 'nav.roads', icon: '🚧' },
      ];
    case 'admin':
      return [
        { to: '/admin', label: 'nav.dashboard', icon: '📊', end: true },
        { to: '/admin/emergencies', label: 'nav.emergencies', icon: '🚨' },
        { to: '/admin/escalations', label: 'nav.escalations', icon: '⏱' },
        { to: '/admin/duplicates', label: 'nav.duplicates', icon: '🧬' },
        { to: '/admin/teams', label: 'nav.teams', icon: '👥' },
        { to: '/admin/verification', label: 'nav.verification', icon: '✅' },
        { to: '/admin/roads', label: 'nav.roadVerification', icon: '🚧' },
        { to: '/admin/shelters', label: 'nav.shelters', icon: '⛺' },
        { to: '/admin/food', label: 'nav.food', icon: '🍲' },
        { to: '/admin/users', label: 'nav.users', icon: '🧑‍🤝‍🧑' },
        { to: '/admin/map', label: 'nav.map', icon: '🗺' },
        { to: '/admin/audit', label: 'nav.audit', icon: '🧾' },
        { to: '/admin/settings', label: 'nav.settings', icon: '⚙' },
      ];
    case 'food_provider':
      return [
        { to: '/food', label: 'nav.inventory', icon: '📦', end: true },
        { to: '/food/requests', label: 'nav.foodRequests', icon: '🚚' },
      ];
    case 'shelter_coordinator':
      return [
        { to: '/shelter', label: 'nav.shelterProfile', icon: '⛺', end: true },
        { to: '/shelter/occupancy', label: 'nav.occupancy', icon: '🛏' },
      ];
  }
}

export function AppLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { online, pendingCount } = useOffline();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const items = navFor(user.role);

  const links = (
    <nav aria-label={t('nav.main')} className="flex flex-col gap-1 p-3">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100'}`}
        >
          <span aria-hidden className="w-5 text-center">{i.icon}</span>
          {t(i.label)}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[3000] focus:bg-white focus:p-2">{t('nav.skip')}</a>
      <aside className="hidden w-60 shrink-0 border-r border-ink-200 bg-white lg:block">
        <Link to={homePathFor(user.role)} className="flex items-center gap-2 border-b border-ink-200 px-4 py-4 text-lg font-extrabold text-brand-700">
          <span aria-hidden>🛟</span> {t('common.appName')}
        </Link>
        {links}
      </aside>
      {open && (
        <div className="fixed inset-0 z-[1400] lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.main')}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64 overflow-auto bg-white shadow-xl">{links}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[1100] flex items-center gap-2 border-b border-ink-200 bg-white px-3 py-2">
          <button className="btn-ghost lg:hidden" aria-label={t('nav.menu')} onClick={() => setOpen(true)}>☰</button>
          <Link to={homePathFor(user.role)} className="font-extrabold text-brand-700 lg:hidden">🛟 {t('common.appName')}</Link>
          <div className="flex-1" />
          <LanguageSwitcher />
          <NotificationBell />
          <Link to="/profile" className="hidden items-center gap-1 rounded-lg px-2 py-1 text-sm hover:bg-ink-100 sm:flex">
            <span aria-hidden>👤</span>
            <span className="max-w-32 truncate">{user.name}</span>
            <span className="rounded bg-ink-100 px-1.5 text-xs">{t(`role.${user.role}`)}</span>
          </Link>
          <button className="btn-secondary" onClick={() => { logout(); nav('/'); }}>{t('nav.signOut')}</button>
        </header>
        {(!online || pendingCount > 0) && (
          <div className={`px-4 py-2 text-sm font-medium ${online ? 'bg-amber-100 text-amber-900' : 'bg-ink-900 text-white'}`} role="status">
            {!online ? `📴 ${t('offline.banner')}` : `🔄 ${t('offline.pendingBanner', { count: pendingCount })}`}
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 pb-24 lg:p-6">
          <Outlet />
        </main>
        {user.role === 'citizen' && (
          <Link to="/citizen/sos" className="sos-pulse fixed bottom-4 right-4 z-[1200] flex h-16 w-16 items-center justify-center rounded-full bg-red-700 text-lg font-extrabold text-white shadow-xl lg:hidden" aria-label={t('nav.sos')}>
            SOS
          </Link>
        )}
      </div>
    </div>
  );
}

export function PublicLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="mr-auto text-lg font-extrabold text-brand-700">🛟 {t('common.appName')}</Link>
          <Link to="/about" className="text-sm font-medium hover:underline">{t('nav.about')}</Link>
          <Link to="/emergency-sms" className="text-sm font-medium hover:underline">{t('nav.smsFallback')}</Link>
          <LanguageSwitcher />
          {user ? (
            <Link className="btn-primary" to={homePathFor(user.role)}>{t('nav.openApp')}</Link>
          ) : (
            <>
              <Link className="btn-secondary" to="/login">{t('nav.login')}</Link>
              <Link className="btn-primary" to="/register">{t('nav.register')}</Link>
            </>
          )}
        </div>
      </header>
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-ink-200 bg-white py-4 text-center text-xs text-ink-500">{t('landing.footer')}</footer>
    </div>
  );
}
