import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import User from '../models/User.js';
import { asyncHandler, sendSuccess, AppError } from '../utils/errors.js';
import { reindexObject } from '../services/searchService.js';

/**
 * GET /api/search?q=term&objects=contact,account&limit=20
 */
const globalSearch = asyncHandler(async (req, res) => {
  const { q, objects: objectsStr, limit = 20, page = 1 } = req.query;

  if (!q || q.trim().length < 2) {
    return sendSuccess(res, { data: { records: [], users: [], total: 0 } });
  }

  const searchTerm = q.trim();
  const lim = Math.min(parseInt(limit), 100);
  const skip = (parseInt(page) - 1) * lim;

  // Determine which objects to search
  let objectFilter = { tenantId: req.tenantId, isActive: true, searchable: true };
  if (objectsStr) {
    const objectNames = objectsStr.split(',').map(s => s.trim());
    objectFilter.apiName = { $in: objectNames };
  }

  const searchableObjects = await ObjectMeta.find(objectFilter).select('apiName name nameFieldApiName');
  const objectApiNames = searchableObjects.map(o => o.apiName);

  // Search records using MongoDB text index
  let recordResults = [];
  if (objectApiNames.length > 0) {
    recordResults = await DynamicRecord.find({
      tenantId: req.tenantId,
      objectApiName: { $in: objectApiNames },
      isDeleted: false,
      $text: { $search: searchTerm },
    })
      .select({ score: { $meta: 'textScore' }, data: 1, objectApiName: 1, createdAt: 1, ownerId: 1 })
      .sort({ score: { $meta: 'textScore' } })
      .skip(skip)
      .limit(lim)
      .lean();
  }

  // Also search by ID (exact match)
  if (/^[0-9a-fA-F]{24}$/.test(searchTerm)) {
    const idMatch = await DynamicRecord.findOne({
      _id: searchTerm, tenantId: req.tenantId, isDeleted: false,
    }).lean();
    if (idMatch && !recordResults.find(r => r._id.toString() === searchTerm)) {
      recordResults.unshift(idMatch);
    }
  }

  // Ensure all records have the nameFieldApiName loaded for formatting
  // Re-fetch records to include their name field if not already included
  if (recordResults.length > 0) {
    const recordsWithoutNameField = recordResults.filter(r => {
      const objMeta = searchableObjects.find(o => o.apiName === r.objectApiName);
      const nameFieldApiName = objMeta?.nameFieldApiName || 'name';
      return !r.data || !(nameFieldApiName in r.data);
    });

    if (recordsWithoutNameField.length > 0) {
      const recordIds = recordsWithoutNameField.map(r => r._id);
      const reloadedRecords = await DynamicRecord.find({ _id: { $in: recordIds }, tenantId: req.tenantId }).lean();
      recordResults = recordResults.map(r => {
        const reloaded = reloadedRecords.find(rr => rr._id.toString() === r._id.toString());
        return reloaded || r;
      });
    }
  }

  // Search users
  const userResults = await User.find({
    tenantId: req.tenantId,
    status: 'active',
    $or: [
      { firstName: { $regex: searchTerm, $options: 'i' } },
      { lastName: { $regex: searchTerm, $options: 'i' } },
      { email: { $regex: searchTerm, $options: 'i' } },
    ],
  })
    .select('firstName lastName email avatar title')
    .limit(10)
    .lean();

  // Format records
  const formattedRecords = recordResults.map(r => {
    const dataObj = {};
    if (r.data) {
      for (const [k, v] of Object.entries(r.data)) {
        dataObj[k] = v;
      }
    }
    const objMeta = searchableObjects.find(o => o.apiName === r.objectApiName);
    const nameFieldApiName = objMeta?.nameFieldApiName || 'name';
    const recordName = dataObj[nameFieldApiName] || `${objMeta?.name || r.objectApiName} Record`;

    return {
      id: r._id,
      objectApiName: r.objectApiName,
      objectLabel: objMeta?.name || r.objectApiName,
      recordName: String(recordName).trim(),
      data: dataObj,
      createdAt: r.createdAt,
    };
  });

  sendSuccess(res, {
    data: {
      records: formattedRecords,
      users: userResults,
      total: formattedRecords.length + userResults.length,
      query: searchTerm,
    },
  });
});

