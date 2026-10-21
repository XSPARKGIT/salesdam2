/**
 * Hand-authored OpenAPI 3.0.3 description of the Salesdam REST API.
 *
 * Authored rather than generated, because request/response shapes live in the
 * controllers and Joi schemas rather than in any machine-readable form. Every
 * path, method and auth requirement below was read off the real routers in
 * backend/routes and the mounts in backend/app.js, so it reflects the API as
 * deployed, not as designed.
 *
 * COVERAGE: the resources an integrator actually calls — auth, records, objects,
 * fields, list views, search and API keys. The remaining mounts (admin,
 * superadmin, billing, dashboards, automations, incidents, tenders, pdf
 * templates, files, notifications, …) are intentionally not described yet; see
 * UNDOCUMENTED_MOUNTS below, which the API overview page renders so the gap is
 * visible to readers instead of looking like the API doesn't have them.
 */

const ENVELOPE_NOTE =
  'All successful responses share the envelope `{ success: true, message, ...payload }`.';

export const OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'Salesdam CRM API',
    version: '3.3.0',
    description:
      'REST API for the Salesdam CRM platform. Objects, fields and records are ' +
      'metadata-driven: the same endpoints serve standard and custom objects, ' +
      'addressed by their `apiName`.',
  },
  servers: [
    { url: '/api/v1', description: 'Same origin as the app' },
    { url: 'http://localhost:5000/api/v1', description: 'Local development' },
  ],

  // ── Security ──────────────────────────────────────────────────────────────
  // requireAuth (backend/middleware/auth.js) checks the X-API-Key header first
  // and falls back to the session cookie. There is no bearer-token path.
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description:
          'A key created under Integrations. Sent on every request. Keys carry ' +
          'scopes (read/write/delete/admin) and may be restricted by IP and by object.',
      },
      SessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'sid',
        description:
          'Set by POST /auth/login. Used by the web app itself; requests from a ' +
          'browser on the same origin are authenticated automatically.',
      },
    },
    parameters: {
      TenantId: {
        name: 'X-Tenant-Id',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description:
          'Overrides the active tenant. Only needed when the session has no ' +
          'tenant selected — normally the session supplies it.',
      },
      ObjectApiName: {
        name: 'objectApiName',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'client' },
        description: 'API name of the object, e.g. `client`, `deal`, `contact`.',
      },
      RecordId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', example: '665f1c2a9b4e7d0012a3b4c5' },
        description: 'Record id.',
      },
    },
    schemas: {
      Success: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Success' },
          data: {},
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          total: { type: 'integer', example: 137 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 50 },
          totalPages: { type: 'integer', example: 3 },
          hasNext: { type: 'boolean', example: true },
          hasPrev: { type: 'boolean', example: false },
        },
      },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: {
            type: 'string',
            example: 'Validation failed: Client Number cannot be blank',
          },
          errors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Present on validation failures (400).',
          },
          fieldErrors: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Field-keyed messages, for highlighting inputs.',
          },
        },
      },
      Record: {
        type: 'object',
        description:
          'Field values are flattened onto the record. The exact keys depend on ' +
          'the object definition, so this is an open shape.',
        properties: {
          _id: { type: 'string' },
          objectApiName: { type: 'string', example: 'client' },
          ownerId: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
      ObjectMeta: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string', example: 'Client' },
          label: { type: 'string', example: 'Client' },
          pluralLabel: { type: 'string', example: 'Clients' },
          apiName: { type: 'string', example: 'client' },
          description: { type: 'string' },
          icon: { type: 'string', example: 'Building2' },
          color: { type: 'string', example: '#6366f1' },
          isCustom: { type: 'boolean' },
          isSystem: { type: 'boolean' },
          showInNav: { type: 'boolean' },
          navOrder: { type: 'integer' },
          nameFieldApiName: { type: 'string', example: 'name' },
          sharingModel: {
            type: 'string',
            enum: ['public_read_write', 'public_read_only', 'private'],
          },
          validationRules: {
            type: 'array',
            items: { $ref: '#/components/schemas/ValidationRule' },
          },
          fields: {
            type: 'array',
            items: { $ref: '#/components/schemas/FieldMeta' },
            description: 'Included by GET /objects/{apiName}.',
          },
        },
      },
      ValidationRule: {
        type: 'object',
        description:
          'The expression describes the condition to REJECT. When it evaluates ' +
          'to true the save is blocked and `errorMessage` is returned.',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', example: 'Client number is required' },
          description: { type: 'string' },
          expression: { type: 'string', example: 'ISBLANK(client_number)' },
          errorMessage: { type: 'string', example: 'Client Number cannot be blank' },
          isActive: { type: 'boolean', default: true },
        },
        required: ['name', 'expression', 'errorMessage'],
      },
      FieldMeta: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          label: { type: 'string', example: 'Amount' },
          apiName: { type: 'string', example: 'amount' },
          type: {
            type: 'string',
            enum: [
              'text', 'textarea', 'number', 'currency', 'percent', 'date',
              'datetime', 'boolean', 'picklist', 'multipicklist', 'lookup',
              'master_detail', 'email', 'phone', 'url', 'address', 'formula',
              'auto_number', 'rollup_summary',
            ],
          },
          isRequired: { type: 'boolean' },
          isUnique: { type: 'boolean' },
          isReadOnly: { type: 'boolean' },
          isSystem: { type: 'boolean' },
          helpText: { type: 'string' },
          picklistValues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                color: { type: 'string' },
                isDefault: { type: 'boolean' },
                isActive: { type: 'boolean' },
              },
            },
          },
          lookupObjectApiName: { type: 'string' },
          formula: { type: 'string', example: 'ROUND(quantity * unit_price, 2)' },
          formulaReturnType: {
            type: 'string',
            enum: ['text', 'number', 'currency', 'percent', 'date', 'boolean'],
            description:
              'Required on formula fields. Determines how the computed value is ' +
              'stored and rendered, and is checked against the expression on save.',
          },
          rollupObjectApiName: { type: 'string' },
          rollupRelationField: { type: 'string' },
          rollupType: { type: 'string', enum: ['COUNT', 'SUM', 'MIN', 'MAX', 'AVG'] },
          rollupField: { type: 'string' },
          rollupFilter: {
            type: 'string',
            description: 'Formula filter — only children where it is true are aggregated.',
          },
        },
        required: ['label', 'apiName', 'type'],
      },
      ApiKey: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string', example: 'Zapier integration' },
          keyPrefix: { type: 'string', example: 'sk_live_a1b2' },
          scopes: {
            type: 'array',
            items: { type: 'string', enum: ['read', 'write', 'delete', 'admin'] },
          },
          allowedObjects: { type: 'array', items: { type: 'string' } },
          ipWhitelist: { type: 'array', items: { type: 'string' } },
          isActive: { type: 'boolean' },
          lastUsedAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'No valid API key or session.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Authenticated but lacking the required permission or scope.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'The object or record does not exist in this tenant.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      ValidationFailed: {
        description:
          'Field validation or an object validation rule rejected the payload.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },

  security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],

  tags: [
    { name: 'Authentication', description: 'Login, sessions, password management.' },
    { name: 'Records', description: `Create, read, update and delete records of any object. ${ENVELOPE_NOTE}` },
    { name: 'Objects', description: 'Object metadata — the definitions records are stored against.' },
    { name: 'Fields', description: 'Field metadata, nested under an object.' },
    { name: 'List Views', description: 'Saved views: columns, filters and sort order.' },
    { name: 'Search', description: 'Cross-object search and type-ahead suggestions.' },
    { name: 'API Keys', description: 'Programmatic credentials and their usage.' },
  ],

  paths: {
    // ── Authentication ──────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Log in',
        description:
          'Creates a server-side session and sets the session cookie. Rate limited.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'admin@example.com' },
                  password: { type: 'string', format: 'password', example: 'correct-horse-battery' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Logged in; session cookie set.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          429: { description: 'Too many attempts — see Rate Limits.' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Log out',
        description: 'Destroys the current session.',
        responses: { 200: { description: 'Logged out.' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Current user and tenant',
        description:
          'Returns the authenticated user, their role and the active tenant. The ' +
          'cheapest way to check whether a credential is valid.',
        responses: {
          200: { description: 'The current user.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Change password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string', format: 'password' },
                  newPassword: { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Password changed.' }, 400: { $ref: '#/components/responses/ValidationFailed' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Request a password reset',
        description: 'Sends a reset link. Always 200s, so it cannot be used to probe for accounts. Rate limited.',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } },
        },
        responses: { 200: { description: 'Reset email sent if the account exists.' }, 429: { description: 'Too many attempts.' } },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Complete a password reset',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['token', 'password'], properties: { token: { type: 'string' }, password: { type: 'string', format: 'password' } } } } },
        },
        responses: { 200: { description: 'Password reset.' }, 400: { $ref: '#/components/responses/ValidationFailed' } },
      },
    },
    '/auth/sessions': {
      get: {
        tags: ['Authentication'],
        summary: 'List active sessions',
        description: 'Every active session for the current user, with device and last-accessed time.',
        responses: { 200: { description: 'Active sessions.' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/auth/sessions/{sessionId}': {
      delete: {
        tags: ['Authentication'],
        summary: 'Revoke a session',
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Session revoked.' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },

    // ── Records ─────────────────────────────────────────────────────────────
    '/records/{objectApiName}': {
      get: {
        tags: ['Records'],
        summary: 'List records',
        description:
          'Paginated records of one object, scoped to what the caller may see. ' +
          'Formula and rollup values are included. Requires the `read` permission ' +
          'on the object.',
        parameters: [
          { $ref: '#/components/parameters/ObjectApiName' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 }, description: 'Records per page.' },
          { name: 'sort', in: 'query', schema: { type: 'string', example: '-createdAt' }, description: 'Field to sort by; prefix with `-` for descending.' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Free-text match across the object’s searchable fields.' },
          { name: 'filter', in: 'query', schema: { type: 'string' }, description: 'JSON-encoded filter. See Pagination & Filtering.' },
          { name: 'view', in: 'query', schema: { type: 'string' }, description: 'Saved list-view key; supplies columns, filter and sort.' },
          { $ref: '#/components/parameters/TenantId' },
        ],
        responses: {
          200: {
            description: 'A page of records.',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    {
                      type: 'object',
                      properties: {
                        data: { type: 'array', items: { $ref: '#/components/schemas/Record' } },
                        pagination: { $ref: '#/components/schemas/Pagination' },
                      },
                    },
                  ],
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      post: {
        tags: ['Records'],
        summary: 'Create a record',
        description:
          'Field values are sent as top-level keys. Auto-number, formula and ' +
          'rollup fields are computed server-side and must not be supplied. ' +
          'Object validation rules run before the write.',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { $ref: '#/components/parameters/TenantId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Record' },
              example: { name: 'Acme Corp', client_number: 'CL-001', email: 'ops@acme.test', annual_revenue: 250000 },
            },
          },
        },
        responses: {
          201: { description: 'Created.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
          400: { $ref: '#/components/responses/ValidationFailed' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/records/{objectApiName}/{id}': {
      get: {
        tags: ['Records'],
        summary: 'Get one record',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { $ref: '#/components/parameters/RecordId' }],
        responses: {
          200: { description: 'The record.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        tags: ['Records'],
        summary: 'Replace a record',
        description: 'Every editable field is validated. Use PATCH to send only changed fields.',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { $ref: '#/components/parameters/RecordId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Record' } } } },
        responses: {
          200: { description: 'Updated.' },
          400: { $ref: '#/components/responses/ValidationFailed' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['Records'],
        summary: 'Partially update a record',
        description:
          'Only the supplied fields are validated and written. Object validation ' +
          'rules still run against the merged result, so a partial update cannot ' +
          'sneak the record into an invalid state.',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { $ref: '#/components/parameters/RecordId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Record' }, example: { stage: 'won' } } } },
        responses: {
          200: { description: 'Updated.' },
          400: { $ref: '#/components/responses/ValidationFailed' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Records'],
        summary: 'Delete a record',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { $ref: '#/components/parameters/RecordId' }],
        responses: { 200: { description: 'Deleted.' }, 403: { $ref: '#/components/responses/Forbidden' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/records/{objectApiName}/bulk-delete': {
      post: {
        tags: ['Records'],
        summary: 'Delete many records',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } } } },
        },
        responses: { 200: { description: 'Deletion summary.' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/records/{objectApiName}/export': {
      get: {
        tags: ['Records'],
        summary: 'Export records as CSV',
        description: 'Requires the `export` permission. Formula and rollup fields are excluded.',
        parameters: [
          { $ref: '#/components/parameters/ObjectApiName' },
          { name: 'filter', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'CSV file.', content: { 'text/csv': { schema: { type: 'string' } } } }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/records/{objectApiName}/import': {
      post: {
        tags: ['Records'],
        summary: 'Import records from CSV',
        description:
          'Multipart upload, 10 MB limit. Each row is validated and checked ' +
          'against the object’s validation rules; failures are reported per row ' +
          'and do not stop the import.',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } },
        },
        responses: { 200: { description: 'Per-row import results.' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/records/validate': {
      post: {
        tags: ['Records'],
        summary: 'Validate a payload without saving',
        description:
          'Runs field validation and the object’s validation rules and returns ' +
          'what would fail. Use it to validate a form before submitting.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['objectApiName'],
                properties: {
                  objectApiName: { type: 'string', example: 'client' },
                  data: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Validation result.' }, 400: { $ref: '#/components/responses/ValidationFailed' } },
      },
    },
    '/records/validate-formula': {
      post: {
        tags: ['Records'],
        summary: 'Check a formula expression',
        description:
          'Parses and dry-runs an expression against the object’s fields, and — ' +
          'when `returnType` is given — checks the expression actually returns ' +
          'that type. Returns the inferred type either way.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['objectApiName', 'expression'],
                properties: {
                  objectApiName: { type: 'string', example: 'deal_line_item' },
                  expression: { type: 'string', example: 'ROUND(quantity * unit_price, 2)' },
                  returnType: { type: 'string', enum: ['text', 'number', 'currency', 'percent', 'date', 'boolean'] },
                  excludeFieldApiName: { type: 'string', description: 'Field being edited — excluded so a formula cannot reference itself.' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Whether the expression is valid, plus its inferred return type.',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    { type: 'object', properties: { data: { type: 'object', properties: { valid: { type: 'boolean' }, error: { type: 'string' }, returnType: { type: 'string', enum: ['text', 'number', 'boolean', 'date', 'unknown'] } } } } },
                  ],
                },
              },
            },
          },
        },
      },
    },

    // ── Objects ─────────────────────────────────────────────────────────────
    '/objects': {
      get: {
        tags: ['Objects'],
        summary: 'List objects',
        parameters: [{ name: 'withFields', in: 'query', schema: { type: 'boolean' }, description: 'Include each object’s fields.' }],
        responses: { 200: { description: 'Objects visible to the caller.', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Success' }, { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ObjectMeta' } } } }] } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
      post: {
        tags: ['Objects'],
        summary: 'Create a custom object',
        description: 'Requires `canManageObjects`. Seeds the name field and default metadata.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['label', 'apiName'],
                properties: {
                  label: { type: 'string', example: 'Project' },
                  pluralLabel: { type: 'string', example: 'Projects' },
                  apiName: { type: 'string', example: 'project' },
                  description: { type: 'string' },
                  icon: { type: 'string', example: 'FolderKanban' },
                  color: { type: 'string', example: '#6366f1' },
                  nameFieldType: { type: 'string', enum: ['text', 'auto_number'], default: 'text' },
                  nameFieldLabel: { type: 'string', default: 'Name' },
                  sharingModel: { type: 'string', enum: ['public_read_write', 'public_read_only', 'private'] },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created.' }, 400: { $ref: '#/components/responses/ValidationFailed' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/objects/{apiName}': {
      get: {
        tags: ['Objects'],
        summary: 'Get an object with its fields',
        parameters: [{ name: 'apiName', in: 'path', required: true, schema: { type: 'string', example: 'client' } }],
        responses: { 200: { description: 'The object, including `fields`.', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Success' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/ObjectMeta' } } }] } } } }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      put: {
        tags: ['Objects'],
        summary: 'Update an object',
        description:
          'Partial update — only supplied keys change. Sending `validationRules` ' +
          'replaces the whole array, and every active rule must parse.',
        parameters: [{ name: 'apiName', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  pluralLabel: { type: 'string' },
                  description: { type: 'string' },
                  icon: { type: 'string' },
                  color: { type: 'string' },
                  showInNav: { type: 'boolean' },
                  navOrder: { type: 'integer' },
                  sharingModel: { type: 'string' },
                  validationRules: { type: 'array', items: { $ref: '#/components/schemas/ValidationRule' } },
                },
              },
              example: { validationRules: [{ name: 'Client number is required', expression: 'ISBLANK(client_number)', errorMessage: 'Client Number cannot be blank', isActive: true }] },
            },
          },
        },
        responses: { 200: { description: 'Updated.' }, 400: { $ref: '#/components/responses/ValidationFailed' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
      delete: {
        tags: ['Objects'],
        summary: 'Delete a custom object',
        description:
          'Cascades to fields, records, layouts, counters and screens, and strips ' +
          'the object from workspaces and permissions. System objects cannot be deleted.',
        parameters: [{ name: 'apiName', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted, with a summary of the cascade.' }, 403: { description: 'System objects cannot be deleted.' } },
      },
    },

    // ── Fields ──────────────────────────────────────────────────────────────
    '/objects/{objectApiName}/fields': {
      get: {
        tags: ['Fields'],
        summary: 'List fields',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }],
        responses: { 200: { description: 'Fields in display order.', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Success' }, { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/FieldMeta' } } } }] } } } }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      post: {
        tags: ['Fields'],
        summary: 'Create a field',
        description:
          'Requires `canManageObjects`. Formula fields must supply both `formula` ' +
          'and `formulaReturnType`, and the expression is checked against the ' +
          'declared type. Rollup fields require a valid child relationship.',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/FieldMeta' },
              example: { label: 'Subtotal', apiName: 'subtotal', type: 'formula', formula: 'ROUND(quantity * unit_price, 2)', formulaReturnType: 'currency' },
            },
          },
        },
        responses: { 201: { description: 'Created.' }, 400: { $ref: '#/components/responses/ValidationFailed' }, 403: { $ref: '#/components/responses/Forbidden' }, 409: { description: 'A field with that apiName already exists.' } },
      },
    },
    '/objects/{objectApiName}/fields/{fieldApiName}': {
      put: {
        tags: ['Fields'],
        summary: 'Update a field',
        description: 'System fields accept only `label` and `helpText`; anything else is rejected.',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { name: 'fieldApiName', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/FieldMeta' } } } },
        responses: { 200: { description: 'Updated.' }, 400: { $ref: '#/components/responses/ValidationFailed' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
      delete: {
        tags: ['Fields'],
        summary: 'Delete a field',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { name: 'fieldApiName', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Deleted.' }, 403: { description: 'System fields cannot be deleted.' } },
      },
    },
    '/objects/{objectApiName}/fields/reorder': {
      post: {
        tags: ['Fields'],
        summary: 'Reorder fields',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' }, description: 'Field apiNames in the desired order.' } } } } },
        },
        responses: { 200: { description: 'Reordered.' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },

    // ── List views ──────────────────────────────────────────────────────────
    '/list-views/{objectApiName}': {
      get: {
        tags: ['List Views'],
        summary: 'List saved views',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }],
        responses: { 200: { description: 'Views available to the caller.' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
      post: {
        tags: ['List Views'],
        summary: 'Create a saved view',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'Open deals over 100k' },
                  columns: { type: 'array', items: { type: 'string' } },
                  filters: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  sort: { type: 'string', example: '-amount' },
                  isShared: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created.' }, 400: { $ref: '#/components/responses/ValidationFailed' } },
      },
    },
    '/list-views/{objectApiName}/{id}': {
      put: {
        tags: ['List Views'],
        summary: 'Update a saved view',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { $ref: '#/components/parameters/RecordId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { 200: { description: 'Updated.' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      delete: {
        tags: ['List Views'],
        summary: 'Delete a saved view',
        parameters: [{ $ref: '#/components/parameters/ObjectApiName' }, { $ref: '#/components/parameters/RecordId' }],
        responses: { 200: { description: 'Deleted.' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },

    // ── Search ──────────────────────────────────────────────────────────────
    '/search': {
      get: {
        tags: ['Search'],
        summary: 'Search across objects',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'acme' } },
          { name: 'objects', in: 'query', schema: { type: 'string', example: 'client,deal' }, description: 'Comma-separated apiNames to restrict the search to.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Matches grouped by object.' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/search/suggest': {
      get: {
        tags: ['Search'],
        summary: 'Type-ahead suggestions',
        description: 'Lighter than /search — intended for an omnibox.',
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Suggestions.' } },
      },
    },

    // ── API keys ────────────────────────────────────────────────────────────
    '/api-keys': {
      get: {
        tags: ['API Keys'],
        summary: 'List API keys',
        description: 'Requires `canManageApiKeys`. Only the key prefix is returned — the secret is not recoverable.',
        responses: { 200: { description: 'Keys for the tenant.', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Success' }, { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } } } }] } } } }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
      post: {
        tags: ['API Keys'],
        summary: 'Create an API key',
        description:
          'The full key is returned **once, in this response only** — it is stored ' +
          'as a SHA-256 hash and cannot be retrieved again. Capture it immediately.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'scopes'],
                properties: {
                  name: { type: 'string', example: 'Zapier integration' },
                  scopes: { type: 'array', items: { type: 'string', enum: ['read', 'write', 'delete', 'admin'] } },
                  allowedObjects: { type: 'array', items: { type: 'string' }, description: 'Empty means every object.' },
                  ipWhitelist: { type: 'array', items: { type: 'string' }, description: 'Empty means any IP.' },
                  expiresAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created. Contains the plaintext key.' }, 400: { $ref: '#/components/responses/ValidationFailed' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/api-keys/{id}': {
      get: { tags: ['API Keys'], summary: 'Get an API key', parameters: [{ $ref: '#/components/parameters/RecordId' }], responses: { 200: { description: 'The key’s metadata.' }, 404: { $ref: '#/components/responses/NotFound' } } },
      patch: {
        tags: ['API Keys'],
        summary: 'Update an API key',
        parameters: [{ $ref: '#/components/parameters/RecordId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, allowedObjects: { type: 'array', items: { type: 'string' } }, ipWhitelist: { type: 'array', items: { type: 'string' } }, isActive: { type: 'boolean' } } } } } },
        responses: { 200: { description: 'Updated.' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      delete: { tags: ['API Keys'], summary: 'Delete an API key', description: 'Removes it outright. Prefer revoke if you want the audit trail kept.', parameters: [{ $ref: '#/components/parameters/RecordId' }], responses: { 200: { description: 'Deleted.' } } },
    },
    '/api-keys/{id}/revoke': {
      delete: { tags: ['API Keys'], summary: 'Revoke an API key', description: 'Deactivates the key but keeps the record and its usage history.', parameters: [{ $ref: '#/components/parameters/RecordId' }], responses: { 200: { description: 'Revoked.' } } },
    },
    '/api-keys/{id}/usage': {
      get: {
        tags: ['API Keys'],
        summary: 'API key usage',
        description: 'Aggregated request counts for the key over the chosen window.',
        parameters: [
          { $ref: '#/components/parameters/RecordId' },
          { name: 'period', in: 'query', schema: { type: 'string', enum: ['7d', '30d', '90d'], default: '7d' } },
        ],
        responses: { 200: { description: 'Usage aggregation.' } },
      },
    },
  },
};

/**
 * Mounts that exist in backend/app.js but are not described above. Rendered on
 * the API overview page so a reader can tell "not documented yet" from
 * "doesn't exist" — the previous docs simply omitted them silently.
 */
export const UNDOCUMENTED_MOUNTS = [
  '/users', '/roles', '/action-buttons', '/layouts', '/automations', '/analytics',
  '/webhooks', '/admin', '/ai', '/notifications', '/dashboards',
  '/dashboard-folders', '/external-objects', '/custom-screens', '/email-templates',
  '/object-config', '/email-senders', '/workspaces', '/pdf-templates', '/files',
  '/superadmin', '/registration', '/billing', '/subscription', '/incidents',
  '/integrations', '/recurring-tasks', '/tenders', '/leads', '/documents',
];

/** Flattened operations, for the explorer and the search index. */
export const OPERATIONS = Object.entries(OPENAPI.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({
    method: method.toUpperCase(),
    path,
    id: `${method}-${path}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    tag: op.tags?.[0] || 'Other',
    summary: op.summary || '',
    description: op.description || '',
    parameters: op.parameters || [],
    requestBody: op.requestBody || null,
    responses: op.responses || {},
    security: op.security,
  })),
);

/** Operations grouped by tag, in the order tags are declared. */
export const OPERATIONS_BY_TAG = OPENAPI.tags
  .map((t) => ({ ...t, operations: OPERATIONS.filter((o) => o.tag === t.name) }))
  .filter((g) => g.operations.length > 0);
