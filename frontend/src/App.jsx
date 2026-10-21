import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Layout from './layout/Layout';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import Verification from './pages/auth/Verification';
import PaymentCallback from './pages/auth/PaymentCallback';
import Dashboard from './pages/Dashboard/Dashboard';
import Profile from './pages/Profile/Profile';
import RecordList from './pages/Records/RecordList/RecordList';
import RecordDetail from './pages/Records/RecordDetail/RecordDetail';
import RecordForm from './pages/Records/RecordForm/RecordForm';
import RecordMerge from './pages/Records/RecordMerge/RecordMerge';
import ObjectsManager from './pages/Objects/ObjectsManager';
import ObjectBuilder from './pages/Objects/ObjectBuilder';
import SchemaBuilder from './pages/Objects/SchemaBuilder';
import SearchPage from './pages/Search/SearchPage';
import AutomationList from './pages/Automation/AutomationList';
import FlowBuilder from './pages/Automation/FlowBuilder';
import Analytics from './pages/Analytics/Analytics';
import UserManagement from './pages/Admin/UserManagement/UserManagement';
import UserDetail from './pages/Admin/UserDetail';
import UserForm from './pages/Admin/UserForm';
import RoleManagement from './pages/Admin/RoleManagement';
import RoleForm from './pages/Admin/RoleForm';
import EmailSenders from './pages/Admin/EmailSenders';
import WorkspaceManager from './pages/Workspaces/WorkspaceManager';
import WorkspaceDetail from './pages/Workspaces/WorkspaceDetail';
import AIOnboarding from './pages/Onboarding/AIOnboarding';
import LayoutBuilder from './pages/Layouts/LayoutBuilder';
import EmailTemplateList from './pages/EmailTemplates/EmailTemplateList';
import EmailTemplateEditor from './pages/EmailTemplates/EmailTemplateEditor';
import IntegrationsPage from './pages/Integrations/IntegrationsPage';
import DashboardList from './pages/Dashboards/DashboardList';
import DashboardView from './pages/Dashboards/DashboardView';
import DashboardBuilder from './pages/Dashboards/DashboardBuilder';
import PdfTemplateList from './pages/PdfTemplates/PdfTemplateList';
import PdfTemplateEditor from './pages/PdfTemplates/PdfTemplateEditor';
import AdminSettings from './pages/Admin/AdminSettings';
import CompanyInfo from './pages/Admin/settings/CompanyInfo';
import SalesTargets from './pages/Admin/settings/SalesTargets';
import InvoiceQuote from './pages/Admin/settings/InvoiceQuote';
import EmailConfiguration from './pages/Admin/settings/EmailConfiguration';
import DataImport from './pages/Admin/settings/DataImport';
import DataExport from './pages/Admin/settings/DataExport';
import Billing from './pages/Admin/settings/Billing';
import Integrations from './pages/Admin/settings/Integrations';
import OtherSettings from './pages/Admin/settings/OtherSettings';
import TendersConfig from './pages/Admin/settings/TendersConfig';
import LeadApprovalSettings from './pages/Admin/settings/LeadApprovalSettings';
import ApprovalProcessList from './pages/Approvals/ApprovalProcessList';
import ApprovalProcessEditor from './pages/Approvals/ApprovalProcessEditor';
import MyApprovals from './pages/Approvals/MyApprovals';
import DuplicateRules from './pages/DuplicateRules/DuplicateRules';
import StorageUsage from './pages/Admin/settings/StorageUsage';
import Tenders from './pages/Tenders/Tenders';
import OrdersDashboard from './pages/SalesdamDashboards/OrdersDashboard/OrdersDashboard';
import AccountingDashboard from './pages/SalesdamDashboards/AccountingDashboard/AccountingDashboard';
import DealsDashboard from './pages/SalesdamDashboards/DealsDashboard/DealsDashboard';
import LeadsDashboard from './pages/SalesdamDashboards/LeadsDashboard/LeadsDashboard';
import RevenueDashboard from './pages/SalesdamDashboards/RevenueDashboard/RevenueDashboard';
import SalesDashboard from './pages/SalesdamDashboards/SalesDashboard/SalesDashboard';
import ROIDashboard from './pages/SalesdamDashboards/ROIDashboard/ROIDashboard';
import NotFound from './pages/NotFound';
import IncidentList from './pages/Incidents/IncidentList';
import IncidentDetail from './pages/Incidents/IncidentDetail';
import CreateIncident from './pages/Incidents/CreateIncident';
import IncidentManagement from './pages/Admin/IncidentManagement';
import IncidentMonitoring from './pages/InternalAdmin/IncidentMonitoring';
import TaskCalendarView from './pages/Tasks/TaskCalendarView';

