import api from '../api';

export const getRecords = async (objectApiName, params) => {
  try {
    const res = await api.get(`/records/${objectApiName}`, { params });
    return res.data.data || [];
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to fetch records.');
  }
};

export const getRecord = async (objectApiName, id) => {
  try {
    const res = await api.get(`/records/${objectApiName}/${id}`);
    return res.data.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to fetch record.');
  }
};

export const createRecord = async (objectApiName, data) => {
  try {
    const res = await api.post(`/records/${objectApiName}`, data);
    return res.data.data;
  } catch (err) {
    // The axios interceptor (api.js) transforms 4xx errors into plain objects
    // { message, status, data } — the full response body is at err.data.
    const responseData = err.response?.data ?? err.data;
    const message = responseData?.message || responseData?.error || err.message || 'Failed to create record.';
    const error = new Error(message);
    error.response = err.response;
    error.data = responseData;
    throw error;
  }
};

export const updateRecord = async (objectApiName, id, data) => {
  try {
    const res = await api.put(`/records/${objectApiName}/${id}`, data);
    return res.data.data;
  } catch (err) {
    const responseData = err.response?.data ?? err.data;
    const message = responseData?.message || responseData?.error || err.message || 'Failed to update record.';
    const error = new Error(message);
    error.response = err.response;
    error.data = responseData;
    throw error;
  }
};

export const patchRecord = async (objectApiName, id, data) => {
  try {
    const res = await api.patch(`/records/${objectApiName}/${id}`, data);
    return res.data.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to patch record.');
  }
};

export const deleteRecord = async (objectApiName, id) => {
  try {
    const res = await api.delete(`/records/${objectApiName}/${id}`);
    return res.data.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to delete record.');
  }
};

export const bulkDeleteRecords = async (objectApiName, ids) => {
  try {
    const res = await api.post(`/records/${objectApiName}/bulk-delete`, {
      ids,
    });
    return res.data.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to delete records.');
  }
};
