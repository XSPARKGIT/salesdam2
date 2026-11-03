# BRD Section 11 — Generalised Reporting & Analytics Engine

## Implementation Summary

### New Files Created

| File | Purpose |
|------|---------|
| `backend/models/SavedReport.js` | Mongoose model for persisting report configurations (filters, aggregations, cross-object, sharing) |
| `backend/routes/reports.js` | Full CRUD + enhanced report run endpoint with type-aware filters and cross-object joins |
| `frontend/src/services/api/reports.js` | API service (getReports, getReportById, createReport, updateReport, deleteReport, runReport) |
| `frontend/src/pages/Reports/Reports.module.css` | CSS module for report pages (builder layout, cards, charts, responsive) |
| `frontend/src/pages/Reports/ReportList.jsx` | Report list page with card grid, delete modal, navigation |
| `frontend/src/pages/Reports/ReportBuilder.jsx` | Full report builder: object picker, groupBy, aggregations, type-aware filters, cross-object config, chart types, results rendering |
| `frontend/src/pages/Reports/ReportView.jsx` | Read-only report view with auto-execute, refresh, edit buttons, chart/table/metric views |
| `backend/tests/section11-reporting.e2e.mjs` | 64 E2E checks covering all reporting features |

### Modified Files

| File | Change |
|------|--------|
| `backend/app.js` | Added report routes (`/api/v1/reports`) |
| `frontend/src/App.jsx` | Added 4 routes: `/reports`, `/reports/new`, `/reports/:id`, `/reports/:id/edit` |
| `frontend/src/layout/Sidebar/Sidebar.jsx` | Added Reports nav item with FileBarChart icon; fixed missing `useAuth` import (pre-existing bug from Section 14) |

---

## Features Implemented

### 1. Report Engine (POST /api/v1/reports/run)
- Reports against **any standard or custom object** via `objectApiName`
- **GroupBy** any field with automatic COUNT aggregation
- **Aggregation functions**: COUNT, SUM, AVG, MIN, MAX (multiple per report)
- **Raw record mode** (no groupBy) returns full records with data map
- **Type-aware filters** with 15 operators:
  - Equality: `eq`, `neq`
  - Comparison: `gt`, `gte`, `lt`, `lte`
  - String: `contains`, `not_contains`, `starts_with`, `ends_with`
  - Set: `in`, `not_in`
  - Null: `is_null`, `is_not_null`
  - Range: `between`
- Numeric fields auto-cast to `parseFloat`, date fields to `Date`
- **Cross-object reporting** via lookup fields using `$lookup` pipeline with `$toString` comparison
- Date range filtering with `from`/`to`
- Sort by any aggregation or field, with configurable order (asc/desc)
- Configurable result limit (max 1000)
- Permission checks: `hasObjectPermission` for both primary and related objects
- Data access filter (`buildDataAccessFilter`) respects sharing model

### 2. Saved Report CRUD
- **Create**: name, description, objectApiName, groupBy, aggregations, filters, dateRange, chartType, columns, sortField, sortOrder, limit, crossObject, sharing
- **List**: filtered by visibility (private, workspace, roles, users) — admins see all
- **Get**: single report with populated creator and sharing info
- **Update**: owner or admin only
- **Delete**: owner or admin only

### 3. Sharing Model
- `private` — only the creator
- `workspace` — all workspace members
- `roles` — specific roles via `sharedWithRoles`
- `users` — specific users via `sharedWithUsers`

### 4. Frontend — Report Builder
- **Sidebar**: object picker (loads all readable objects from metadata), groupBy selector, aggregation rows (add/remove, function + field + alias), filter rows (field, operator, value — picklist-aware with dropdown, date inputs for date fields), cross-object config (lookup field → auto-populates related object), chart type selector, limit input
- **Main area**: ResultsRenderer supporting table, bar chart, line chart, pie chart, donut chart, metric view (using recharts)
- **Save/Run**: react-query mutations, toast notifications
- **Edit mode**: loads existing report by URL param ID

### 5. Frontend — Report List
- Card grid with report name, description, object, chart type icon, last updated
- Delete confirmation modal
- Navigation to builder (new/edit) and view

### 6. Frontend — Report View
- Auto-executes saved report config on load
- Refresh and Edit buttons
- ChartView, TableView, MetricView components

---

## E2E Test Results

```
64/64 checks passed
```

### Test Coverage

