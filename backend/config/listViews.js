import { CURRENT_USER } from '../services/listViewService.js';

/**
 * Default list views and default columns for the standard objects.
 *
 * These are defined in config and merged in at request time rather than seeded
 * as database rows, so they are always present for every tenant, stay correct as
 * object definitions change, and can't be deleted by accident. User-created
 * views live in the ListView collection alongside them.
 */

/**
 * The field that represents ownership on each object. Verified against
 * config/objects/*.js — note that none of the standard objects define
 * `owner_id`, so that must not be used here.
 *
 * `product` has no ownership field at all, so it falls back to the record's
 * root `ownerId` column.
 */
export const OWNERSHIP_FIELDS = {
  lead: 'sales_rep',
  deal: 'sales_rep',
  order: 'sales_rep',
  contact: 'owner',
  client: 'owner',
  task: 'assigned_to',
  case: 'assigned_to',
  quote: 'ownerId',
  invoice: 'ownerId',
  product: 'ownerId',
};

/** Falls back to the root owner column for objects with no ownership field. */
export const ownershipFieldFor = (objectApiName) =>
  OWNERSHIP_FIELDS[objectApiName] || 'ownerId';

/**
 * Default column sets. Every apiName here was checked against the object
 * definitions — e.g. "Selling Price" is `order_value`, Contact/Client owner is
 * `owner`, and Product's unit price is `price`.
 */
export const DEFAULT_COLUMNS = {
  lead: ['technical_scope', 'client', 'rfq_number', 'approval_status', 'status', 'sales_rep'],
  deal: ['name', 'client', 'project_code', 'stage', 'order_value', 'closing_date', 'sales_rep', 'countdown'],
  order: ['name', 'client', 'order_number', 'order_value', 'invoice_number', 'delivery_date', 'project_manager', 'end_user'],
  product: ['name', 'sku', 'product_type', 'price'],
  contact: ['name', 'email', 'phone', 'client', 'owner'],
  client: ['name', 'industry', 'type', 'website', 'owner'],
  task: ['subject', 'description', 'status', 'priority', 'due_date', 'countdown', 'assigned_to'],
  case: ['subject', 'description', 'status', 'priority', 'assigned_to'],
};

// Leads and deals both track conversion; every view except the explicitly
// "converted" one should exclude converted records.
const NOT_CONVERTED = { field: 'is_converted', operator: 'is_false' };

const EXCLUDES_CONVERTED = new Set(['lead', 'deal']);

/** Extra views beyond the three every object gets. */
const OBJECT_VIEWS = {
  lead: [
    {
      key: 'my_open_leads',
      name: 'My Open Leads',
      filters: [
        { field: 'sales_rep', operator: 'eq', value: CURRENT_USER },
        { field: 'status', operator: 'eq', value: 'open' },
      ],
    },
    {
      key: 'all_open_leads',
      name: 'All Open Leads',
      filters: [{ field: 'status', operator: 'eq', value: 'open' }],
    },
    {
      key: 'todays_leads',
      name: "Today's Leads",
      filters: [{ field: 'createdAt', operator: 'date_is', value: 'today' }],
    },
    {
      key: 'converted_leads',
      name: 'Converted Leads',
      // The only lead view that intentionally shows converted records.
      includeConverted: true,
      filters: [{ field: 'is_converted', operator: 'is_true' }],
    },
  ],
  deal: [
    {
      key: 'open_deals',
      name: 'Open Deals',
      filters: [{ field: 'stage', operator: 'in', value: ['work_in_progress', 'submitted'] }],
    },
    {
      key: 'closed_won',
      name: 'Closed Won',
      filters: [{ field: 'stage', operator: 'eq', value: 'closed_won' }],
    },
    {
      key: 'deals_closing_this_month',
      name: 'Deals Closing This Month',
      filters: [{ field: 'closing_date', operator: 'date_is', value: 'this_month' }],
      sortField: 'closing_date',
      sortOrder: 'asc',
    },
  ],
  contact: [
    {
      key: 'added_today',
      name: 'Added Today',
      filters: [{ field: 'createdAt', operator: 'date_is', value: 'today' }],
    },
  ],
  client: [
    {
      key: 'added_today',
      name: 'Added Today',
      filters: [{ field: 'createdAt', operator: 'date_is', value: 'today' }],
    },
  ],
  task: [
    {
      key: 'my_tasks_due_today',
      name: 'My Tasks Due Today',
      filters: [
        { field: 'assigned_to', operator: 'eq', value: CURRENT_USER },
        { field: 'due_date', operator: 'date_is', value: 'today' },
      ],
      sortField: 'due_date',
      sortOrder: 'asc',
    },
    {
      key: 'my_tasks_due_this_week',
      name: 'My Tasks Due This Week',
      filters: [
        { field: 'assigned_to', operator: 'eq', value: CURRENT_USER },
        { field: 'due_date', operator: 'date_is', value: 'this_week' },
      ],
      sortField: 'due_date',
      sortOrder: 'asc',
    },
  ],
  case: [
    {
      key: 'high_priority_cases',
      name: 'High Priority Cases',
      filters: [{ field: 'priority', operator: 'eq', value: 'high' }],
    },
  ],
};

/**
 * Builds the full set of default views for an object.
 *
 * @param {object} objectMeta - ObjectMeta doc (needs apiName + pluralLabel)
 * @param {Array}  [fields]   - optional FieldMeta docs; when supplied, custom
 *                               objects without hardcoded columns derive a
 *                               sensible default set from their field definitions.
 * @returns {Array} view descriptors
 */
export const defaultViewsFor = (objectMeta, fields) => {
  const apiName = objectMeta?.apiName;
  if (!apiName) return [];

  const plural = objectMeta.pluralLabel || objectMeta.label || apiName;
  const ownerField = ownershipFieldFor(apiName);

  let columns = DEFAULT_COLUMNS[apiName] || [];

  // For objects without hardcoded columns, derive a sensible set from fields.
  if (columns.length === 0 && Array.isArray(fields) && fields.length > 0) {
    const SKIP_TYPES = ['textarea', 'richtext', 'address'];
    columns = fields
      .filter((f) => !SKIP_TYPES.includes(f.type) && !f.isHelper)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .slice(0, 6)
      .map((f) => f.apiName);
  }

  const universal = [
    { key: 'all', name: `All ${plural}`, filters: [] },
    { key: 'recently_viewed', name: 'Recently Viewed', filters: [], source: 'recently_viewed' },
    {
      key: 'my_records',
      name: `My ${plural}`,
      filters: [{ field: ownerField, operator: 'eq', value: CURRENT_USER }],
    },
  ];

  const extras = OBJECT_VIEWS[apiName] || [];

  return [...universal, ...extras].map((view) => {
    const filters = [...(view.filters || [])];

    if (EXCLUDES_CONVERTED.has(apiName) && !view.includeConverted) {
      filters.push(NOT_CONVERTED);
    }

    return {
      key: view.key,
      name: view.name,
      objectApiName: apiName,
      filters,
      columns,
      sortField: view.sortField || null,
      sortOrder: view.sortOrder || 'desc',
      source: view.source || 'records',
      isDefault: true,
      isSystem: true,
    };
  });
};

export default { defaultViewsFor, DEFAULT_COLUMNS, OWNERSHIP_FIELDS, ownershipFieldFor };
