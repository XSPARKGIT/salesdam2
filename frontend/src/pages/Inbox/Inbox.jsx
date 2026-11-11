import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  MessageSquare, Mail, Phone, Globe, Radio,
  UserCheck, UserX, ArrowRightLeft, Clock, CheckCircle, RotateCcw,
  Send, FileText, StickyNote, Link2, Plus, Inbox,
  ChevronRight, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../layout/Layout';
import { useAuth } from '../../hooks/useAuth';
import {
  getConversations, getConversation, getMessages, assignConversation, setConversationStatus,
  replyToConversation, replyWithTemplate, addConversationNote, createRecordFromConversation,
  transferConversationToTenant,
} from '../../services/api/conversations';
import { getMessageTemplates } from '../../services/api/messageTemplates';
import styles from './Inbox.module.css';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'closed', label: 'Closed' },
];
const ASSIGNED_FILTERS = [
  { value: '', label: 'All' },
  { value: 'assignedToMe', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
];
const CHANNEL_META = {
  whatsapp:  { label: 'WhatsApp',  icon: MessageSquare, bg: '#dcfce7', color: '#16a34a' },
  facebook:  { label: 'Facebook',  icon: MessageSquare, bg: '#dbeafe', color: '#1d4ed8' },
  instagram: { label: 'Instagram', icon: MessageSquare, bg: '#fce7f3', color: '#be185d' },
  email:     { label: 'Email',     icon: Mail,          bg: '#ede9fe', color: '#7c3aed' },
  sms:       { label: 'SMS',       icon: MessageSquare, bg: '#ccfbf1', color: '#0d9488' },
  telephony: { label: 'Telephony', icon: Phone,         bg: '#f1f5f9', color: '#475569' },
  webchat:   { label: 'Web Chat',  icon: Globe,         bg: '#fef3c7', color: '#b45309' },
  other:     { label: 'Other',     icon: Radio,         bg: '#f1f5f9', color: '#6b7280' },
};
const RECORD_OBJECT_TYPES = ['lead', 'contact', 'deal', 'case', 'task', 'account'];

function getChannelMeta(channel) {
  return CHANNEL_META[channel] || CHANNEL_META.other;
}
function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
function extractTemplateVars(body) {
  const matches = [...(body || '').matchAll(/\{\{(\w+)\}\}/g)];
  return [...new Set(matches.map((m) => m[1]))];
}
function applyMergeVars(body, vars) {
  let result = body || '';
  Object.entries(vars).forEach(([k, v]) => {
    result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v || `{{${k}}}`);
  });
  return result;
}
function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.toDateString() === db.toDateString();
}
function formatDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function InboxPage() {
  const { user } = useAuth();
  const threadRef = useRef(null);

  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');

  // Composer state
  const [composerTab, setComposerTab] = useState('reply'); // reply | template | note
  const [replyBody, setReplyBody] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [mergeVars, setMergeVars] = useState({});

  // Transfer (agent) inline state
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferUserId, setTransferUserId] = useState('');

  // Cross-tenant transfer state
  const [showTenantTransfer, setShowTenantTransfer] = useState(false);
  const [tenantTransferTargetId, setTenantTransferTargetId] = useState('');
  const [tenantTransferClose, setTenantTransferClose] = useState(true);
  const [tenantTransferring, setTenantTransferring] = useState(false);

  // Create record state
  const [showCreateRecord, setShowCreateRecord] = useState(false);
  const [createRecordObject, setCreateRecordObject] = useState('lead');
  const [createRecordName, setCreateRecordName] = useState('');

  const loadConversations = useCallback(async () => {
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (assignedFilter === 'assignedToMe') params.assignedToMe = 'true';
      if (assignedFilter === 'unassigned') params.assigned = 'unassigned';
      const { items } = await getConversations(params);
      setConversations(items);
      // Clear detail panel if the selected conversation is no longer in the filtered list
      setSelectedId((prev) => (prev && items.some((c) => c._id === prev) ? prev : null));
      setSelected((prev) => (prev && items.some((c) => c._id === prev._id) ? prev : null));
    } catch (e) {
      toast.error(e.message || 'Failed to load conversations');
    }
  }, [statusFilter, assignedFilter]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const openConversation = async (id) => {
    setSelectedId(id);
    setShowTransfer(false);
    setTransferUserId('');
    setShowTenantTransfer(false);
    setTenantTransferTargetId('');
    setShowCreateRecord(false);
    setReplyBody('');
    setNoteBody('');
    setSelectedTemplateId('');
    setMergeVars({});
    try {
      const [conv, msgResult, tpls] = await Promise.all([
        getConversation(id),
        getMessages(id),
        getMessageTemplates(),
      ]);
      setSelected(conv);
      setMessages(msgResult.items);
      setTemplates(tpls);
    } catch (e) {
      toast.error(e.message || 'Failed to open conversation');
    }
  };

  const refreshSelected = async () => {
    if (!selectedId) return;
    const [conv, msgResult] = await Promise.all([getConversation(selectedId), getMessages(selectedId)]);
    setSelected(conv);
    setMessages(msgResult.items);
    loadConversations();
  };

  const acceptConversation = async () => {
    try {
      await assignConversation(selectedId, user?._id);
      toast.success('Conversation assigned to you');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Assign failed');
    }
  };

  const doTransfer = async () => {
    if (!transferUserId.trim()) return toast.error('Enter a User ID');
    try {
      await assignConversation(selectedId, transferUserId.trim());
      toast.success('Conversation transferred');
      setShowTransfer(false);
      setTransferUserId('');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Transfer failed');
    }
  };

  const doTenantTransfer = async () => {
    if (!tenantTransferTargetId.trim()) return toast.error('Enter a target Tenant ID');
    setTenantTransferring(true);
    try {
      const result = await transferConversationToTenant(selectedId, tenantTransferTargetId.trim(), tenantTransferClose);
      toast.success(`Transferred — ${result.messagesCopied} message(s) copied to target tenant`);
      setShowTenantTransfer(false);
      setTenantTransferTargetId('');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Tenant transfer failed');
    } finally {
      setTenantTransferring(false);
    }
  };

  const changeStatus = async (status) => {
    try {
      await setConversationStatus(selectedId, status);
      toast.success(`Marked ${status}`);
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Status change failed');
    }
  };

  const sendReply = async () => {
    if (!replyBody.trim()) return toast.error('Reply body is required');
    try {
      await replyToConversation(selectedId, replyBody);
      toast.success('Reply sent');
      setReplyBody('');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Reply failed');
    }
  };

  const sendTemplate = async () => {
    if (!selectedTemplateId) return toast.error('Select a template first');
    try {
      await replyWithTemplate(selectedId, selectedTemplateId, mergeVars);
      toast.success('Template sent');
      setSelectedTemplateId('');
      setMergeVars({});
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Template send failed');
    }
  };

  const sendNote = async () => {
    if (!noteBody.trim()) return toast.error('Note body is required');
    try {
      await addConversationNote(selectedId, noteBody);
      toast.success('Note added');
      setNoteBody('');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Note failed');
    }
  };

  const doCreateRecord = async () => {
    const data = {};
    if (createRecordName) data.name = createRecordName;
    try {
      await createRecordFromConversation(selectedId, createRecordObject, data);
      toast.success('Record created and linked');
      setShowCreateRecord(false);
      setCreateRecordName('');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Create failed');
    }
  };

  const channelTemplates = templates.filter(
    (t) => t.channel === selected?.channel && t.isActive
      && (selected.channel !== 'whatsapp' || t.providerStatus === 'approved'),
  );

  const selectedTemplate = templates.find((t) => t._id === selectedTemplateId);
  const templateVarNames = extractTemplateVars(selectedTemplate?.body);
  const previewBody = selectedTemplate ? applyMergeVars(selectedTemplate.body, mergeVars) : '';

  const handleTemplateSelect = (id) => {
    setSelectedTemplateId(id);
    setMergeVars({});
  };

  return (
    <Layout title="Inbox" description="Omnichannel conversations">
      <div className={styles.inboxOuter}>

        {/* ── Sidebar ───────────────────────────── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarHead}>
            <p className={styles.sidebarTitle}>Inbox</p>
            <div className={styles.filterRow}>
              {ASSIGNED_FILTERS.map((f) => (
                <button key={f.value}
                  className={`${styles.filterBtn} ${assignedFilter === f.value ? styles.filterBtnActive : ''}`}
                  onClick={() => setAssignedFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className={styles.filterRow}>
              {STATUS_FILTERS.map((f) => (
                <button key={f.value}
                  className={`${styles.filterBtn} ${statusFilter === f.value ? styles.filterBtnActive : ''}`}
                  onClick={() => setStatusFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.convList}>
            {conversations.length === 0 && (
              <div className={styles.convEmpty}>No conversations found.</div>
            )}
            {conversations.map((c) => {
              const meta = getChannelMeta(c.channel);
              const name = c.contactName || c.contactIdentifier || 'Unknown';
              return (
                <div key={c._id}
                  className={`${styles.convItem} ${selectedId === c._id ? styles.convItemActive : ''}`}
                  onClick={() => openConversation(c._id)}>
                  <div className={styles.convAvatar} style={{ background: meta.bg, color: meta.color }}>
                    {getInitials(name)}
                  </div>
                  <div className={styles.convBody}>
                    <div className={styles.convNameRow}>
                      <span className={styles.convName}>{name}</span>
                      {c.isUnread && <span className={styles.convUnreadDot} />}
                    </div>
                    <div className={styles.convMeta}>
                      <span className={styles.channelDot} style={{ background: meta.color }} />
                      {meta.label}
                      <span className={`${styles.statusPill} ${styles['status' + (c.status?.charAt(0).toUpperCase() + c.status?.slice(1))]}`}>
                        {c.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Main ──────────────────────────────── */}
        <div className={styles.main}>
          {!selectedId ? (
            <div className={styles.emptyState}>
              <Inbox size={48} className={styles.emptyStateIcon} />
              <p className={styles.emptyStateTitle}>No conversation selected</p>
              <p>Choose a conversation from the list to get started.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              {selected && (() => {
                const meta = getChannelMeta(selected.channel);
                const Icon = meta.icon;
                const name = selected.contactName || selected.contactIdentifier || 'Unknown';
                return (
                  <div className={styles.convHeader}>
                    <div className={styles.convHeaderAvatar} style={{ background: meta.bg, color: meta.color }}>
                      {getInitials(name)}
                    </div>
                    <div className={styles.convHeaderInfo}>
                      <div className={styles.convHeaderName}>{name}</div>
                      <div className={styles.convHeaderMeta}>
                        <span className={styles.channelBadge} style={{ background: meta.bg, color: meta.color, borderColor: meta.color + '44' }}>
                          <Icon size={10} /> {meta.label}
                        </span>
                        <span className={`${styles.statusPill} ${styles['status' + (selected.status?.charAt(0).toUpperCase() + selected.status?.slice(1))]}`}>
                          {selected.status}
                        </span>
                        {selected.assignedTo && (
                          <span style={{ fontSize: 11, color: 'var(--color-gray-400)' }}>
                            {`${selected.assignedTo.firstName || ''} ${selected.assignedTo.lastName || ''}`.trim() || 'Assigned'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.convActions}>
                      {selected.assignedTo?._id === user?._id || selected.assignedTo?.id === user?._id || String(selected.assignedTo?._id) === String(user?._id) ? (
                        <span className={styles.assignedToMeBadge}>
                          <UserCheck size={12} /> Assigned to me
                        </span>
                      ) : (
                        <button className={styles.actionBtnPrimary} onClick={acceptConversation}>
                          <UserCheck size={13} /> Accept
                        </button>
                      )}
                      {!showTransfer ? (
                        <button className={styles.actionBtn} onClick={() => setShowTransfer(true)}>
                          <ArrowRightLeft size={13} /> Transfer
                        </button>
                      ) : (
                        <>
                          <input
                            className={styles.mergeVarInput}
                            style={{ width: 160 }}
                            placeholder="User ID..."
                            value={transferUserId}
                            onChange={(e) => setTransferUserId(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && doTransfer()}
                            autoFocus
                          />
                          <button className={styles.actionBtn} onClick={doTransfer}><ChevronRight size={13} /></button>
                          <button className={styles.actionBtn} onClick={() => setShowTransfer(false)}><X size={13} /></button>
                        </>
                      )}
                      {user?.role?.name?.toLowerCase() === 'superuser' && (
                        <>
                          <div className={styles.actionSep} />
                          {!showTenantTransfer ? (
                            <button className={styles.actionBtn} onClick={() => setShowTenantTransfer(true)}>
                              <ArrowRightLeft size={13} /> Transfer Tenant
                            </button>
                          ) : (
                            <>
                              <input
                                className={styles.mergeVarInput}
                                style={{ width: 180 }}
                                placeholder="Target Tenant ID..."
                                value={tenantTransferTargetId}
                                onChange={(e) => setTenantTransferTargetId(e.target.value)}
                                autoFocus
                              />
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-gray-500)', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={tenantTransferClose}
                                  onChange={(e) => setTenantTransferClose(e.target.checked)}
                                />
                                Close source
                              </label>
                              <button className={styles.actionBtn} disabled={tenantTransferring} onClick={doTenantTransfer}>
                                {tenantTransferring ? '…' : <ChevronRight size={13} />}
                              </button>
                              <button className={styles.actionBtn} onClick={() => setShowTenantTransfer(false)}><X size={13} /></button>
                            </>
                          )}
                        </>
                      )}
                      <div className={styles.actionSep} />
                      {selected.status !== 'closed' ? (
                        <>
                          <button className={styles.actionBtn} onClick={() => changeStatus('pending')}>
                            <Clock size={13} /> Pending
                          </button>
                          <button className={styles.actionBtnDanger} onClick={() => changeStatus('closed')}>
                            <CheckCircle size={13} /> Close
                          </button>
                        </>
                      ) : (
                        <button className={styles.actionBtn} onClick={() => changeStatus('open')}>
                          <RotateCcw size={13} /> Reopen
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Message thread */}
              <div className={styles.messageThread} ref={threadRef}>
                {messages.length === 0 && (
                  <div className={styles.threadEmpty}>No messages yet.</div>
                )}
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const showDate = !prev || !isSameDay(prev.occurredAt || prev.createdAt, m.occurredAt || m.createdAt);
                  if (m.isInternalNote) {
                    return (
                      <React.Fragment key={m._id}>
                        {showDate && (
                          <div className={styles.msgDateSep}>{formatDate(m.occurredAt || m.createdAt)}</div>
                        )}
                        <div className={styles.msgRow + ' ' + styles.msgRowNote}>
                          <div className={styles.bubbleNote}>
                            <div className={styles.noteLabel}><StickyNote size={10} /> Internal note</div>
                            <div>{m.body}</div>
                            <div className={styles.bubbleMeta}>{m.senderName || 'Agent'} · {formatTs(m.occurredAt || m.createdAt)}</div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  }
                  const isOut = m.direction === 'outbound';
                  return (
                    <React.Fragment key={m._id}>
                      {showDate && (
                        <div className={styles.msgDateSep}>{formatDate(m.occurredAt || m.createdAt)}</div>
                      )}
                      <div className={`${styles.msgRow} ${isOut ? styles.msgRowOut : styles.msgRowIn}`}>
                        <div className={isOut ? styles.bubbleOut : styles.bubbleIn}>
                          <div>{m.body}</div>
                          <div className={`${styles.bubbleMeta} ${isOut ? styles.bubbleMetaOut : ''}`}>
                            {m.senderName || (isOut ? 'Agent' : 'Contact')} · {formatTs(m.occurredAt || m.createdAt)}
                            {m.status && m.status !== 'sent' ? ` · ${m.status}` : ''}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Bottom area */}
              <div className={styles.bottomArea}>
                {/* Linked record bar */}
                <div className={styles.linkedRecordBar}>
                  {selected?.linkedRecord ? (
                    <>
                      <Link2 size={12} />
                      <span>Linked record:</span>
                      <span className={styles.linkedRecordBadge}>
                        {selected.linkedRecord.objectApiName} / {selected.linkedRecord.recordId}
                      </span>
                    </>
                  ) : (
                    <>
                      <Link2 size={12} />
                      <span>No linked record</span>
                      <div className={styles.createRecordBtns}>
                        {!showCreateRecord && (
                          <button className={styles.createRecordBtn} onClick={() => setShowCreateRecord(true)}>
                            <Plus size={11} /> Create Record
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Create record inline form */}
                {showCreateRecord && !selected?.linkedRecord && (
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', background: 'var(--color-gray-50)', display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <div className={styles.createModalField}>
                      <label className={styles.createModalLabel}>Object type</label>
                      <select className={styles.createModalInput} value={createRecordObject} onChange={(e) => setCreateRecordObject(e.target.value)}>
                        {RECORD_OBJECT_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className={styles.createModalField}>
                      <label className={styles.createModalLabel}>Name <span style={{ color: 'var(--color-gray-400)', fontWeight: 400 }}>(optional)</span></label>
                      <input className={styles.createModalInput} placeholder="Record name..." value={createRecordName} onChange={(e) => setCreateRecordName(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className={styles.createModalCancel} onClick={() => setShowCreateRecord(false)}>Cancel</button>
                      <button className={styles.createModalSubmit} onClick={doCreateRecord}>Create &amp; Link</button>
                    </div>
                  </div>
                )}

                {/* Composer */}
                <div className={styles.composer}>
                  <div className={styles.composerTabs}>
                    <button className={`${styles.composerTab} ${composerTab === 'reply' ? styles.composerTabActive : ''}`} onClick={() => setComposerTab('reply')}>
                      <Send size={12} /> Reply
                    </button>
                    <button className={`${styles.composerTab} ${composerTab === 'template' ? styles.composerTabActive : ''}`} onClick={() => setComposerTab('template')}>
                      <FileText size={12} /> Template
                    </button>
                    <button className={`${styles.composerTab} ${composerTab === 'note' ? styles.composerTabActive : ''}`} onClick={() => setComposerTab('note')}>
                      <StickyNote size={12} /> Note
                    </button>
                  </div>

                  {composerTab === 'reply' && (
                    <>
                      <textarea
                        className={styles.composerTextarea}
                        rows={3}
                        placeholder="Type your reply..."
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) sendReply(); }}
                      />
                      <div className={styles.composerRow}>
                        <span style={{ flex: 1, fontSize: 11, color: 'var(--color-gray-400)' }}>Ctrl+Enter to send</span>
                        <button className={styles.composerSend} onClick={sendReply}>
                          <Send size={13} /> Send Reply
                        </button>
                      </div>
                    </>
                  )}

                  {composerTab === 'template' && (
                    <>
                      <select className={styles.templateSelect} value={selectedTemplateId} onChange={(e) => handleTemplateSelect(e.target.value)}>
                        <option value="">Choose a template...</option>
                        {channelTemplates.length === 0 && (
                          <option disabled>No approved templates for this channel</option>
                        )}
                        {channelTemplates.map((t) => (
                          <option key={t._id} value={t._id}>{t.name}</option>
                        ))}
                      </select>
                      {templateVarNames.length > 0 && (
                        <div className={styles.mergeVarRow}>
                          {templateVarNames.map((v) => (
                            <div key={v} className={styles.mergeVarField}>
                              <span className={styles.mergeVarLabel}>{`{{${v}}}`}</span>
                              <input
                                className={styles.mergeVarInput}
                                placeholder={v}
                                value={mergeVars[v] || ''}
                                onChange={(e) => setMergeVars({ ...mergeVars, [v]: e.target.value })}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {selectedTemplate && (
                        <div className={styles.templatePreview}>
                          {previewBody.split(/(\{\{[^}]+\}\})/g).map((part, i) =>
                            /^\{\{[^}]+\}\}$/.test(part)
                              ? <span key={i} className={styles.templatePreviewMerge}>{part}</span>
                              : part
                          )}
                        </div>
                      )}
                      <div className={styles.composerRow}>
                        <span style={{ flex: 1 }} />
                        <button className={styles.composerSend} onClick={sendTemplate}>
                          <Send size={13} /> Send Template
                        </button>
                      </div>
                    </>
                  )}

                  {composerTab === 'note' && (
                    <>
                      <textarea
                        className={styles.composerTextareaNoteStyle}
                        rows={3}
                        placeholder="Internal note — never sent to the customer..."
                        value={noteBody}
                        onChange={(e) => setNoteBody(e.target.value)}
                      />
                      <div className={styles.composerRow}>
                        <span style={{ flex: 1, fontSize: 11, color: 'var(--color-gray-400)' }}>Visible to agents only</span>
                        <button className={styles.composerSendNote} onClick={sendNote}>
                          <StickyNote size={13} /> Add Note
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
