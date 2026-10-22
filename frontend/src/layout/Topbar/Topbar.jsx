import styles from './Topbar.module.css';
import { useState, useRef, useEffect } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAppContext } from '../../context/AppContext';
import { useOnboarding } from '../../components/onboarding/OnboardingProvider';

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
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const navigate = useNavigate();
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target))
        setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target))
        setProfileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Track browser fullscreen state
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

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') setSearchQuery('');
  };

  const handleLogout = async () => {
    setProfileOpen(false);
    await logout();
    // Use setTimeout to ensure state updates are processed before navigation
    setTimeout(() => {
      navigate('/login', { replace: true });
    }, 0);
  };

  const isAdmin = user?.role?.name?.toLowerCase() === 'admin' || user?.role?.name?.toLowerCase() === 'superuser';

  return (
    <header
      className={`${styles.topbar} ${sidebarCollapsed ? styles.collapsed : ''}`}
    >
      <div className={styles.left}>
        {/* Mobile menu button */}
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
        >
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search records, users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <kbd className={styles.searchShortcut}>⌘K</kbd>
        </form>
      </div>

      <div className={styles.right}>
        {/* Theme toggle */}
        <button
          className={styles.iconBtn}
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        {/* Fullscreen toggle */}
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
                      {n.body && (
                        <span className={styles.notifBody}>{n.body}</span>
                      )}
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
                onClick={() => {
                  navigate('/profile');
                  setProfileOpen(false);
                }}
              >
                <User size={14} /> Profile
              </button>
              {isAdmin && (
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    navigate('/admin/settings');
                    setProfileOpen(false);
                  }}
                >
                  <Settings size={14} /> Settings
                </button>
              )}
              <button
                className={styles.dropdownItem}
                onClick={() => {
                  setProfileOpen(false);
                  openWelcome();
                }}
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
