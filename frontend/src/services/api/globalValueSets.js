import api from '../api';

export const listGlobalValueSets = () =>
  api.get('/global-value-sets').then((r) => r.data.data);

export const getGlobalValueSet = (id) =>
  api.get(`/global-value-sets/${id}`).then((r) => r.data.data);

export const createGlobalValueSet = (payload) =>
  api.post('/global-value-sets', payload).then((r) => r.data.data);

export const updateGlobalValueSet = (id, payload) =>
  api.put(`/global-value-sets/${id}`, payload).then((r) => r.data.data);

export const deleteGlobalValueSet = (id, force = false) =>
  api.delete(`/global-value-sets/${id}${force ? '?force=true' : ''}`).then((r) => r.data);
