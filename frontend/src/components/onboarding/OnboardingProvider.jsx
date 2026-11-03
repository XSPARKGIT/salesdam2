import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';

const OnboardingContext = createContext(null);

/**
 * Owns the welcome modal and the guided tour.
 *
 * The welcome guide shows on every visit — each sign-in and each page load —
 * for every user, until they turn it off with "Don't show this again".
 * Closing it, finishing the tour or skipping it only hides it until the next
 * visit. The off switch lives on the user's own preferences
 * (PATCH /users/me/profile -> user.preferences.onboarding.welcomeTurnedOffAt),
 * so it follows the person to the next browser.
 */
export const OnboardingProvider = ({ children }) => {
  const { user, updateUser } = useAuth();
  const [tourOpen, setTourOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Opened from the profile menu: shown even when the guide is turned off, so
  // the user can turn it back on.
  const [reopened, setReopened] = useState(false);

  // Signing out (or in as someone else) ends the visit, so the next sign-in
  // shows the guide again.
  const userId = user?._id || user?.id || null;
  const [visitOf, setVisitOf] = useState(userId);
  if (visitOf !== userId) {
    setVisitOf(userId);
    setDismissed(false);
    setReopened(false);
    setTourOpen(false);
  }

  const turnedOff = Boolean(user?.preferences?.onboarding?.welcomeTurnedOffAt);
  const tourStatus = user?.preferences?.onboarding?.tourStatus;
  const completed = tourStatus === 'completed';
  const welcomeOpen =
    Boolean(user) && !tourOpen && (reopened || (!turnedOff && !dismissed && !completed));

  const save = useCallback(
    (patch) => {
      if (!user) return;
      const preferences = {
        ...(user.preferences || {}),
        onboarding: { ...(user.preferences?.onboarding || {}), ...patch },
      };
      updateUser({ preferences });
      api.patch('/users/me/profile', { preferences }).catch(() => {});
    },
    [user, updateUser],
  );

  // Closing the welcome modal either way records the "Don't show this again"
  // box, but only writes when the choice actually changed.
  const closeWelcome = useCallback(
    (patch, dontShowAgain) => {
      const now = new Date().toISOString();
      const toggle =
        dontShowAgain !== turnedOff ? { welcomeTurnedOffAt: dontShowAgain ? now : null } : {};
      save({ welcomeSeenAt: now, ...patch, ...toggle });
      setDismissed(true);
      setReopened(false);
    },
    [save, turnedOff],
  );

  const startTour = useCallback(
    (dontShowAgain = false) => {
      closeWelcome({ tourStatus: 'in_progress' }, dontShowAgain);
      setTourOpen(true);
    },
    [closeWelcome],
  );

  const exploreOnMyOwn = useCallback(
    (dontShowAgain = false) => closeWelcome({ tourStatus: 'skipped' }, dontShowAgain),
    [closeWelcome],
  );

  const finishTour = useCallback(
    (status) => {
      setTourOpen(false);
      save({ tourStatus: status === 'completed' ? 'completed' : 'dismissed', completedAt: new Date().toISOString() });
    },
    [save],
  );

  const openWelcome = useCallback(() => {
    setTourOpen(false);
    setReopened(true);
  }, []);

  const value = useMemo(
    () => ({
      welcomeOpen,
      turnedOff,
      tourOpen,
      tourStatus,
      startTour,
      exploreOnMyOwn,
      finishTour,
      openWelcome,
    }),
    [welcomeOpen, turnedOff, tourOpen, tourStatus, startTour, exploreOnMyOwn, finishTour, openWelcome],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = () => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
};

export default OnboardingContext;
