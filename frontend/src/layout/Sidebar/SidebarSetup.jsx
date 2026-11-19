import {
  Settings,
  PieChart as PieChartIcon,
  Zap,
  Mail,
  Globe,
  Box,
  Briefcase,
  Shield,
  Send,
  FileText,
  ClipboardCheck,
  CopyCheck,
  List,
  Users2,
  KeyRound,
  Package,
  Radio,
  MessageCircle,
  FileCode,
} from 'lucide-react';
import SidebarNavItem from './SidebarNavItem';
import SidebarNavGroup from './SidebarNavGroup';
import { FEATURES } from '../../config/features';

const SidebarSetup = ({
  isAdmin,
  hasPermission,
  sidebarCollapsed,
  onNavigate,
}) => {
  const hasSetupAccess =
    isAdmin ||
    hasPermission('canManageObjects') ||
    hasPermission('canManageUsers') ||
    hasPermission('canManageRoles') ||
    hasPermission('canManageTenantSettings') ||
    hasPermission('canManageAutomations') ||
    hasPermission('canManageIntegrations') ||
    hasPermission('canManageCommunicationTemplates') ||
    hasPermission('canManageApprovals') ||
    hasPermission('canCustomizeApplication') ||
    hasPermission('canManageDocumentTemplates') ||
    hasPermission('canManageCustomCode') ||
    hasPermission('canDeployCustomCode') ||
    hasPermission('canImportData') ||
    hasPermission('canExportData');

  if (!hasSetupAccess) {
    return null;
  }

  return (
    <SidebarNavGroup
      label="Setup"
      icon={<Settings size={14} />}
      collapsed={sidebarCollapsed}
    >
      {FEATURES.dashboards && (
        <SidebarNavItem
          to="/dashboards"
          icon={<PieChartIcon size={15} />}
          label="Dashboards"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {FEATURES.automation && hasPermission('canManageAutomations') && (
        <SidebarNavItem
          to="/automation"
          icon={<Zap size={15} />}
          label="Automation"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {FEATURES.emailTemplates && hasPermission('canManageCommunicationTemplates') && (
        <SidebarNavItem
          to="/email-templates"
          icon={<Mail size={15} />}
          label="Email Templates"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {FEATURES.integrations && hasPermission('canManageIntegrations') && (
        <SidebarNavItem
          to="/integrations"
          icon={<Globe size={15} />}
          label="Integrations"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {hasPermission('canManageCommunicationTemplates') && (
        <SidebarNavItem
          to="/admin/channels"
          icon={<Radio size={15} />}
          label="Channel Accounts"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {hasPermission('canManageCommunicationTemplates') && (
        <SidebarNavItem
          to="/admin/message-templates"
          icon={<MessageCircle size={15} />}
          label="Message Templates"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageApprovals')) && (
        <SidebarNavItem
          to="/setup/approval-processes"
          icon={<ClipboardCheck size={15} />}
          label="Approval Processes"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageApprovals')) && (
        <SidebarNavItem
          to="/setup/approver-groups"
          icon={<Users2 size={15} />}
          label="Approver Groups"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageObjects')) && (
        <SidebarNavItem
          to="/setup/duplicate-rules"
          icon={<CopyCheck size={15} />}
          label="Duplicate Rules"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageObjects')) && (
        <SidebarNavItem
          to="/setup/global-value-sets"
          icon={<List size={15} />}
          label="Global Value Sets"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageObjects')) && (
        <SidebarNavItem
          to="/setup/objects"
          icon={<Box size={15} />}
          label="Object Settings"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
          dataTour="objects"
        />
      )}

      {(isAdmin || hasPermission('canCustomizeApplication')) && (
        <SidebarNavItem
          to="/workspaces"
          icon={<Briefcase size={15} />}
          label="Workspaces"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
          dataTour="workspaces"
        />
      )}

      {FEATURES.emailSenders &&
        (isAdmin || hasPermission('canManageTenantSettings')) && (
          <SidebarNavItem
            to="/admin/email-senders"
            icon={<Send size={15} />}
            label="Email Senders"
            collapsed={sidebarCollapsed}
            onNavigate={onNavigate}
          />
        )}

      {FEATURES.pdfTemplates && (isAdmin || hasPermission('canManageDocumentTemplates')) && (
        <SidebarNavItem
          to="/setup/pdf-templates"
          icon={<FileText size={16} />}
          label="PDF Templates"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageRoles')) && (
        <SidebarNavItem
          to="/admin/roles"
          icon={<Users2 size={16} />}
          label="Roles"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageRoles')) && (
        <SidebarNavItem
          to="/admin/permission-sets"
          icon={<KeyRound size={16} />}
          label="Permission Sets"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageTenantSettings') || hasPermission('canCustomizeApplication') || hasPermission('canImportData') || hasPermission('canExportData')) && (
        <SidebarNavItem
          to="/admin/settings"
          icon={<Shield size={16} />}
          label="Admin Settings"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canManageCustomCode')) && (
        <SidebarNavItem
          to="/admin/custom-code"
          icon={<FileCode size={15} />}
          label="Custom Code"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}

      {(isAdmin || hasPermission('canDeployCustomCode') || hasPermission('canManageCustomCode')) && (
        <SidebarNavItem
          to="/admin/deployments"
          icon={<Package size={16} />}
          label="Deployments"
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
        />
      )}
    </SidebarNavGroup>
  );
};

export default SidebarSetup;
