import api from '../api';

export const listObjects = (params) => api.get('/objects', { params });

export const getObjects = async (params) => {
  try {
    const res = await api.get('/objects', { params });
    return res.data.data || [];
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to fetch objects.');
  }
};

export const getObject = async (apiName) => {
  try {
    const res = await api.get(`/objects/${apiName}`);
    return res.data.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to fetch object.');
  }
};

export const createObject = async (data) => {
  try {
    const res = await api.post('/objects', data);
    return res.data.data;
  } catch (err) {
    throw new Error(
      err?.message || err.response?.data?.message || 'Failed to create object.',
    );
  }
};

export const updateObject = async (apiName, data) => {
  try {
    const res = await api.put(`/objects/${apiName}`, data);
    return res.data.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to update object.');
  }
};

export const deleteObject = async (apiName) => {
  try {
    const res = await api.delete(`/objects/${apiName}?force=true`);
    return res.data.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to delete object.');
  }
};

export const getFields = async (objectApiName) => {
  try {
    const res = await api.get(`/objects/${objectApiName}/fields`);
    return res.data.data || [];
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to fetch fields.');
  }
};

export const listFields = (objectApiName) =>
  api.get(`/objects/${objectApiName}/fields`);

/**
 * Every field in the tenant, across all objects. One request, so callers that
 * need to reason about cross-object relationships (which child objects point at
 * this one, and how) don't have to fan out per object.
 */
export const getAllFields = async () => {
  try {
    const res = await api.get('/fields');
    return res.data.data || [];
  } catch {
    return [];
  }
};

export const createField = async (objectApiName, data) => {
  try {
    const res = await api.post(`/objects/${objectApiName}/fields`, data);
    return res.data;
  } catch (err) {
    throw new Error(
      err?.data?.message || err?.message || 'Failed to create field.',
    );
  }
};

export const updateField = async (objectApiName, fieldApiName, data) => {
  try {
    const res = await api.put(
      `/objects/${objectApiName}/fields/${fieldApiName}`,
      data,
    );
    return res.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to update field.');
  }
};

export const deleteField = async (objectApiName, fieldApiName) => {
  try {
    const res = await api.delete(
      `/objects/${objectApiName}/fields/${fieldApiName}`,
    );
    return res.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to delete field.');
  }
};

export const reorderFields = (objectApiName, order) =>
  api.post(`/objects/${objectApiName}/fields/reorder`, { order });

// ─────────────────────────────────────────────
// Record + Object + Layout (combined fetch)
// ─────────────────────────────────────────────
export const getRecordDetailBundle = async (objectApiName, id) => {
  try {
    const [recordRes, objectRes, layoutRes] = await Promise.all([
      api.get(`/records/${objectApiName}/${id}`),
      api.get(`/objects/${objectApiName}`),
      api.get(`/layouts/${objectApiName}?t=${Date.now()}`).catch(() => null),
    ]);

    const record = recordRes.data.data;

    const fields = (objectRes.data.data.fields || []).sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );

    let layout = null;

    if (layoutRes) {
      const layouts = layoutRes.data.data || [];

      const defaultLayout =
        layouts.find((l) => l.isDefault && l.type === 'detail') ||
        layouts.find((l) => l.isDefault) ||
        layouts[0];

      if (defaultLayout?.sections?.length > 0) {
        layout = defaultLayout;
      }
    }

    return { record, fields, layout };
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to load record detail.',
    );
  }
};

// ─────────────────────────────────────────────
// Custom screens
// ─────────────────────────────────────────────
export const getCustomScreens = async (objectApiName) => {
  try {
    const res = await api.get(`/custom-screens?objectApiName=${objectApiName}`);
    return res.data.data || [];
  } catch {
    return [];
  }
};

// ─────────────────────────────────────────────
// Screen flows
// ─────────────────────────────────────────────
export const getScreenFlows = async (objectApiName) => {
  try {
    const res = await api.get(
      `/automations/screen-flows?objectApiName=${objectApiName}`,
    );
    return res.data.data || [];
  } catch {
    return [];
  }
};