| Category | Checks | Details |
|----------|--------|---------|
| Setup & seeding | 21 | Tenant, admin, 2 objects (Project, Task), 9 fields, 3 projects, 6 tasks with lookup links |
| GroupBy + COUNT | 2 | 3 groups by status |
| SUM aggregation | 2 | Budget sum = 350,000 |
| AVG aggregation | 2 | Hours avg = 25.5 |
| MIN/MAX aggregation | 3 | Min hours = 8, Max hours = 60 |
| Filter: eq | 2 | 1 active project |
| Filter: neq | 1 | Non-active projects |
| Filter: gt (numeric) | 1 | Budget > 75,000 |
| Filter: contains | 1 | String search |
| Filter: in | 1 | Multi-value set |
| Filter: is_null | 1 | Null date field |
| Filter: between | 1 | Numeric range |
| Cross-object | 3 | Tasks grouped by project status, active group hours = 120 |
| Raw records | 4 | 6 tasks, data map present, 8 fields metadata |
| Saved report CRUD | 11 | Create, list, get, update (name + chartType), delete |
| Validation | 4 | Missing objectApiName (400), unknown object (404), missing name (400), bad object (404) |
| Multi-aggregation | 3 | GroupBy priority with COUNT + SUM in one report |

### Regression Tests

| Suite | Result |
|-------|--------|
| Section 9.3 — System Permissions | 42/42 passed |
| Section 10 — Search, List Views, Kanban & Calendar | 36/36 passed |
| Section 11 — Reporting & Analytics Engine | 64/64 passed |

---

## Manual Test Steps

### Prerequisites
1. Start backend: `cd backend && npm run dev` (port 5002)
2. Start frontend: `cd frontend && npm run dev` (port 5173)
3. Log in as an admin user

### Test 1: Navigate to Reports
1. Click **Reports** in the sidebar (FileBarChart icon)
2. **Expected**: Reports list page with "No reports yet" empty state and "New Report" button

### Test 2: Create a Report
1. Click **New Report**
2. Select an object (e.g., "Account" or any custom object with data)
3. Set **Group By** to a text or picklist field (e.g., "Status")
4. Click **Run**
5. **Expected**: Grouped results appear in a table with group name and count
6. Enter a report **Name** (e.g., "Account by Status")
7. Click **Save**
8. **Expected**: Toast "Report saved" and report persisted

### Test 3: Aggregation Functions
1. Create a new report on an object with numeric fields
2. Click **Add** under Aggregations, select **Sum**, pick a numeric field
3. Set **Group By** to a categorical field
4. Click **Run**
5. **Expected**: Table shows group names with SUM values
6. Repeat for **Average**, **Min**, **Max**

### Test 4: Type-Aware Filters
1. In the report builder, click **Add Filter**
2. Select a text field → operator **contains** → enter partial text
3. Click **Run**
4. **Expected**: Only matching records shown
5. Change operator to **eq**, **neq**, **is_null**
6. For numeric fields: test **gt**, **between**
7. For picklist fields: operator dropdown shows picklist values

### Test 5: Cross-Object Reporting
1. Ensure there are two objects linked by a lookup field (e.g., Tasks → Projects)
2. In the builder, select the child object (Tasks)
3. Under **Cross-Object**, select the lookup field
4. The related object auto-populates
5. Set **Related Group By** (e.g., the parent's Status field)
6. Add an aggregation (e.g., SUM hours)
7. Click **Run**
8. **Expected**: Results grouped by the parent object's field values

### Test 6: Chart Types
1. Create a grouped report with data
2. Change **Chart Type** to **Bar** → **Expected**: Bar chart renders
3. Change to **Line** → **Expected**: Line chart renders
4. Change to **Pie** → **Expected**: Pie chart with percentages
5. Change to **Metric** → **Expected**: Single large number

### Test 7: Report View
1. Go to Reports list → click on a saved report
2. **Expected**: Report auto-executes and shows results
3. Click **Refresh** → **Expected**: Results reload
4. Click **Edit** → **Expected**: Navigates to builder with pre-filled config

### Test 8: Report CRUD
1. Create a report → verify it appears in the list
2. Open it → click **Edit** → change the name → **Save**
3. Go back to list → verify updated name
4. Delete the report → confirm in modal
5. **Expected**: Report removed from list

### Test 9: Permissions
1. Non-admin users should only see objects they have read permission for in the object picker
2. Private reports should only be visible to their creator
3. Workspace-shared reports should be visible to all workspace members

---

## Bug Fixes During Implementation

1. **Lookup field values not stored**: E2E test was extracting `r.json.data._id` but the API returns `r.json.data.id`. Fixed to use `r.json.data.id || r.json.data._id`.

2. **Sidebar crash (pre-existing)**: Section 14 replaced `useAuth` import with `useBranding` but the component still calls both hooks. Fixed by adding both imports.

---

## Architecture Notes

- The reporting engine is fully metadata-driven — no hardcoded object-specific behavior
- Cross-object joins use MongoDB `$lookup` with `$toString` for flexible ID comparison (handles both string and ObjectId storage)
- Filter casting is type-aware: numeric fields auto-parse to float, date fields to Date objects
- The SavedReport model supports all configuration needed to reproduce any report run
- Frontend uses recharts for chart rendering with responsive containers
- The API enforces object-level permissions and the tenant sharing model
