import React, { useState } from 'react';
import {
  Info,
  Target,
  FileText,
  Mail,
  FileUp,
  FileDown,
  CreditCard,
  Settings,
  Users,
  Shield,
  Download,
  AlertTriangle,
  Plug,
  Scroll,
  CheckCircle2,
  HardDrive,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import Layout from '../../layout/Layout';
import Accordion from '../../components/common/Accordion/Accordion';
import SettingsCard from '../../components/admin/SettingsCard/SettingsCard';
import DeleteTenantModal from '../../components/DeleteTenantModal/DeleteTenantModal';
import api from '../../services/api';
import styles from './AdminSettings.module.css';

// Settings groups will be populated in the component to have access to state
const getSettingsGroups = (onDeleteClick, features = {}) => [
  {
    id: 'company-settings',
    title: 'Company Settings',
    icon: Info,
    content: (
      <div className={styles.cardsGrid}>
        <SettingsCard
          title="Company Information"
          description="Name, address, contact details and financial year settings"
          icon={Info}
          color="#6366f1"
          href="/admin/settings/company-info"
        />
        <SettingsCard
          title="Revenue & Sales Targets"
          description="Set quarterly revenue and sales targets for your team"
          icon={Target}
          color="#10b981"
          href="/admin/settings/sales-targets"
        />
        <SettingsCard
          title="Invoice & Quote Settings"
          description="Business info, banking details, numbering, terms and display preferences"
          icon={FileText}
          color="#f59e0b"
          href="/admin/settings/invoice-quote"
        />
      </div>
    ),
  },
  {
    id: 'roles-permissions',
    title: 'Roles and Permissions',
    icon: Shield,
    content: (
      <div className={styles.cardsGrid}>
        <SettingsCard
          title="Manage Users"
          description="Add, edit, or remove user accounts and manage their roles"
          icon={Users}
          color="#0ea5e9"
          href="/admin/users"
        />
        <SettingsCard
          title="Roles and Permissions"
          description="Configure custom roles and define field-level permissions"
          icon={Shield}
          color="#8b5cf6"
          href="/admin/roles"
        />
        <SettingsCard
          title="Storage Usage"
          description="View workspace storage consumption breakdown by object"
          icon={HardDrive}
          color="#06b6d4"
          href="/admin/settings/storage-usage"
        />
      </div>
    ),
  },
  {
    id: 'email-config',
    title: 'Email Configuration',
    icon: Mail,
    content: (
      <div className={styles.cardsGrid}>
        <SettingsCard
          title="Email Configuration"
          description="Configure outbound SMTP senders and email delivery settings"
          icon={Mail}
          color="#0ea5e9"
          href="/admin/settings/email"
        />
      </div>
    ),
  },
  {
    id: 'data-import-export',
    title: 'Data Import and Export',
    icon: Download,
    content: (
      <div className={styles.cardsGrid}>
        <SettingsCard
          title="Data Import"
          description="Upload a CSV to import records into any object with column mapping"
          icon={FileUp}
          color="#8b5cf6"
          href="/admin/settings/data-import"
        />
        <SettingsCard
          title="Data Export"
          description="Download all records from any object as CSV or JSON"
          icon={FileDown}
          color="#06b6d4"
          href="/admin/settings/data-export"
        />
      </div>
    ),
  },
  {
    id: 'billing-subscription',
    title: 'Billing and Subscription',
    icon: CreditCard,
    content: (
      <div className={styles.cardsGrid}>
        <SettingsCard
          title="Billing & Subscription"
          description="Manage your plan, billing cycle, and invoice history"
          icon={CreditCard}
          color="#f97316"
          href="/admin/settings/billing"
        />
      </div>
    ),
  },
  {
    id: 'integrations',
    title: 'Integrations',
    icon: Plug,
    content: (
      <div className={styles.cardsGrid}>
        <SettingsCard
          title="External Integrations"
          description="Connect Salesdam to external applications with auto-generated access tokens"
          icon={Plug}
          color="#8b5cf6"
          href="/admin/settings/integrations"
        />
      </div>
    ),
  },
  {
    id: 'other',
    title: 'Other',
    icon: Settings,
    content: (
      <div className={styles.cardsGrid}>
        {features?.salesdamFindTenders && (
          <SettingsCard
            title="Tenders Config"
            description="Manage tender search filters — From Date, To Date, Department, Province, and Category"
            icon={Scroll}
            color="#f59e0b"
            href="/admin/settings/tenders-config"
          />
        )}
        <SettingsCard
          title="Lead Approval Settings"
          description="Configure whether leads require approval before conversion to deals"
          icon={CheckCircle2}
          color="#10b981"
          href="/admin/settings/lead-approvals"
        />
        <SettingsCard
          title="Backup & Recovery"
          description="Create and verify tenant backups"
          icon={HardDrive}
          color="#0ea5e9"
          href="/admin/backup-recovery"
        />
        <SettingsCard
          title="Other Settings"
          description="Salesdam feature flags and miscellaneous platform settings"
          icon={Settings}
          color="#64748b"
          href="/admin/settings/other"
        />
      </div>
    ),
  },
  {
    id: 'danger-zone',
    title: 'Danger Zone',
    icon: AlertTriangle,
    content: (
      <div className={styles.cardsGrid}>
        <SettingsCard
          title="Delete Workspace"
          description="Permanently delete this workspace and all associated data. This action cannot be undone."
          icon={AlertTriangle}
          color="#dc2626"
          onClick={onDeleteClick}
          isDangerous
        />
      </div>
    ),
  },
];

export default function AdminSettings() {
  const { isAdmin, tenant, isSuperuser } = useAuth();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [features, setFeatures] = useState({});

  React.useEffect(() => {
    api.get('/admin/settings').then(res => {
      if (res.data?.data?.features) {
        setFeatures(res.data.data.features);
      }
    }).catch(err => console.error('Failed to load features:', err));
  }, []);

  if (!isAdmin) {
    return (
      <Layout title="Admin Settings">
        <div className={styles.accessDenied}>
          <Shield size={40} />
          <h2>Access Denied</h2>
          <p>Only System Administrators can access these settings.</p>
        </div>
      </Layout>
    );
  }

  const settingsGroups = getSettingsGroups(() => setDeleteModalOpen(true), features);

  return (
    <Layout
      title="Admin Settings"
      description="System administration settings — restricted to administrators"
    >
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Admin Settings</h1>
          <p className={styles.pageDesc}>
            Configure system-wide settings. Only System Admins have access.
          </p>
        </div>
        <Accordion items={settingsGroups} expandAll />
      </div>

      {isSuperuser && (
        <DeleteTenantModal
          tenant={tenant}
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          onSuccess={() => window.location.href = '/'}
        />
      )}
    </Layout>
  );
}
