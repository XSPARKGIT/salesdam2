import { useState } from 'react';
import { Database, LayoutDashboard, Zap, Users, Sparkles } from 'lucide-react';
import { useOnboarding } from './OnboardingProvider';
import styles from './Onboarding.module.css';

const BENEFITS = [
  {
    icon: <Database size={16} />,
    title: 'Model your data',
    body: 'Create objects and fields that fit your business, with no code.',
  },
  {
    icon: <LayoutDashboard size={16} />,
    title: 'See the numbers',
    body: 'Dashboards, analytics and sales targets in one place.',
  },
  {
    icon: <Zap size={16} />,
    title: 'Automate the busywork',
    body: 'Flows, approvals and tasks that keep work moving.',
  },
  {
    icon: <Users size={16} />,
    title: 'Work as a team',
    body: 'Workspaces, permissions and a shared customer inbox.',
  },
];

const WelcomeModal = () => {
  const { welcomeOpen } = useOnboarding();

  // Mounted fresh each time it opens, so the box always starts from the
  // user's saved choice.
  return welcomeOpen ? <Welcome /> : null;
};

/**
 * Shown on every visit until the user ticks "Don't show this again". Either
 * button closes it and records the box; reopening it from the profile menu
 * shows the box ticked, so unticking it turns the guide back on.
 */
const Welcome = () => {
  const { turnedOff, startTour, exploreOnMyOwn } = useOnboarding();
  const [dontShowAgain, setDontShowAgain] = useState(turnedOff);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-welcome-title"
    >
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.mark}>
            <Sparkles size={22} />
          </div>
          <h2 id="onboarding-welcome-title" className={styles.title}>
            Welcome to Salesdam
          </h2>
          <p className={styles.subtitle}>
            Your workspace is set up. Here&rsquo;s what you can do with it.
          </p>
        </div>

        <ul className={styles.benefits}>
          {BENEFITS.map(({ icon, title, body }) => (
            <li key={title} className={styles.benefit}>
              <span className={styles.benefitIcon}>{icon}</span>
              <span className={styles.benefitText}>
                <strong>{title}</strong>
                <span>{body}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => exploreOnMyOwn(dontShowAgain)}
          >
            Explore on my own
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => startTour(dontShowAgain)}
          >
            Let&rsquo;s get started
          </button>
        </div>

        <div className={styles.footer}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span>Don&rsquo;t show this again</span>
          </label>
          <p className={styles.footnote}>
            Guided tour &middot; about a minute
          </p>
        </div>
      </div>
    </div>
  );
};

export default WelcomeModal;
