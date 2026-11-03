import api from '../api';

export const getMyStatus = () => api.get('/telephony/status/me');
export const setMyStatus = (status) => api.put('/telephony/status/me', { status });
export const listStatuses = () => api.get('/telephony/status');
export const getDispositions = () => api.get('/telephony/dispositions');
export const getProviders = () => api.get('/telephony/providers');
export const dial = (payload) => api.post('/telephony/calls', payload);
export const callHistory = (params) => api.get('/telephony/calls', { params });
export const wrapUp = (activityId, data) => api.post(`/telephony/calls/${activityId}/wrap-up`, data);

export default {
  getMyStatus,
  setMyStatus,
  listStatuses,
  getDispositions,
  getProviders,
  dial,
  callHistory,
  wrapUp,
};