import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

/**
 * Shared branding resolver for the frontend.
 * Reads effective branding from TenantConfiguration via /configuration
 * (tenant override → system default → safe platform fallback).
 */
export const useBranding = () => {
  const { data: entries = [] } = useQuery({
    queryKey: ['tenant-configuration'],
    queryFn: () => api.get('/configuration').then((r) => r.data?.data || []),
    staleTime: 60_000,
  });

  const get = (key, fallback) => {
    const e = entries.find((x) => x.key === key);
    return e?.value ?? fallback;
  };

  return {
    companyName: get('branding.company_name', 'Salesdam'),
    primaryColor: get('branding.primary_color', '#0066FF'),
    logoUrl: get('branding.logo_url', ''),
    loginLogoUrl: get('branding.login_logo_url', ''),
  };
};

export default useBranding;
