import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { getObjects } from '../services/api/objects';
import { useAuthContext } from './AuthContext';

const TenantContext = createContext(null);

export const TenantProvider = ({ children }) => {
  const { tenant, isAuthenticated, activeWorkspace, isAdmin, permissions } = useAuthContext();
  // Objects of the active workspace the user can read (scoped by the server).
  const [objects, setObjects] = useState([]);
  // Full catalogue for setup pages; same as `objects` for users who don't manage setup.
  const [allObjects, setAllObjects] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(false);
  // True once the first object list has arrived, so guards don't judge an empty initial list.
  const [objectsLoaded, setObjectsLoaded] = useState(false);

  const canManageSetup = isAdmin || !!permissions?.canManageObjects || !!permissions?.canManageRoles;

  const fetchObjects = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoadingObjects(true);
    try {
      const [scoped, all] = await Promise.all([
        getObjects({ navOnly: 'false', includeFields: 'true' }),
        canManageSetup ? getObjects({ navOnly: 'false', includeFields: 'true', scope: 'all' }) : null,
      ]);
      setObjects(scoped || []);
      setAllObjects(all || scoped || []);
    } catch (err) {
      // Silently fail
    } finally {
      setLoadingObjects(false);
      setObjectsLoaded(true);
    }
  }, [isAuthenticated, canManageSetup]);

  // Re-run whenever the active tenant or workspace changes — objects are
  // scoped to the active workspace, so a switch must show only its objects.
  useEffect(() => {
    if (isAuthenticated) {
      fetchObjects();
    } else {
      setObjects([]);
      setAllObjects([]);
      setObjectsLoaded(false);
    }
  }, [isAuthenticated, fetchObjects, tenant?._id, activeWorkspace?._id]);

  const getObject = (apiName) => objects.find((o) => o.apiName === apiName);

  const refreshObjects = () => fetchObjects();

  return (
    <TenantContext.Provider
      value={{
        tenant,
        objects,
        allObjects,
        loadingObjects,
        objectsLoaded,
        getObject,
        refreshObjects,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

export const useTenantContext = () => {
  const ctx = useContext(TenantContext);
  if (!ctx)
    throw new Error('useTenantContext must be used within TenantProvider');
  return ctx;
};

export default TenantContext;
