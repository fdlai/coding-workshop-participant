import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Avatar, StatusBadge } from '../ui/Display';
import { fullName } from '../../utils/format';

const NAV_ITEMS = {
  admin: [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/projects', label: 'Projects' },
    { to: '/admin/users', label: 'People' },
    { to: '/admin/organization', label: 'Organization' },
    { to: '/admin/compensation', label: 'Compensation' },
    { to: '/admin/audit', label: 'Audit Logs' },
    { to: '/admin/archives', label: 'Archived Projects' },
  ],
  manager: [
    { to: '/manager', label: 'Dashboard', end: true },
    { to: '/projects', label: 'My Projects' },
    { to: '/team', label: 'Team' },
    { to: '/schedule', label: 'Schedule' },
  ],
  employee: [
    { to: '/employee', label: 'Dashboard', end: true },
    { to: '/schedule', label: 'My Schedule' },
    { to: '/projects', label: 'My Projects' },
  ],
};

const linkClass = ({ isActive }) =>
  `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

/** Horizontal top navigation: logo, role-based links, account menu. Collapses on mobile. */
export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const items = NAV_ITEMS[user.role] || [];

  function signOut() {
    logout();
    navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-[#DCE4F2]">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <span className="text-xl font-extrabold tracking-tight text-indigo-600">ACME</span>

          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>{item.label}</NavLink>
            ))}
          </nav>
          <div className="flex-1 lg:hidden" />

          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
            >
              <Avatar person={user} size="sm" />
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-medium leading-tight text-slate-800">{fullName(user)}</span>
                <span className="block text-xs capitalize leading-tight text-slate-500">{user.role}</span>
              </span>
            </button>
            {accountOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg" role="menu">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-slate-800">{fullName(user)}</p>
                  <StatusBadge status={user.role} />
                </div>
                <NavLink to="/profile" onClick={() => setAccountOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100" role="menuitem">Profile</NavLink>
                <button type="button" onClick={signOut} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50" role="menuitem">Sign out</button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            ☰
          </button>
        </div>

        {menuOpen && (
          <nav className="border-t border-slate-100 px-4 py-2 lg:hidden" aria-label="Mobile">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)} className={(state) => `block ${linkClass(state)}`}>{item.label}</NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
