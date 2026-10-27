import styles from './Sidebar.module.css';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { LayoutDashboard, ScrollText, AlertTriangle, Inbox } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getMyPendingApprovals } from '../../services/api/approvals';
import { useAuth } from '../../hooks/useAuth';
import { useAppContext } from '../../context/AppContext';
import { useTenantContext } from '../../context/TenantContext';
import SidebarHeader from './SidebarHeader';
import SidebarNavItem from './SidebarNavItem';
import SidebarObjects from './SidebarObjects';
import SidebarDashboards from './SidebarDashboards';
import SidebarSetup from './SidebarSetup';
import SidebarFooter from './SidebarFooter';
import { getNavScroll, setNavScroll } from './navScrollState';

const Sidebar = () => {
  const {
    user,
    tenant,
    logout,
    isAdmin,
    workspaces,
    activeWorkspace,
    switchWorkspace,
    hasPermission,
  } = useAuth();
  const tenantFeatures = tenant?.features || {};
  const { sidebarCollapsed, toggleSidebar } = useAppContext();
  const { objects, loadingObjects } = useTenantContext();
  const navigate = useNavigate();
  const location = useLocation();

  // Count for the "My Approvals" badge; refreshed alongside notifications.
  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['my-pending-approvals'],
    queryFn: getMyPendingApprovals,
    enabled: !!user,
    refetchInterval: 60000,
    staleTime: 0,
  });

  const [wsDropOpen, setWsDropOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropRef = useRef(null);
  const navRef = useRef(null);
  const navRestored = useRef(false);

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target))
        setWsDropOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    setWsDropOpen(false);
    await logout();
    setTimeout(() => {
      navigate('/login', { replace: true });
    }, 0);
  };

  // Called with the workspace id by the switcher, which shows the toast and
  // any error. Leaves an object page the new workspace doesn't include.
  const handleSwitchWorkspace = async (workspaceId) => {
    setSwitching(true);
    try {
      const ws = await switchWorkspace(workspaceId);
      setWsDropOpen(false);
      const defaultObj = ws?.defaultObjectApiName;
      if (defaultObj === '__home__') {
        navigate('/');
        return;
      }
      if (defaultObj) {
        navigate(`/o/${defaultObj}`);
        return;
      }
      // No default set — stay put unless we're on an object not in this workspace
      const objectApiName = location.pathname.match(/^\/o\/([^/]+)/)?.[1];
      const allowed = ws?.allowedObjects || [];
      if (objectApiName && allowed.length > 0 && !allowed.includes(objectApiName)) {
        navigate('/');
      }
    } finally {
      setSwitching(false);
    }
  };

  const handleMobileNav = () => {
    if (window.innerWidth <= 768 && !sidebarCollapsed) {
      toggleSidebar();
    }
  };

  const navObjects = objects
    .filter((o) => {
      if (!o.showInNav) return false;
      if (!activeWorkspace) return true;
      const allowed = activeWorkspace.allowedObjects;
      if (!allowed || allowed.length === 0) return true;
      return allowed.includes(o.apiName);
    })
    .sort((a, b) => a.navOrder - b.navOrder);

  // Restore the persisted nav scroll offset before the first paint, so the
  // remount that every navigation causes isn't visible as a jump to the top.
  // Objects arrive asynchronously on a cold load, so re-attempt until the list
  // has reached its final height — until then the browser would clamp us to 0.
  useLayoutEffect(() => {
    if (navRestored.current) return;
    const el = navRef.current;
    if (!el) return;

    const target = getNavScroll();
    if (target > 0) el.scrollTop = target;
    if (!loadingObjects) navRestored.current = true;
  }, [loadingObjects, navObjects.length]);

  // Only persist once the restore has settled, otherwise the scroll event fired
  // by a clamped restore attempt would overwrite the saved offset with 0.
  const handleNavScroll = (e) => {
    if (!navRestored.current) return;
    setNavScroll(e.currentTarget.scrollTop);
  };

  const objectGroups = activeWorkspace?.objectGroups || [];
  const displayName = activeWorkspace?.name || tenant?.name || 'Workspace';
  const displaySlug = activeWorkspace?.slug || tenant?.slug || '';
  const displayColor =
    activeWorkspace?.color ||
    tenant?.settings?.primaryColor ||
    'var(--color-primary)';
  const DisplayIcon = LucideIcons[activeWorkspace?.icon] || null;

  return (
    <>
      {!sidebarCollapsed && (
        <div
          className={styles.overlay}
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ''}`}
        data-tour="sidebar"
      >
        <SidebarHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          tenant={tenant}
          isAdmin={isAdmin}
          dropRef={dropRef}
          wsDropOpen={wsDropOpen}
          setWsDropOpen={setWsDropOpen}
          onSwitchWorkspace={handleSwitchWorkspace}
          switching={switching}
          displayName={displayName}
          displaySlug={displaySlug}
          displayColor={displayColor}
          DisplayIcon={DisplayIcon}
        />

        <nav
          className={styles.nav}
          ref={navRef}
          onScroll={handleNavScroll}
        >
          <SidebarNavItem
            to="/"
            icon={<LayoutDashboard size={17} />}
            label="Home"
            collapsed={sidebarCollapsed}
            onNavigate={handleMobileNav}
            dataTour="home"
          />

          <SidebarNavItem
            to="/approvals"
            icon={<Inbox size={17} />}
            label="My Approvals"
            badge={pendingApprovals.length > 0 ? String(pendingApprovals.length) : undefined}
            collapsed={sidebarCollapsed}
            onNavigate={handleMobileNav}
          />

          {tenantFeatures.enableSalesdamFeatures && tenantFeatures.salesdamFindTenders && (
            <SidebarNavItem
              to="/tenders"
              icon={<ScrollText size={18} />}
              label="Find Tenders"
              collapsed={sidebarCollapsed}
              onNavigate={handleMobileNav}
            />
          )}

          <SidebarObjects
            navObjects={navObjects}
            loadingObjects={loadingObjects}
            objectGroups={objectGroups}
            sidebarCollapsed={sidebarCollapsed}
            onNavigate={handleMobileNav}
          />

          <SidebarDashboards
            tenantFeatures={tenantFeatures}
            sidebarCollapsed={sidebarCollapsed}
          />

          <SidebarNavItem
            to="/incidents"
            icon={<AlertTriangle size={17} />}
            label="Incidents"
            collapsed={sidebarCollapsed}
            onNavigate={handleMobileNav}
          />

          <SidebarNavItem
            to="/admin/audit-logs"
            icon={<ScrollText size={17} />}
            label="Audit Logs"
            collapsed={sidebarCollapsed}
            onNavigate={handleMobileNav}
          />

          <SidebarSetup
            isAdmin={isAdmin}
            hasPermission={hasPermission}
            sidebarCollapsed={sidebarCollapsed}
            onNavigate={handleMobileNav}
          />
        </nav>

        <SidebarFooter
          user={user}
          sidebarCollapsed={sidebarCollapsed}
          onLogout={handleLogout}
        />
      </aside>
    </>
  );
};

export default Sidebar;