import { FEATURES } from './config/features';

import styles from './App.module.css';

const Guard = ({
  requireSuperuser,
  requireAdmin,
  requirePermission,
  children,
}) => {
  const { user, loading, hasPermission, isAdmin } = useAuth();
  if (loading)
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    );

  const roleName = user?.role?.name;

  if (!user) return <Navigate to="/login" replace />;
  if (requireSuperuser && roleName !== 'superuser')
    return <Navigate to="/" replace />;
  if (requireAdmin && !['superuser', 'admin'].includes(roleName))
    return <Navigate to="/" replace />;
  if (requirePermission && !isAdmin && !hasPermission(requirePermission))
    return <Navigate to="/" replace />;
  return children;
};

// Public: only accessible when NOT logged in (redirects to app if logged in)
const Public = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
};

export default function App() {
  return (
    <Routes>
      {/* Public login/register — redirect to app if already logged in */}
      <Route
        path="/login"
        element={
          <Public>
            <Login />
          </Public>
        }
      />
      <Route
        path="/register"
        element={
          <Public>
            <Register />
          </Public>
        }
      />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/auth/verify"
        element={
          <Public>
            <Verification />
          </Public>
        }
      />
      <Route
        path="/verify-email"
        element={
          <Public>
            <Verification />
          </Public>
        }
      />
      <Route path="/auth/payment/callback" element={<PaymentCallback />} />
      <Route path="/payment/callback" element={<PaymentCallback />} />
      <Route path="/payment-callback" element={<PaymentCallback />} />

      {/* Onboarding (auth required, no main layout) */}
      <Route
        path="/onboarding"
        element={
          <Guard>
            <AIOnboarding />
          </Guard>
        }
      />

      {/* CRM home (after login) */}
      <Route
        path="/"
        element={
          <Guard>
            <Dashboard />
          </Guard>
        }
      />
      <Route
        path="/o/:objectApiName"
        element={
          <Guard>
            <RecordList />
          </Guard>
        }
      />
      <Route
        path="/o/:objectApiName/new"
        element={
          <Guard>
            <RecordForm />
          </Guard>
        }
      />
      <Route
        path="/o/:objectApiName/merge"
        element={
          <Guard>
            <RecordMerge />
          </Guard>
        }
      />
      <Route
        path="/o/:objectApiName/:id"
        element={
          <Guard>
            <RecordDetail />
          </Guard>
        }
      />
      <Route
        path="/o/:objectApiName/:id/edit"
        element={
          <Guard>
            <RecordForm />
          </Guard>
        }
      />

      <Route
        path="/o/task/calendar"
        element={
          <Guard>
            <TaskCalendarView />
          </Guard>
        }
      />

      <Route
        path="/o/:objectApiName/kanban"
        element={
          <Guard>
            <RecordList />
          </Guard>
        }
      />

      <Route
        path="/setup/objects"
        element={
          <Guard requireAdmin>
            <ObjectsManager />
          </Guard>
        }
      />
      <Route
        path="/setup/objects/new"
        element={
          <Guard requireAdmin>
            <ObjectBuilder />
          </Guard>
        }
      />
      <Route
        path="/setup/objects/:apiName"
        element={
          <Guard requireAdmin>
            <ObjectBuilder />
          </Guard>
        }
      />
      <Route
        path="/setup/objects/:apiName/layout"
        element={
          <Guard requireAdmin>
            <LayoutBuilder />
          </Guard>
        }
      />
      <Route
        path="/setup/schema-builder"
        element={
          <Guard requireAdmin>
            <SchemaBuilder />
          </Guard>
        }
      />

      {FEATURES.pdfTemplates && (
        <Route
          path="/setup/pdf-templates"
          element={
            <Guard requireAdmin>
              <PdfTemplateList />
            </Guard>
          }
        />
      )}

      {FEATURES.pdfTemplates && (
        <Route
          path="/setup/pdf-templates/new"
          element={
            <Guard requireAdmin>
              <PdfTemplateEditor />
            </Guard>
          }
        />
      )}

      {FEATURES.pdfTemplates && (
        <Route
          path="/setup/pdf-templates/:id"
          element={
            <Guard requireAdmin>
              <PdfTemplateEditor />
            </Guard>
          }
        />
      )}

      {FEATURES.automation && (
        <Route
          path="/automation"
          element={
            <Guard requirePermission="canManageAutomations">
              <AutomationList />
            </Guard>
          }
        />
      )}

      {FEATURES.automation && (
        <Route
          path="/automation/new"
          element={
            <Guard requirePermission="canManageAutomations">
              <FlowBuilder />
            </Guard>
          }
        />
      )}

      {FEATURES.automation && (
        <Route
          path="/automation/:id"
          element={
            <Guard requirePermission="canManageAutomations">
              <FlowBuilder />
            </Guard>
          }
        />
      )}

      {FEATURES.dashboards && (
        <Route
          path="/dashboards"
          element={
            <Guard>
              <DashboardList />
            </Guard>
          }
        />
      )}

      {FEATURES.dashboards && (
        <Route
          path="/dashboards/:id"
          element={
            <Guard>
              <DashboardView />
            </Guard>
          }
        />
      )}

      <Route
        path="/dashboards/:id/edit"
        element={
          <Guard>
            <DashboardBuilder />
          </Guard>
        }
      />

      {FEATURES.emailTemplates && (
        <Route
          path="/email-templates"
          element={
            <Guard requirePermission="canManageAutomations">
              <EmailTemplateList />
            </Guard>
          }
        />
      )}

      <Route
        path="/email-templates/new"
        element={
          <Guard requirePermission="canManageAutomations">
            <EmailTemplateEditor />
          </Guard>
        }
      />
      <Route
        path="/email-templates/:id"
        element={
          <Guard requirePermission="canManageAutomations">
            <EmailTemplateEditor />
          </Guard>
        }
      />

      {FEATURES.integrations && (
        <Route
          path="/integrations"
          element={
            <Guard requirePermission="canManageIntegrations">
              <IntegrationsPage />
            </Guard>
          }
        />
      )}

      <Route
        path="/analytics"
        element={
          <Guard requirePermission="canViewAnalytics">
            <Analytics />
          </Guard>
        }
      />
      <Route
        path="/search"
        element={
          <Guard>
            <SearchPage />
          </Guard>
        }
      />

      <Route
        path="/incidents"
        element={
          <Guard>
            <IncidentList />
          </Guard>
        }
      />
      <Route
        path="/incidents/new"
        element={
          <Guard>
            <CreateIncident />
          </Guard>
        }
      />
      <Route
        path="/incidents/:id"
        element={
          <Guard>
            <IncidentDetail />
          </Guard>
        }
      />

      <Route
        path="/internal-admin/incidents"
        element={
          <Guard requireSuperuser>
            <IncidentMonitoring />
          </Guard>
        }
      />

      <Route
        path="/approvals"
        element={
          <Guard>
            <MyApprovals />
          </Guard>
        }
      />
      <Route
        path="/setup/approval-processes"
        element={
          <Guard requireAdmin>
            <ApprovalProcessList />
          </Guard>
        }
      />
      <Route
        path="/setup/approval-processes/new"
        element={
          <Guard requireAdmin>
            <ApprovalProcessEditor />
          </Guard>
        }
      />
      <Route
        path="/setup/approval-processes/:id"
        element={
          <Guard requireAdmin>
            <ApprovalProcessEditor />
          </Guard>
        }
      />

      <Route
        path="/setup/duplicate-rules"
        element={
          <Guard requireAdmin>
            <DuplicateRules />
          </Guard>
        }
      />

      <Route
        path="/profile"
        element={
          <Guard>
            <Profile />
          </Guard>
        }
      />


      <Route
        path="/admin/settings"
        element={
          <Guard requireAdmin>
            <AdminSettings />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/company-info"
        element={
          <Guard requireAdmin>
            <CompanyInfo />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/sales-targets"
        element={
          <Guard requireAdmin>
            <SalesTargets />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/invoice-quote"
        element={
          <Guard requireAdmin>
            <InvoiceQuote />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/email"
        element={
          <Guard requireAdmin>
            <EmailConfiguration />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/data-import"
        element={
          <Guard requireAdmin>
            <DataImport />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/data-export"
        element={
          <Guard requireAdmin>
            <DataExport />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/billing"
        element={
          <Guard requireAdmin>
            <Billing />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/integrations"
        element={
          <Guard requireAdmin>
            <Integrations />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/other"
        element={
          <Guard requireAdmin>
            <OtherSettings />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/tenders-config"
        element={
          <Guard requireAdmin>
            <TendersConfig />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/lead-approvals"
        element={
          <Guard requireAdmin>
            <LeadApprovalSettings />
          </Guard>
        }
      />
      <Route
        path="/admin/settings/storage-usage"
        element={
          <Guard requireAdmin>
            <StorageUsage />
          </Guard>
        }
      />

      <Route
        path="/admin/users"
        element={
          <Guard requireAdmin>
            <UserManagement />
          </Guard>
        }
      />
      <Route
        path="/admin/users/:id"
        element={
          <Guard requireAdmin>
            <UserDetail />
          </Guard>
        }
      />
      <Route
        path="/admin/users/:id/edit"
        element={
          <Guard requireAdmin>
            <UserForm />
          </Guard>
        }
      />
      <Route
        path="/admin/roles"
        element={
          <Guard requireAdmin>
            <RoleManagement />
          </Guard>
        }
      />

      <Route
        path="/admin/roles/new"
        element={
          <Guard requireAdmin>
            <RoleForm />
          </Guard>
        }
      />

      <Route
        path="/admin/roles/:roleId/edit"
        element={
          <Guard requireAdmin>
            <RoleForm />
          </Guard>
        }
      />

      {FEATURES.emailSenders && (
        <Route
          path="/admin/email-senders"
          element={
            <Guard requireAdmin>
              <EmailSenders />
            </Guard>
          }
        />
      )}

      <Route
        path="/admin/incidents"
        element={
          <Guard requireAdmin>
            <IncidentManagement />
          </Guard>
        }
      />

      <Route
        path="/workspaces"
        element={
          <Guard requireAdmin>
            <Layout
              title="Workspaces"
              description="Manage workspaces in this organisation"
            >
              <WorkspaceManager />
            </Layout>
          </Guard>
        }
      />
      <Route
        path="/workspaces/:id"
        element={
          <Guard requireAdmin>
            <Layout
              title="Workspace Details"
              description="Manage workspace members and settings"
            >
              <WorkspaceDetail />
            </Layout>
          </Guard>
        }
      />

      {/* Tenders */}
      <Route
        path="/tenders"
        element={
          <Guard>
            <Tenders />
          </Guard>
        }
      />

      {/* Salesdam Standard Dashboards */}
      <Route
        path="/sd/orders"
        element={
          <Guard>
            <OrdersDashboard />
          </Guard>
        }
      />
      <Route
        path="/sd/accounting"
        element={
          <Guard>
            <AccountingDashboard />
          </Guard>
        }
      />
      <Route
        path="/sd/deals"
        element={
          <Guard>
            <DealsDashboard />
          </Guard>
        }
      />
      <Route
        path="/sd/leads"
        element={
          <Guard>
            <LeadsDashboard />
          </Guard>
        }
      />
      <Route
        path="/sd/revenue"
        element={
          <Guard>
            <RevenueDashboard />
          </Guard>
        }
      />
      <Route
        path="/sd/sales"
        element={
          <Guard>
            <SalesDashboard />
          </Guard>
        }
      />
      <Route
        path="/sd/roi"
        element={
          <Guard>
            <ROIDashboard />
          </Guard>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