/**
 * GET /api/search/suggest?q=term&object=contact&field=name
 * Autocomplete suggestions for lookup fields
 */
const suggest = asyncHandler(async (req, res) => {
  const { q, object: objectApiName, field = 'name', limit = 10 } = req.query;
  if (!objectApiName) return sendSuccess(res, { data: [] });

  const trimmed = (q || '').trim();

  // Special handling for 'user' object type
  if (objectApiName === 'user') {
    const userQuery = {
      tenantId: req.tenantId,
      status: 'active',
    };

    // Build search conditions based on the display field
    if (trimmed) {
      if (field === 'firstName') {
        userQuery.firstName = { $regex: trimmed, $options: 'i' };
      } else if (field === 'lastName') {
        userQuery.lastName = { $regex: trimmed, $options: 'i' };
      } else if (field === 'email') {
        userQuery.email = { $regex: trimmed, $options: 'i' };
      } else {
        // Default: search across firstName, lastName, and email
        userQuery.$or = [
          { firstName: { $regex: trimmed, $options: 'i' } },
          { lastName: { $regex: trimmed, $options: 'i' } },
          { email: { $regex: trimmed, $options: 'i' } },
        ];
      }
    }

    const users = await User.find(userQuery)
      .select({ firstName: 1, lastName: 1, email: 1, _id: 1 })
      .sort({ firstName: 1 })
      .limit(parseInt(limit))
      .lean();

    const suggestions = users.map(u => {
      let label = '';
      if (field === 'firstName') {
        label = u.firstName || '';
      } else if (field === 'lastName') {
        label = u.lastName || '';
      } else if (field === 'email') {
        label = u.email || '';
      } else {
        // Default display format: "FirstName LastName <email>"
        label = `${u.firstName || ''} ${u.lastName || ''}`.trim();
        if (u.email) label += ` <${u.email}>`;
      }
      return {
        id: u._id,
        label: label || u.email || '',
      };
    }).filter(s => s.label);

    return sendSuccess(res, { data: suggestions });
  }

  // For non-user objects, search DynamicRecords
  const query = {
    tenantId: req.tenantId,
    objectApiName,
    isDeleted: false,
  };

  if (trimmed) {
    // Regex search on the display field
    query[`data.${field}`] = { $regex: trimmed, $options: 'i' };
  }

  const records = await DynamicRecord.find(query)
    .select({ [`data.${field}`]: 1, _id: 1 })
    .sort({ createdAt: -1 })     // most recent first
    .limit(parseInt(limit))
    .lean();

  const suggestions = records.map(r => ({
    id: r._id,
    label: r.data?.[field] || '',
  })).filter(s => s.label); // drop records where the display field is empty

  sendSuccess(res, { data: suggestions });
});

/**
 * POST /api/search/reindex/:objectApiName
 * Admin-only: rebuild _searchText for all existing records on an object.
 */
const reindexObjectRoute = asyncHandler(async (req, res) => {
  const { objectApiName } = req.params;
  const obj = await ObjectMeta.findOne({ tenantId: req.tenantId, apiName: objectApiName });
  if (!obj) throw new AppError(`Object "${objectApiName}" not found.`, 404);

  // Fire-and-forget — returns immediately; reindex runs in background
  reindexObject(req.tenantId, objectApiName).catch(() => {});

  sendSuccess(res, { data: { objectApiName } }, 'Reindex started — records will appear in search within seconds.');
});

export { globalSearch, suggest, reindexObjectRoute };