// ─────────────────────────────────────────────
// Related objects
// ─────────────────────────────────────────────
export const getRelatedObjects = async (objectApiName) => {
  try {
    const allFieldsRes = await api.get('/fields');
    const allFields = allFieldsRes.data.data || [];

    // Direct relationships: objects that have a lookup/master_detail pointing at us
    const lookupFieldsMeta = allFields.filter(
      (f) =>
        (f.type === 'lookup' || f.type === 'master_detail') &&
        f.lookupObjectApiName === objectApiName,
    );

    const byObject = {};
    lookupFieldsMeta.forEach((f) => {
      if (!byObject[f.objectApiName]) byObject[f.objectApiName] = f;
    });

    const directList = await Promise.all(
      Object.entries(byObject).map(async ([objApiName, relField]) => {
        try {
          const res = await api.get(`/objects/${objApiName}`);
          const objMeta = res.data.data;
          return {
            objectMeta: objMeta,
            relatedField: relField,
            fields: (objMeta.fields || []).sort((a, b) => a.displayOrder - b.displayOrder),
          };
        } catch {
          return null;
        }
      }),
    );

    // Through-object (junction) relationships:
    // Find junction objects that have a master_detail pointing at us, then
    // expose the OTHER object they link to as a through-object related list.
    const junctionEntries = directList.filter(
      (entry) => entry && entry.objectMeta.isJunctionObject && entry.relatedField.type === 'master_detail',
    );

    const throughList = await Promise.all(
      junctionEntries.map(async (jEntry) => {
        try {
          // Find the other master_detail on this junction object
          const jFields = jEntry.objectMeta.fields || [];
          const otherMd = jFields.find(
            (f) =>
              f.type === 'master_detail' &&
              f.lookupObjectApiName !== objectApiName,
          );
          if (!otherMd) return null;

          const otherRes = await api.get(`/objects/${otherMd.lookupObjectApiName}`);
          const otherMeta = otherRes.data.data;
          return {
            objectMeta: otherMeta,
            relatedField: otherMd,
            fields: (otherMeta.fields || []).sort((a, b) => a.displayOrder - b.displayOrder),
            // Extra context so RecordDetail can render the through-object list correctly
            isThrough: true,
            junctionObjectMeta: jEntry.objectMeta,
            junctionRelatedField: jEntry.relatedField, // the MD field on the junction pointing at US
          };
        } catch {
          return null;
        }
      }),
    );

    return [...directList.filter(Boolean), ...throughList.filter(Boolean)];
  } catch {
    return [];
  }
};

// objects.js
export const getFormBundle = async (objectApiName) => {
  try {
    const [objectRes, layoutRes] = await Promise.all([
      api.get(`/objects/${objectApiName}`),
      api.get(`/layouts/${objectApiName}?t=${Date.now()}`).catch(() => null),
    ]);

    const allFields = (objectRes.data.data.fields || [])
      // .filter(
      //   (f) =>
      //     (!f.isSystem || f.apiName === 'name') &&
      //     f.type !== 'auto_number' &&
      //     f.type !== 'formula' &&
      //     f.type !== 'rollup_summary',
      // )
      .sort((a, b) => a.displayOrder - b.displayOrder);

    let layout = null;

    if (layoutRes) {
      const layouts = layoutRes.data.data || [];

      const best =
        layouts.find((l) => l.isDefault && l.type === 'detail') ||
        layouts.find((l) => l.isDefault) ||
        layouts[0];

      if (best?.sections?.length > 0) {
        layout = best;
      }
    }

    return { fields: allFields, layout };
  } catch (err) {
    throw new Error(
      err.response?.data?.message || 'Failed to load form bundle.',
    );
  }
};

/**
 * Save related list column configuration
 */
export const updateRelatedListColumns = async ({
  parentObjectApiName,
  childObjectApiName,
  lookupFieldApiName,
  columns,
}) => {
  try {
    const res = await api.put(
      `/objects/${parentObjectApiName}/fields/${lookupFieldApiName}/related-list-config`,
      {
        childObjectApiName,
        lookupFieldApiName,
        columns,
      },
    );

    return res.data.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message ||
        'Failed to update related list configuration.',
    );
  }
};

/**
 * Fetches records + object metadata in parallel.
 * Returns { records, pagination, fields } so RecordList can derive everything
 * from a single query.
 */
export const getRecordListBundle = async (objectApiName, params) => {
  try {
    const [recordsRes, objectRes] = await Promise.all([
      api.get(`/records/${objectApiName}`, { params }),
      api.get(`/objects/${objectApiName}`),
    ]);

    const fields = (objectRes.data.data?.fields || []).sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );

    return {
      records: recordsRes.data.data || [],
      pagination: recordsRes.data.pagination || {},
      fields,
    };
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to fetch records.');
  }
};

/**
 * Fetches only records (when object metadata is already loaded).
 *
 * When `params.view` is a saved-list-view key the response also carries the
 * resolved view (`{ key, name, columns, sortField, sortOrder, isDefault }`).
 * Its `columns` array is the authoritative, ordered column set for that view.
 */
export const listDeletedRecords = async (objectApiName, params = {}) => {
  try {
    const res = await api.get(`/records/${objectApiName}/deleted`, { params });
    return {
      records: res.data.data || [],
      pagination: res.data.pagination || {},
    };
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to fetch recycle bin.');
  }
};

export const restoreRecord = async (objectApiName, id) => {
  try {
    const res = await api.post(`/records/${objectApiName}/${id}/restore`);
    return res.data.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || 'Failed to restore record.');
  }
};

export const getRecords = async (objectApiName, params) => {
  try {
    const res = await api.get(`/records/${objectApiName}`, { params });
    return {
      records: res.data.data || [],
      pagination: res.data.pagination || {},
      view: res.data.view || null,
    };
  } catch (err) {
    const error = new Error(
      err?.message || err.response?.data?.message || 'Failed to fetch records.',
    );
    error.status = err?.status ?? err?.response?.status;
    throw error;
  }
};
