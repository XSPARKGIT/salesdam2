import React, { useState } from 'react';
import { Building2, Users, ScrollText, AlertTriangle, Sparkles } from 'lucide-react';
import Modal from '../Modal.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import './AdminWelcomeModal.css';

const POINTS = [
  {
    icon: <Building2 size={16} />,
    title: 'Every tenant in one place',
    body: 'Create an organisation, set its plan and limits, or suspend and activate it.',
  },
  {
    icon: <Users size={16} />,
    title: 'Users across tenants',
    body: 'See who belongs to which organisation and switch a user on or off.',
  },
  {
    icon: <ScrollText size={16} />,
    title: 'The audit trail',
    body: 'Every change is recorded — who made it, to what, and when.',
  },
  {
    icon: <AlertTriangle size={16} />,
    title: 'Incidents',
    body: 'Track reported problems and the conversation around them.',
  },
];

/**
 * Welcome guide for the platform console.
 *
 * It is shown on every visit until the operator turns it off with "Don't show
 * this again" — closing the modal without ticking the box only dismisses it
 * for this session. The choice is stored on the user's preferences, so it
 * follows the person to the next browser.
 */
const AdminWelcomeModal = ({ onDismiss }) => {
  const { saveOnboarding } = useAuth();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const dismiss = async () => {
    if (dontShowAgain) {
      await saveOnboarding({ adminWelcomeSeenAt: new Date().toISOString() });
    }
    onDismiss();
  };

  return (
    <Modal title="Welcome to the Salesdam platform console" onClose={dismiss} width={560}>
      <div className="awm-intro">
        <span className="awm-mark"><Sparkles size={20} /></span>
        <p className="awm-lead">
          You are signed in as a platform operator. From here you can look after
          every organisation using Salesdam.
        </p>
      </div>

      <ul className="awm-points">
        {POINTS.map(({ icon, title, body }) => (
          <li key={title} className="awm-point">
            <span className="awm-pointIcon">{icon}</span>
            <span className="awm-pointText">
              <strong>{title}</strong>
              <span>{body}</span>
            </span>
          </li>
        ))}
      </ul>

      <label className="awm-toggle">
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
        />
        <span>Don&rsquo;t show this again</span>
      </label>

      <div className="awm-actions">
        <button type="button" className="awm-btn awm-btnPrimary" onClick={dismiss}>
          Got it
        </button>
      </div>
    </Modal>
  );
};

export default AdminWelcomeModal;
