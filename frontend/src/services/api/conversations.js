import api from '../api';

export const getConversations = async (params = {}) => {
  const res = await api.get('/conversations', { params });
  return { items: res.data.data || [], meta: res.data.meta || {} };
};
export const getConversation = async (id) => (await api.get(`/conversations/${id}`)).data.data;
export const getMessages = async (id, params = {}) => {
  const res = await api.get(`/conversations/${id}/messages`, { params });
  return { items: res.data.data || [], meta: res.data.meta || {} };
};
export const assignConversation = async (id, userId) =>
  (await api.post(`/conversations/${id}/assign`, { userId })).data.data;
export const setConversationStatus = async (id, status) =>
  (await api.post(`/conversations/${id}/status`, { status })).data.data;
export const linkConversationRecord = async (id, objectApiName, recordId) =>
  (await api.post(`/conversations/${id}/link`, { objectApiName, recordId })).data.data;
export const replyToConversation = async (id, body, attachments = []) =>
  (await api.post(`/conversations/${id}/reply`, { body, attachments })).data.data;
export const replyWithTemplate = async (id, templateId, values = {}) =>
  (await api.post(`/conversations/${id}/reply-template`, { templateId, values })).data.data;
export const addConversationNote = async (id, body) =>
  (await api.post(`/conversations/${id}/notes`, { body })).data.data;
export const createRecordFromConversation = async (id, objectApiName, data) =>
  (await api.post(`/conversations/${id}/create-record`, { objectApiName, data })).data.data;
