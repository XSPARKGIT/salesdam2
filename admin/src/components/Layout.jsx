import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Users, ScrollText,
  LogOut, Menu, X, ShieldCheck, ChevronRight, AlertTriangle, Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import AdminWelcomeModal from './onboarding/AdminWelcomeModal.jsx';
import './Layout.css';

const NAV = [
  { to: '/',           label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/incidents',  label: 'Incidents',  icon: AlertTriangle },
  { to: '/tenants',    label: 'Tenants',    icon: Building2 },
  { to: '/users',      label: 'Users',      icon: Users },
  { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText },
];

export default function Layout() {
  const { user, logout, saveOnboarding } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The welcome guide stays up on every visit until it is turned off.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const navigate = useNavigate();

  const closeSidebar = () => setSidebarOpen(false);

  const welcomeTurnedOff = Boolean(user?.preferences?.onboarding?.adminWelcomeSeenAt);
  const welcomeOpen = Boolean(user) && !welcomeTurnedOff && !welcomeDismissed;

  // Turning it back on clears the stored flag, so the guide returns.
  const restoreWelcome = async () => {
    await saveOnboarding({ adminWelcomeSeenAt: null });
    setWelcomeDismissed(false);
  };

  return (
    <div className="layout">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <ShieldCheck size={22} className="brand-icon" />
            <span>Super Admin</span>
          </div>
          <button className="sidebar-close" onClick={closeSidebar}><X size={18} /></button>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeSidebar}
            >
              <Icon size={18} />
              <span>{label}</span>
              <ChevronRight size={14} className="nav-arrow" />
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="user-meta">
              <div className="user-name">{user?.firstName} {user?.lastName}</div>
              <div className="user-role">Superuser</div>
            </div>
          </div>
          <button className="logout-btn" onClick={logout} title="Logout">
            <LogOut size={16} />
          </button>
        </div>

        {welcomeTurnedOff && (
          <button className="restore-welcome" onClick={restoreWelcome} title="Show the welcome guide again">
            <Sparkles size={14} />
            <span>Show welcome guide</span>
          </button>
        )}
      </aside>

      {/* Main */}
      <div className="main-area">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="topbar-title">CRM Admin</div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>

      {welcomeOpen && (
        <AdminWelcomeModal onDismiss={() => setWelcomeDismissed(true)} />
      )}
    </div>
  );
}
