import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

// Same rule the API enforces on every /superadmin route (requireSuperuser):
// the user's role must be 'superuser'. (User has no systemRole field, so a
// check on it failed after every reload and signed the operator out.)
const isPlatformOperator = (u) => u?.role?.name === 'superuser';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      const u = res.data.data?.user;
      if (!isPlatformOperator(u)) {
        setUser(null);
        localStorage.removeItem('admin_tenantId');
      } else {
        setUser(u);
        const tid = res.data.data?.tenant?._id;
        if (tid) localStorage.setItem('admin_tenantId', tid);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password, isAdminLogin: true });
    const u = res.data.data?.user;
    const t = res.data.data?.tenant;
    if (!isPlatformOperator(u)) {
      await api.post('/auth/logout').catch(() => {});
      throw new Error('You do not have access to the admin dashboard.');
    }
    if (t?._id) localStorage.setItem('admin_tenantId', t._id);
    setUser(u);
    return u;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    setUser(null);
    localStorage.removeItem('admin_tenantId');
    window.location.href = '/login';
  };

  const updateUser = useCallback((updates) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  /**
   * The platform console's welcome guide is stored on the user's own
   * preferences (PATCH /users/me/profile -> user.preferences.onboarding), so
   * it follows the person rather than the browser. Only the onboarding group
   * is sent: the API merges preferences one level deep, so theme, language and
   * notification settings are left untouched.
   */
  const saveOnboarding = useCallback(
    async (patch) => {
      const onboarding = { ...(user?.preferences?.onboarding || {}), ...patch };
      updateUser({
        preferences: { ...(user?.preferences || {}), onboarding },
      });
      try {
        await api.patch('/users/me/profile', { preferences: { onboarding } });
      } catch {
        // A failed save just means the guide is offered again next time.
      }
    },
    [user, updateUser],
  );

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, fetchMe, updateUser, saveOnboarding }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
