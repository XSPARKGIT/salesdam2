import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import {
  StickyNote,
  Phone,
  Users,
  Mail,
  SquareCheck,
  MessageCircle,
  Bell,
  Activity as ActivityIcon,
  Circle,
  CircleCheck,
  Trash2,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import Button from '../../common/Button/Button';
import {
  getTimeline,
  createActivity,
  updateActivity,
  deleteActivity,
} from '../../../services/api/activities';
import { getUsers } from '../../../services/api/users';
import styles from './ActivityTimeline.module.css';

const PAGE_SIZE = 25;

const TYPE_META = {
  note: { label: 'Note', icon: StickyNote },
  call: { label: 'Call', icon: Phone },
  meeting: { label: 'Meeting', icon: Users },
  email: { label: 'Email', icon: Mail },
  task: { label: 'Task', icon: SquareCheck },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  facebook: { label: 'Facebook', icon: MessageCircle },
  instagram: { label: 'Instagram', icon: MessageCircle },
  sms: { label: 'SMS', icon: MessageCircle },
  system_notification: { label: 'System', icon: Bell },
  other: { label: 'Activity', icon: ActivityIcon },
};

// Types a user can log by hand; channel types arrive through integrations.
const LOGGABLE_TYPES = ['note', 'call', 'meeting', 'email', 'task'];

const personName = (p) =>
  p && typeof p === 'object' ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '';

/**
 * Chronological activity timeline for one record (Core BRD §24), with a
 * composer for logging notes, calls, meetings, emails and tasks.
 */
const ActivityTimeline = ({ objectApiName, recordId }) => {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [type, setType] = useState('note');
  const [filterType, setFilterType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [users, setUsers] = useState([]);
  const [filterUserId, setFilterUserId] = useState('');

  useEffect(() => {
    getUsers({}).then((u) => setUsers(Array.isArray(u) ? u : [])).catch(() => {});
  }, []);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');

  const queryKey = ['activity-timeline', objectApiName, recordId, limit, filterType, fromDate, toDate, filterUserId];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => getTimeline(objectApiName, recordId, { limit, types: filterType || undefined, from: fromDate || undefined, to: toDate || undefined, userId: filterUserId || undefined }),
    enabled: !!objectApiName && !!recordId,
  });
  const items = data?.items || [];
  const total = data?.total || 0;

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['activity-timeline', objectApiName, recordId],
    });

  const create = useMutation({
    mutationFn: createActivity,
    onSuccess: () => {
      setSubject('');
      setBody('');
      setDueAt('');
      toast.success(`${TYPE_META[type].label} logged.`);
      refresh();
    },
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Failed to log activity.'),
  });

  const toggleTask = useMutation({
    mutationFn: ({ id, status }) => updateActivity(id, { status }),
    onSuccess: refresh,
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Failed to update task.'),
  });

  const remove = useMutation({
    mutationFn: deleteActivity,
    onSuccess: () => {
      toast.success('Activity deleted.');
      refresh();
    },
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Failed to delete activity.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!subject.trim() && !body.trim()) {
      toast.error('Add a subject or some details.');
      return;
    }
    create.mutate({
      type,
      objectApiName,
      recordId,
      subject: subject.trim(),
      body: body.trim(),
      ...(type === 'task' && dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
    });
  };

  const handleDelete = (activity) => {
    const label = TYPE_META[activity.type]?.label.toLowerCase() || 'activity';
    if (window.confirm(`Delete this ${label}? This can't be undone.`)) {
      remove.mutate(activity._id);
    }
  };

  return (
    <div className={styles.wrapper}>
      <form className={styles.composer} onSubmit={handleSubmit}>
        <div className={styles.typePicker} role="radiogroup" aria-label="Activity type">
          {LOGGABLE_TYPES.map((t) => {
            const Icon = TYPE_META[t].icon;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                className={`${styles.typeOption} ${type === t ? styles.typeOptionActive : ''}`}
                onClick={() => setType(t)}
              >
                <Icon size={14} />
                {TYPE_META[t].label}
              </button>
            );
          })}
        </div>
        <input
          className={styles.input}
          placeholder={type === 'task' ? 'What needs doing?' : 'Subject'}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
        />
        <textarea
          className={styles.textarea}
          placeholder="Details (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />
        <div className={styles.composerFooter}>
          {type === 'task' ? (
            <label className={styles.dueLabel}>
              Due
              <input
                type="datetime-local"
                className={styles.input}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </label>
          ) : (
            <span />
          )}
          <Button type="submit" size="sm" loading={create.isPending}>
            Log {TYPE_META[type].label.toLowerCase()}
          </Button>
        </div>
      </form>

      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>Filter by type:</label>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ fontSize: 12, padding: '2px 6px' }}>
          <option value="">All</option>
          {Object.keys(TYPE_META).map((t) => (
            <option key={t} value={t}>{TYPE_META[t].label}</option>
          ))}
        </select>
        <label style={{ fontSize: 12 }}>User:</label>
        <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} style={{ fontSize: 12, padding: '2px 6px' }}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u._id || u.id} value={u._id || u.id}>
              {u.firstName || u.name || u.email || u._id}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 12 }}>From:</label>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ fontSize: 12, padding: '2px 6px' }} />
        <label style={{ fontSize: 12 }}>To:</label>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ fontSize: 12, padding: '2px 6px' }} />
      </div>

      {isLoading ? (
        <p className={styles.empty}>Loading activity…</p>
      ) : isError ? (
        <p className={styles.empty}>Couldn't load activity for this record.</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>
          No activity yet. Log a note, call or meeting above to start the timeline.
        </p>
      ) : (
        <ol className={styles.timeline}>
          {items.map((a) => {
            const meta = TYPE_META[a.type] || TYPE_META.other;
            const Icon = meta.icon;
            const isTask = a.type === 'task';
            const done = a.status === 'completed';
            const who = personName(a.createdBy);
            const when = new Date(a.occurredAt || a.createdAt);
            return (
              <li key={a._id} className={styles.entry}>
                <span className={`${styles.dot} ${styles[`dot_${a.type}`] || ''}`}>
                  <Icon size={14} />
                </span>
                <div className={styles.card}>
                  <div className={styles.cardHeader}>
                    {isTask && (
                      <button
                        type="button"
                        className={styles.taskToggle}
                        onClick={() =>
                          toggleTask.mutate({ id: a._id, status: done ? 'open' : 'completed' })
                        }
                        aria-label={done ? 'Reopen task' : 'Mark task complete'}
                        title={done ? 'Reopen task' : 'Mark complete'}
                      >
                        {done ? <CircleCheck size={16} /> : <Circle size={16} />}
                      </button>
                    )}
                    <span className={`${styles.subject} ${isTask && done ? styles.done : ''}`}>
                      {a.subject || meta.label}
                    </span>
                    {a.direction === 'inbound' && (
                      <ArrowDownLeft size={12} className={styles.direction} aria-label="Inbound" />
                    )}
                    {a.direction === 'outbound' && (
                      <ArrowUpRight size={12} className={styles.direction} aria-label="Outbound" />
                    )}
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(a)}
                      aria-label="Delete activity"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {a.body && <p className={styles.body}>{a.body}</p>}
                  <div className={styles.meta}>
                    <span className={styles.typeTag}>{meta.label}</span>
                    {who && <span>{who}</span>}
                    <time dateTime={when.toISOString()} title={format(when, 'PPpp')}>
                      {formatDistanceToNow(when, { addSuffix: true })}
                    </time>
                    {isTask && a.dueAt && !done && (
                      <span
                        className={new Date(a.dueAt) < new Date() ? styles.overdue : undefined}
                      >
                        Due {format(new Date(a.dueAt), 'd MMM, HH:mm')}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {items.length < total && (
        <div className={styles.more}>
          <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Show older activity
          </Button>
        </div>
      )}
    </div>
  );
};

export default ActivityTimeline;
