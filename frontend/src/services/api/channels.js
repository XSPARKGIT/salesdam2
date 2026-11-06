import api from '../api';

export const getCapabilities = async () => (await api.get('/channels/capabilities')).data.data || [];
export const getProviders = async () => (await api.get('/channels/providers')).data.data || [];

export const getChannelAccounts = async () => (await api.get('/channels')).data.data || [];
export const getChannelAccount = async (id) => (await api.get(`/channels/${id}`)).data.data;
export const createChannelAccount = async (payload) => (await api.post('/channels', payload)).data.data;
export const updateChannelAccount = async (id, payload) => (await api.put(`/channels/${id}`, payload)).data.data;
export const deleteChannelAccount = async (id) => (await api.delete(`/channels/${id}`)).data;
export const validateChannelAccount = async (id) => (await api.post(`/channels/${id}/validate`)).data.data;
export const testChannelWebhook = async (id, { kind = 'message', from = '+27820000000' } = {}) =>
  (await api.post(`/channels/${id}/test-webhook`, { kind, from })).data;
