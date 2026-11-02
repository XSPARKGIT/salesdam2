import api from '../api';

export const getMessageTemplates = async (params = {}) =>
  (await api.get('/message-templates', { params })).data.data || [];
export const getMessageTemplate = async (id) => (await api.get(`/message-templates/${id}`)).data.data;
export const createMessageTemplate = async (payload) => (await api.post('/message-templates', payload)).data.data;
export const updateMessageTemplate = async (id, payload) => (await api.put(`/message-templates/${id}`, payload)).data.data;
export const deleteMessageTemplate = async (id) => (await api.delete(`/message-templates/${id}`)).data;
export const previewMessageTemplate = async (id, values) =>
  (await api.post(`/message-templates/${id}/preview`, { values })).data.data;
