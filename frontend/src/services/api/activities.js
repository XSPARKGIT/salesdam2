import api from '../api';

export const getTimeline = (objectApiName, recordId, params) =>
  api
    .get('/activities/timeline', {
      params: { objectApiName, recordId, ...params },
    })
    .then((res) => ({ items: res.data.data || [], total: res.data.meta?.total || 0 }));

export const createActivity = (data) =>
  api.post('/activities', data).then((res) => res.data.data);

export const updateActivity = (id, updates) =>
  api.put(`/activities/${id}`, updates).then((res) => res.data.data);

export const deleteActivity = (id) => api.delete(`/activities/${id}`);
