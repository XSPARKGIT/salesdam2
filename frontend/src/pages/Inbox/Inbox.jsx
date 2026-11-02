import React, { useEffect, useState, useCallback } from 'react';
import Layout from '../../layout/Layout';
import Button from '../../components/common/Button/Button';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import {
  getConversations, getConversation, getMessages, assignConversation, setConversationStatus,
  replyToConversation, replyWithTemplate, addConversationNote, createRecordFromConversation,
} from '../../services/api/conversations';
import { getMessageTemplates } from '../../services/api/messageTemplates';

const STATUS_FILTERS = ['', 'open', 'pending', 'closed'];
const ASSIGNED_FILTERS = [
  { value: '', label: 'All' },
  { value: 'assignedToMe', label: 'Assigned to me' },
  { value: 'unassigned', label: 'Unassigned' },
];

export default function InboxPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateValues, setTemplateValues] = useState('{}');
  const [createRecordObject, setCreateRecordObject] = useState('lead');
  const [createRecordData, setCreateRecordData] = useState('{}');

  const loadConversations = useCallback(async () => {
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (assignedFilter === 'assignedToMe') params.assignedToMe = 'true';
      if (assignedFilter === 'unassigned') params.assigned = 'unassigned';
      const { items } = await getConversations(params);
      setConversations(items);
    } catch (e) {
      toast.error(e.message || 'Failed to load conversations');
    }
  }, [statusFilter, assignedFilter]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openConversation = async (id) => {
    setSelectedId(id);
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

  const transferConversation = async () => {
    const userId = window.prompt('User ID to transfer to:');
    if (!userId) return;
    try {
      await assignConversation(selectedId, userId);
      toast.success('Conversation transferred');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Transfer failed');
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
    if (!replyBody) return toast.error('A reply body is required');
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
    let values = {};
    try { values = JSON.parse(templateValues); } catch { return toast.error('Template values must be valid JSON'); }
    try {
      await replyWithTemplate(selectedId, selectedTemplateId, values);
      toast.success('Template sent');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Template send failed');
    }
  };

  const sendNote = async () => {
    if (!noteBody) return toast.error('A note body is required');
    try {
      await addConversationNote(selectedId, noteBody);
      toast.success('Note added');
      setNoteBody('');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Note failed');
    }
  };

  const createRecord = async () => {
    let data = {};
    try { data = JSON.parse(createRecordData); } catch { return toast.error('Record data must be valid JSON'); }
    try {
      await createRecordFromConversation(selectedId, createRecordObject, data);
      toast.success('Record created and linked');
      refreshSelected();
    } catch (e) {
      toast.error(e.message || 'Create failed');
    }
  };

  const channelTemplates = templates.filter((t) => t.channel === selected?.channel && t.isActive);

  return (
    <Layout title="Inbox" description="Omnichannel conversations — WhatsApp, Messenger, Instagram, email">
      <div style={{ display: 'flex', height: 'calc(100vh - 120px)' }}>
        <div style={{ width: 320, borderRight: '1px solid #e5e7eb', overflowY: 'auto', padding: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {ASSIGNED_FILTERS.map((f) => (
              <button key={f.value} onClick={() => setAssignedFilter(f.value)}
                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', background: assignedFilter === f.value ? '#111827' : '#fff', color: assignedFilter === f.value ? '#fff' : '#111' }}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', background: statusFilter === s ? '#111827' : '#fff', color: statusFilter === s ? '#fff' : '#111' }}>
                {s || 'All statuses'}
              </button>
            ))}
          </div>
          {conversations.length === 0 && <p style={{ fontSize: 13, color: '#888' }}>No conversations.</p>}
          {conversations.map((c) => (
            <div key={c._id} onClick={() => openConversation(c._id)}
              style={{ padding: 10, marginBottom: 6, borderRadius: 6, cursor: 'pointer', background: selectedId === c._id ? '#eef2ff' : '#f9fafb', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.contactName || c.contactIdentifier || 'Unknown'}</div>
              <div style={{ fontSize: 11, color: '#666' }}>{c.channel} · {c.status} · {c.assignedTo ? `${c.assignedTo.firstName || ''} ${c.assignedTo.lastName || ''}`.trim() : 'unassigned'}</div>
              {c.isUnread && <span style={{ fontSize: 10, color: '#dc2626' }}>● unread</span>}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
          {!selectedId && <p style={{ color: '#888' }}>Select a conversation to view its history.</p>}
          {selectedId && selected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <strong>{selected.contactName || selected.contactIdentifier}</strong>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>{selected.channel} · {selected.status}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button size="sm" variant="secondary" onClick={acceptConversation}>Accept</Button>
                  <Button size="sm" variant="secondary" onClick={transferConversation}>Transfer</Button>
                  {selected.status !== 'closed' ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => changeStatus('pending')}>Pending</Button>
                      <Button size="sm" variant="secondary" onClick={() => changeStatus('closed')}>Close</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => changeStatus('open')}>Reopen</Button>
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, maxHeight: 360, overflowY: 'auto', marginBottom: 12 }}>
                {messages.map((m) => (
                  <div key={m._id} style={{
                    marginBottom: 8, textAlign: m.direction === 'outbound' ? 'right' : 'left',
                  }}>
                    <div style={{
                      display: 'inline-block', maxWidth: '70%', padding: '6px 10px', borderRadius: 8,
                      background: m.isInternalNote ? '#fef9c3' : m.direction === 'outbound' ? '#dbeafe' : '#f3f4f6',
                      fontSize: 13,
                    }}>
                      {m.isInternalNote && <div style={{ fontSize: 10, color: '#92400e', fontWeight: 600 }}>INTERNAL NOTE — not sent to customer</div>}
                      <div>{m.body}</div>
                      <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                        {m.senderName || ''} · {new Date(m.occurredAt || m.createdAt).toLocaleString()} · {m.status}
                        {m.providerNote ? ` (${m.providerNote})` : ''}
                      </div>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <p style={{ fontSize: 13, color: '#888' }}>No messages yet.</p>}
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input style={{ flex: 1 }} placeholder="Type a reply..." value={replyBody} onChange={(e) => setReplyBody(e.target.value)} />
                <Button onClick={sendReply}>Send</Button>
              </div>

              {channelTemplates.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                    <option value="">Select a template...</option>
                    {channelTemplates.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.name}{selected.channel === 'whatsapp' ? ` (${t.providerStatus || 'unapproved'})` : ''}
                      </option>
                    ))}
                  </select>
                  <input placeholder='Extra merge values JSON, e.g. {"claim_number":"C-1"}' value={templateValues} onChange={(e) => setTemplateValues(e.target.value)} style={{ flex: 1, fontFamily: 'monospace' }} />
                  <Button variant="secondary" onClick={sendTemplate}>Send Template</Button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input style={{ flex: 1 }} placeholder="Internal note (never sent to customer)..." value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                <Button variant="secondary" onClick={sendNote}>Add Note</Button>
              </div>

              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
                {selected.linkedRecord ? (
                  <p style={{ fontSize: 13 }}>
                    Linked record: <strong>{selected.linkedRecord.objectApiName}</strong> / {selected.linkedRecord.recordId}
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 13 }}>No linked record.</span>
                    <input style={{ width: 100 }} value={createRecordObject} onChange={(e) => setCreateRecordObject(e.target.value)} />
                    <input placeholder='{"name":"..."}' value={createRecordData} onChange={(e) => setCreateRecordData(e.target.value)} style={{ flex: 1, fontFamily: 'monospace' }} />
                    <Button size="sm" variant="secondary" onClick={createRecord}>Create Record</Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
