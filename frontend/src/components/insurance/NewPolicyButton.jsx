import { Link } from 'react-router-dom';
import { ShieldPlus } from 'lucide-react';
import Button from '../common/Button/Button';
import { useTenantContext } from '../../context/TenantContext';
import { useObjectPermissions } from '../../hooks/useObjectPermissions';

/**
 * "New policy" shortcut into the new business wizard, prefilled from the
 * current client (as main member) or lead (for attribution). Hidden when the
 * tenant has no insurance pack or the user can't create policies.
 */
const NewPolicyButton = ({ params }) => {
  const { getObject } = useTenantContext();
  const perms = useObjectPermissions('policy');
  if (!getObject('policy') || !perms.canCreate || !perms.canUpdate) return null;
  return (
    <Link to={`/insurance/new-business?${new URLSearchParams(params).toString()}`}>
      <Button variant="secondary" size="sm" icon={<ShieldPlus size={14} />}>
        New policy
      </Button>
    </Link>
  );
};

export default NewPolicyButton;
