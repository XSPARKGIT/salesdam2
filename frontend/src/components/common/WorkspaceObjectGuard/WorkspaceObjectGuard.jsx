import { useParams, Link } from 'react-router-dom';
import { useTenantContext } from '../../../context/TenantContext';
import { useAuth } from '../../../hooks/useAuth';
import Layout from '../../../layout/Layout';

/**
 * Only renders an object's pages (list, new, kanban, merge, recycle bin) when
 * the object is in the active workspace and the user's role can read it — the
 * same list the server returns for /objects. Typing another object's URL shows
 * a message instead of the page. The server enforces the same rules on its APIs.
 */
const WorkspaceObjectGuard = ({ children }) => {
  const { objectApiName } = useParams();
  const { objects, objectsLoaded } = useTenantContext();
  const { activeWorkspace } = useAuth();

  if (!objectsLoaded) return null;

  const available =
    (activeWorkspace?.allowedObjects || []).includes(objectApiName) &&
    objects.some((o) => o.apiName === objectApiName);
  if (available) return children;

  return (
    <Layout title="Not available">
      <div
        role="alert"
        data-testid="object-not-available"
        style={{ maxWidth: 520, margin: '64px auto', padding: '0 16px', textAlign: 'center' }}
      >
        <h2 style={{ fontSize: 18, margin: '0 0 8px', color: 'var(--color-gray-900)' }}>
          This object isn't available
        </h2>
        <p style={{ fontSize: 14, margin: '0 0 16px', color: 'var(--color-gray-500)' }}>
          It isn't part of the {activeWorkspace?.name ? `"${activeWorkspace.name}"` : 'current'} workspace,
          or you don't have permission to view it.
        </p>
        <Link to="/" style={{ fontSize: 14, color: 'var(--color-primary)' }}>
          Go to Home
        </Link>
      </div>
    </Layout>
  );
};

export default WorkspaceObjectGuard;
