import api from '../api';

export const getReports = async () => {
  const res = await api.get('/reports');
  return res.data.data || [];
};

export const getReportById = async (id) => {
  const res = await api.get(`/reports/${id}`);
  return res.data.data;
};

export const createReport = async (payload) => {
  const res = await api.post('/reports', payload);
  return res.data.data;
};

export const updateReport = async (id, payload) => {
  const res = await api.put(`/reports/${id}`, payload);
  return res.data.data;
};

export const deleteReport = async (id) => {
  const res = await api.delete(`/reports/${id}`);
  return res.data;
};

export const runReport = async (config) => {
  const res = await api.post('/reports/run', config);
  return res.data.data;
};
