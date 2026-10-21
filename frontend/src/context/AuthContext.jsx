import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import api from '../services/api';
import { WORKSPACES_CHANGED_EVENT } from './workspaceEvents';

const AuthContext = createContext(null);

const ACTIVE_WORKSPACE_KEY = 'activeWorkspaceId';

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * Choose the workspace to show: the one picked on this device, else the one
 * on the server session, else the default, else the first. An id that no
 * longer matches (deleted, or the user was removed) falls through instead of
 * leaving no workspace — which would show every object.
 */
const pickActiveWorkspace = (list, ...preferredIds) => {
  for (const id of preferredIds) {
    const match = id && list.find((w) => sameId(w._id, id));
    if (match) return match;
  }
  return list.find((w) => w.isDefault) || list[0] || null;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [workspaces, setWorkspaces] = useState([]); // workspaces user belongs to
  const [activeWorkspace, setActiveWorkspace] = useState(null); // currently selected
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState({});

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      const { user: userData, tenant: tenantData } = res.data.data;
      // Keep localStorage in sync so the API interceptor sends the correct X-Tenant-ID
      if (tenantData?._id)
        localStorage.setItem('tenantId', String(tenantData._id));

      // Ensure tenant has operating currency with fallback
      const enrichedTenant = {
        ...tenantData,
        operatingCurrency: tenantData?.operatingCurrency || {
          code: 'ZAR',
          name: 'South African Rand',
          symbol: 'R',
        },
      };

      setUser(userData);
      setTenant(enrichedTenant);

      // Workspaces this user belongs to (populated by getMe)
      const userWorkspaces = userData?.workspaces || [];
      setWorkspaces(userWorkspaces);

      const storedId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      const activeWs = pickActiveWorkspace(
        userWorkspaces,
        storedId,
        userData?.activeWorkspaceId,
      );
      setActiveWorkspace(activeWs);
      if (activeWs) localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(activeWs._id));
      else localStorage.removeItem(ACTIVE_WORKSPACE_KEY);

      buildPermissions(userData);
    } catch (err) {
      setUser(null);
      setTenant(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const buildPermissions = (userData) => {
    if (!userData) return;

    // Safely resolve role name
    const roleName = userData.role?.name?.toLowerCase?.();

    const perms = {
      roleName,
    };

    // Superuser / Admin privileges
    if (roleName === 'superuser' || roleName === 'admin') {
      perms.isAdmin = true;
      perms.canManageUsers = true;
      perms.canManageRoles = true;
      perms.canManageObjects = true;
      perms.canManageAutomations = true;
      perms.canManageIntegrations = true;
      perms.canViewAnalytics = true;
      perms.canManageAnalytics = true;
      perms.canViewAuditLog = true;
      perms.canManageTenantSettings = true;
      perms.canManageApiKeys = true;
      perms.canManageWebhooks = true;
    }

    // Merge role-level app permissions (additive)
    if (userData.role?.appPermissions) {
      Object.entries(userData.role.appPermissions).forEach(([key, val]) => {
        if (val) perms[key] = true;
      });
    }

    setPermissions(perms);
  };

  const login = async (username, password, tenantId) => {
    const res = await api.post('/auth/login', { username, password, tenantId });
    const { user: userData, tenant: tenantData } = res.data.data;
    if (tenantData?._id)
      localStorage.setItem('tenantId', String(tenantData._id));
    setUser(userData);
    setTenant(tenantData);
    buildPermissions(userData);
    // Workspaces are loaded in full by the subsequent /auth/me call from fetchMe
    await fetchMe();
    return res.data;
  };

  const register = async (data) => {
    const res = await api.post('/auth/register', data);
    const { user: userData, tenant: tenantData } = res.data.data;
    if (tenantData?._id)
      localStorage.setItem('tenantId', String(tenantData._id));
    setUser(userData);
    setTenant(tenantData);
    buildPermissions(userData);
    return res.data;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {}
    localStorage.removeItem('tenantId');
    setUser(null);
    setTenant(null);
    setWorkspaces([]);
    setActiveWorkspace(null);
    setPermissions({});
  };

  /**
   * Reload the user's workspaces (e.g. after an admin edits one), keeping the
   * current selection when it still exists.
   */
  const refreshWorkspaces = useCallback(async (preferredId) => {
    const res = await api.get('/workspaces/mine');
    const list = res.data.data || [];
    // localStorage always mirrors the current selection, so it stands in for it.
    const next = pickActiveWorkspace(list, preferredId, localStorage.getItem(ACTIVE_WORKSPACE_KEY));
    setWorkspaces(list);
    setActiveWorkspace(next);
    if (next) localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(next._id));
    else localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    return { list, active: next };
  }, []);

  /**
   * Switch the active workspace. The server validates membership and records
   * it on the session; the list is refreshed so the new workspace's objects
   * and groups are current. Throws with the server's message on failure.
   */
  const switchWorkspace = async (workspaceId) => {
    try {
      await api.post('/workspaces/switch', { workspaceId });
    } catch (err) {
      throw new Error(err.response?.data?.message || 'Failed to switch workspace.');
    }
    const res = await api.get('/workspaces/mine').catch(() => null);
    const list = res?.data?.data || workspaces;
    const ws = list.find((w) => sameId(w._id, workspaceId));
    if (!ws) throw new Error('That workspace is no longer available.');
    setWorkspaces(list);
    setActiveWorkspace(ws);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(ws._id));
    return ws;
  };

  useEffect(() => {
    if (!user) return undefined;
    const onChanged = () => {
      refreshWorkspaces().catch(() => {});
    };
    window.addEventListener(WORKSPACES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(WORKSPACES_CHANGED_EVENT, onChanged);
  }, [user, refreshWorkspaces]);

  const updateUser = (updates) => {
    setUser((prev) => ({ ...prev, ...updates }));
  };

  const hasPermission = (key) => {
    const userRoleName = user?.role?.name?.toLowerCase();

    if (userRoleName === 'superuser') return true;
    return !!permissions[key];
  };

  const canAccessObject = (objectApiName, action = 'read') => {
    const userRoleName = user?.role?.name?.toLowerCase();
    if (userRoleName === 'superuser' || userRoleName === 'admin') return true;
    if (!user?.role) return false;
    return user.role.can && user.role.can(action, objectApiName);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        loading,
        permissions,
        workspaces,
        activeWorkspace,
        login,
        register,
        logout,
        switchWorkspace,
        refreshWorkspaces,
        updateUser,
        fetchMe,
        hasPermission,
        canAccessObject,
        isAuthenticated: !!user,
        isSuperuser: user?.role?.name?.toLowerCase() === 'superuser',
        isAdmin: ['superuser', 'admin'].includes(
          user?.role?.name?.toLowerCase(),
        ),
        // Expose common permissions directly for convenience
        canManageUsers: permissions.canManageUsers,
        canManageRoles: permissions.canManageRoles,
        canManageObjects: permissions.canManageObjects,
        canManageAutomations: permissions.canManageAutomations,
        canManageIntegrations: permissions.canManageIntegrations,
        canViewAnalytics: permissions.canViewAnalytics,
        canManageAnalytics: permissions.canManageAnalytics,
        canViewAuditLog: permissions.canViewAuditLog,
        canManageTenantSettings: permissions.canManageTenantSettings,
        canManageApiKeys: permissions.canManageApiKeys,
        canManageWebhooks: permissions.canManageWebhooks,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
};

export default AuthContext;
