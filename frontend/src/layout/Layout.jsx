import styles from './Layout.module.css';
import { Helmet } from 'react-helmet-async';
import Sidebar from './Sidebar/Sidebar';
import Topbar from './Topbar/Topbar';
import { useAppContext } from '../context/AppContext';

const APP_NAME = 'Salesdam';

const Layout = ({ title, description, children }) => {
  const { sidebarCollapsed } = useAppContext();

  const pageTitle = title ? `${title} | ${APP_NAME}` : APP_NAME;
  const pageDescription =
    description || 'Salesforce Mini - Modern CRM for growing teams';

  return (
    <div
      className={`${styles.layout} ${sidebarCollapsed ? styles.collapsed : ''}`}
    >
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
      </Helmet>

      <Sidebar />
      <div className={styles.main}>
        <Topbar />
        <main className={styles.content}>
          <div className={styles.contentInner}>{children}</div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
