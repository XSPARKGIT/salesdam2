import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Database,
  Clock,
  Monitor,
  MousePointerClick,
  ArrowRight,
  Check,
} from 'lucide-react';
import styles from './FlowTypeSelector.module.css';

const FLOW_TYPES = [
  {
    value: 'record_triggered',
    label: 'Record-Triggered Flow',
    icon: Database,
    color: '#6366f1',
    bg: '#eef2ff',
    border: '#c7d2fe',
    description:
      'Automatically fires when a record is created, updated, or deleted.',
    features: [
      'Trigger on Create / Update / Delete',
      'Access trigger record & related fields',
      'Decision, Loop, Assignment, Formula',
      'Get / Create / Update / Delete records',
      'Send emails, notifications & HTTP calls',
    ],
  },
  {
    value: 'scheduled',
    label: 'Scheduled-Triggered Flow',
    icon: Clock,
    color: '#0891b2',
    bg: '#ecfeff',
    border: '#a5f3fc',
    description:
      'Runs on a date — e.g. 3 days before a Due Date — or on a repeating schedule.',
    features: [
      'Relative to a date field (before / after / on)',
      'Or a repeating cron schedule',
      'Batch process multiple records',
      'Decision, Loop, Assignment, Formula',
      'Send emails, notifications & HTTP calls',
      'Subflows & external service calls',
    ],
  },
  {
    value: 'autolaunched',
    label: 'Button-Launched Flow',
    icon: MousePointerClick,
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: '#ddd6fe',
    description:
      'Manually invoked — runs when a user clicks a button on a record.',
    features: [
      'Add it as an action button on an object',
      'Optional entry condition per record',
      'Get / Create / Update records',
      'Send emails, notifications & HTTP calls',
      'No screens — runs straight through',
    ],
  },
  {
    value: 'screen_flow',
    label: 'Screen Flow',
    icon: Monitor,
    color: '#db2777',
    bg: '#fdf2f8',
    border: '#fbcfe8',
    description:
      'Interactive UI flow with screens, forms, and dynamic data — embeddable in records.',
    features: [
      'Build interactive screens & forms',
      'Collect user input, display data',
      'Embed as a tab on any record',
      'Get Records and transform data',
      'Pause and resume on user action',
    ],
  },
];

export default function FlowTypeSelector({ onSelect }) {
  const [selected, setSelected] = useState(null);

  return (
    <div className={styles.page}>
      <Link to="/automation" className={styles.backLink}>
        <ArrowLeft size={15} /> Back to Automations
      </Link>

      <div className={styles.hero}>
        <h1 className={styles.title}>New Flow</h1>
        <p className={styles.subtitle}>
          Choose the flow type. This determines what triggers it and which
          elements are available.
          <strong> The type cannot be changed after creation.</strong>
        </p>
      </div>

      <div className={styles.cards}>
        {FLOW_TYPES.map((t) => {
          const Icon = t.icon;
          const isSelected = selected === t.value;
          return (
            <button
              key={t.value}
              className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
              style={
                isSelected
                  ? {
                      borderColor: t.color,
                      boxShadow: `0 0 0 3px ${t.color}22`,
                    }
                  : {}
              }
              onClick={() => setSelected(t.value)}
            >
              {isSelected && (
                <span
                  className={styles.checkMark}
                  style={{ background: t.color }}
                >
                  <Check size={12} />
                </span>
              )}

              <div
                className={styles.cardIcon}
                style={{
                  background: t.bg,
                  color: t.color,
                  border: `1.5px solid ${t.border}`,
                }}
              >
                <Icon size={30} />
              </div>

              <div className={styles.cardBody}>
                <div
                  className={styles.cardTitle}
                  style={{ color: isSelected ? t.color : undefined }}
                >
                  {t.label}
                </div>
                <div className={styles.cardDesc}>{t.description}</div>
                <ul className={styles.featureList}>
                  {t.features.map((f) => (
                    <li key={f} className={styles.featureItem}>
                      <span
                        className={styles.featureDot}
                        style={{ background: t.color }}
                      />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <button
          className={styles.createBtn}
          disabled={!selected}
          onClick={() => selected && onSelect(selected)}
        >
          Create Flow <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
