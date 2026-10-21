import api from '../api';
import { WORKSPACES_CHANGED_EVENT } from '../../context/workspaceEvents';

// Let the auth context reload the switcher/sidebar after an admin edit.
const notifyChanged = () => window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));

// ── Workspace management (admin — within current tenant) ─────────────────────
export const getWorkspaces = async (params) => {
  try {
    const res = await api.get('/workspaces', { params });
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to fetch workspaces.',
    );
  }
};

export const getWorkspace = async (id) => {
  try {
    const res = await api.get(`/workspaces/${id}`);
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to fetch workspace.',
    );
  }
};

export const createWorkspace = async (data) => {
  try {
    const res = await api.post('/workspaces', data);
    notifyChanged();
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to create workspace.',
    );
  }
};

export const updateWorkspace = async (id, data) => {
  try {
    const res = await api.put(`/workspaces/${id}`, data);
    notifyChanged();
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to update workspace.',
    );
  }
};

export const deleteWorkspace = async (id) => {
  try {
    const res = await api.delete(`/workspaces/${id}`);
    notifyChanged();
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to delete workspace.',
    );
  }
};

// Member management
export const addWorkspaceMember = async (id, userId) => {
  try {
    const res = await api.post(`/workspaces/${id}/members`, { userId });
    notifyChanged();
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to add workspace member.',
    );
  }
};

export const removeWorkspaceMember = async (id, userId) => {
  try {
    const res = await api.delete(`/workspaces/${id}/members/${userId}`);
    notifyChanged();
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to remove workspace member.',
    );
  }
};

// Current user's workspaces
export const getMyWorkspaces = async () => {
  try {
    const res = await api.get('/workspaces/mine');
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to fetch my workspaces.',
    );
  }
};

export const updateWorkspaceObjects = async (id, objectIds) => {
  try {
    const res = await api.put(`/workspaces/${id}`, {
      allowedObjects: objectIds,
    });
    notifyChanged();
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to update workspace objects.',
    );
  }
};

// Object groups management
export const updateWorkspaceObjectGroups = async (id, objectGroups) => {
  try {
    const res = await api.put(`/workspaces/${id}/object-groups`, {
      objectGroups,
    });
    notifyChanged();
    return res?.data?.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to update object groups.',
    );
  }
};
