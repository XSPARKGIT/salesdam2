import styles from './Topbar.module.css';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Bell,
  Sun,
  Moon,
  Menu,
  Settings,
  User,
  Maximize2,
  Minimize2,
  ChevronDown,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAppContext } from '../../context/AppContext';
import { useOnboarding } from '../../components/onboarding/OnboardingProvider';
import { globalSearch } from '../../services/api/search';

const Topbar = () => {
  const { user, logout } = useAuth();
  const { openWelcome } = useOnboarding();
  const {
    sidebarCollapsed,
    toggleTheme,
    toggleSidebar,
    theme,
    unreadCount,
    notifications,
    markNotificationRead,
    markAllRead,
  } = useAppContext();

  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownResults, setDropdownResults] = useState(null);
  const [dropdownLoading, setDropdownLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const navigate = useNavigate();
  const notifRef = useRef(null);
  const profileRef = useRef(null);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target))
        setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target))
        setProfileOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target))
        setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Debounced live search
  const runSearch = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setDropdownResults(null);
      setDropdownOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setDropdownLoading(true);
      setDropdownOpen(true);
      try {
        const res = await globalSearch(q.trim(), { limit: 8 });
        setDropdownResults(res.data.data);
      } catch {
        setDropdownResults(null);
      } finally {
        setDropdownLoading(false);
      }
    }, 250);
  }, []);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setActiveIdx(-1);
    runSearch(val);
  };

  // Flat list of all items for keyboard nav
  const allItems = [
    ...(dropdownResults?.users || []).map((u) => ({ type: 'user', data: u })),
    ...(dropdownResults?.records || []).map((r) => ({ type: 'record', data: r })),
  ];

  const closeDropdown = () => {
    setDropdownOpen(false);
    setActiveIdx(-1);
  };

  const navigateToItem = (item) => {
    if (item.type === 'user') {
      navigate(`/admin/users/${item.data._id}`);
    } else {
      navigate(`/o/${item.data.objectApiName}/${item.data.id}`);
    }
    setSearchQuery('');
    closeDropdown();
  };

  const goToFullSearch = () => {
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      closeDropdown();
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    goToFullSearch();
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      closeDropdown();
      return;
    }
    if (!dropdownOpen || allItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      navigateToItem(allItems[activeIdx]);
    }
  };

  const handleLogout = async () => {
    setProfileOpen(false);
    await logout();
    setTimeout(() => navigate('/login', { replace: true }), 0);
  };

  const isAdmin =
    user?.role?.name?.toLowerCase() === 'admin' ||
    user?.role?.name?.toLowerCase() === 'superuser';

  const initials = (u) =>
    `${u.firstName?.[0] || ''}${u.lastName?.[0] || ''}`.toUpperCase() || '?';

  const hasResults =
    dropdownResults &&
    (dropdownResults.users?.length > 0 || dropdownResults.records?.length > 0);

  return (
    <header className={`${styles.topbar} ${sidebarCollapsed ? styles.collapsed : ''}`}>
      <div className={styles.left}>
        <button
          className={styles.mobileMenuBtn}
          onClick={toggleSidebar}
          title="Toggle menu"
          aria-label="Toggle navigation menu"
        >
          <Menu size={20} />
        </button>

        {/* Global Search */}
        <form
          className={styles.searchForm}
          onSubmit={handleSearch}
          data-tour="search"
          ref={searchRef}
          style={{ position: 'relative' }}
        >
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search records, users..."
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => searchQuery.trim().length >= 2 && setDropdownOpen(true)}
            autoComplete="off"
          />
          {!searchQuery && <kbd className={styles.searchShortcut}>⌘K</kbd>}

          {/* Live dropdown */}
          {dropdownOpen && (
            <div className={styles.searchDropdown}>
              {dropdownLoading ? (
                <div className={styles.searchDropdownLoading}>Searching…</div>
              ) : !hasResults ? (
                <div className={styles.searchDropdownEmpty}>
                  No results for "{searchQuery}"
                </div>
              ) : (
                <>
                  {dropdownResults.users?.length > 0 && (
                    <div className={styles.searchDropdownSection}>
                      <div className={styles.searchDropdownLabel}>Users</div>
                      {dropdownResults.users.map((u, i) => {
                        const idx = i;
                        return (
                          <button
                            key={u._id}
                            type="button"
                            className={`${styles.searchDropdownItem} ${activeIdx === idx ? styles.active : ''}`}
                            onMouseEnter={() => setActiveIdx(idx)}
                            onClick={() => navigateToItem({ type: 'user', data: u })}
                          >
                            <div className={styles.searchDropdownItemIcon} style={{ background: '#e0e7ff', color: '#6366f1' }}>
                              {initials(u)}
                            </div>
                            <div className={styles.searchDropdownItemBody}>
                              <div className={styles.searchDropdownItemName}>
                                {u.firstName} {u.lastName}
                              </div>
                              <div className={styles.searchDropdownItemMeta}>{u.email}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {dropdownResults.users?.length > 0 && dropdownResults.records?.length > 0 && (
                    <div className={styles.searchDropdownDivider} />
                  )}

                  {dropdownResults.records?.length > 0 && (
                    <div className={styles.searchDropdownSection}>
                      <div className={styles.searchDropdownLabel}>Records</div>
                      {dropdownResults.records.map((r, i) => {
                        const idx = (dropdownResults.users?.length || 0) + i;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            className={`${styles.searchDropdownItem} ${activeIdx === idx ? styles.active : ''}`}
                            onMouseEnter={() => setActiveIdx(idx)}
                            onClick={() => navigateToItem({ type: 'record', data: r })}
                          >
                            <div className={styles.searchDropdownItemIcon}>
                              {r.objectLabel?.[0]?.toUpperCase() || '#'}
                            </div>
                            <div className={styles.searchDropdownItemBody}>
                              <div className={styles.searchDropdownItemName}>{r.recordName}</div>
                              <div className={styles.searchDropdownItemMeta}>{r.objectLabel}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    className={styles.searchDropdownFooter}
                    onClick={goToFullSearch}
                  >
                    <ArrowRight size={13} />
                    See all results for "{searchQuery}"
                  </button>
                </>
              )}
            </div>
          )}
        </form>
      </div>

      <div className={styles.right}>
        <button
          className={styles.iconBtn}
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <button
          className={styles.iconBtn}
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>

        {/* Notifications */}
        <div className={styles.dropdown} ref={notifRef}>
          <button
            className={`${styles.iconBtn} ${styles.notifBtn}`}
            onClick={() => setNotifOpen((o) => !o)}
            aria-label="Notifications"
            data-tour="notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className={styles.notifBadge}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className={`${styles.dropdownMenu} ${styles.notifMenu}`}>
              <div className={styles.dropdownHeader}>
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <button className={styles.markAllBtn} onClick={markAllRead}>
                    Mark all read
                  </button>
                )}
              </div>
              <div className={styles.notifList}>
                {notifications.length === 0 ? (
                  <div className={styles.notifEmpty}>No notifications</div>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n._id}
                      className={`${styles.notifItem} ${!n.isRead ? styles.unread : ''}`}
                      onClick={() => {
                        markNotificationRead(n._id);
                        if (n.link) {
                          navigate(n.link);
                          setNotifOpen(false);
                        }
                      }}
                    >
                      <strong className={styles.notifTitle}>{n.title}</strong>
                      {n.body && <span className={styles.notifBody}>{n.body}</span>}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className={styles.dropdown} ref={profileRef}>
          <button
            className={styles.profileBtn}
            onClick={() => setProfileOpen((o) => !o)}
            title="User menu"
            data-tour="profile"
          >
            <div className={styles.avatar}>
              {user?.avatar ? (
                <img src={user.avatar} alt={user.firstName} />
              ) : (
                <span>
                  {user?.firstName?.[0]}
                  {user?.lastName?.[0]}
                </span>
              )}
            </div>
            <div className={styles.profileName}>
              <span className={styles.userName}>
                {user?.firstName} {user?.lastName}
              </span>
              <ChevronDown size={16} className={styles.profileArrow} />
            </div>
          </button>

          {profileOpen && (
            <div className={`${styles.dropdownMenu} ${styles.profileMenu}`}>
              <div className={styles.profileInfo}>
                <strong>
                  {user?.firstName} {user?.lastName}
                </strong>
                <span>{user?.email}</span>
              </div>
              <hr className={styles.divider} />
              <button
                className={styles.dropdownItem}
                onClick={() => { navigate('/profile'); setProfileOpen(false); }}
              >
                <User size={14} /> Profile
              </button>
              {isAdmin && (
                <button
                  className={styles.dropdownItem}
                  onClick={() => { navigate('/admin/settings'); setProfileOpen(false); }}
                >
                  <Settings size={14} /> Settings
                </button>
              )}
              <button
                className={styles.dropdownItem}
                onClick={() => { setProfileOpen(false); openWelcome(); }}
              >
                <Sparkles size={14} /> Welcome guide
              </button>
              <button className={styles.dropdownItem} onClick={handleLogout}>
                <User size={14} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Topbar;
