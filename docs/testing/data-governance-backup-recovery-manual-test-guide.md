# Data Governance — Backup & Recovery Manual Test Guide

## Purpose
Manual verification of tenant-scoped backup and restore.

## Prerequisites
- Admin user, backend running on port 5002, frontend on 5173.
- `BACKUP_DIR` optional (default `./backups`).

## Automated tests
- `node tests/telephony.e2e.mjs`, `node tests/omnichannel.e2e.mjs`, `node tests/audit.e2e.mjs`

## Manual cases

### MT-01 Create backup
1. Log in as admin.
2. `POST /api/v1/admin/backups` with empty body.
3. Expected: 201 with backup id and metadata.

### MT-02 Verify backup
1. `GET /api/v1/admin/backups/{id}/verify`
2. Expected: `{ valid: true }`.

### MT-03 List backups
1. `GET /api/v1/admin/backups`
2. Expected: array containing the backup.

### MT-04 Simulate data loss
1. Delete a test record via API.
2. Confirm it is gone.

### MT-05 Restore
1. `POST /api/v1/admin/backups/{id}/restore`
2. Expected: 200 with restored counts; record reappears.

### MT-06 Corrupted backup
1. Tamper with a backup JSON file's data.
2. Call verify.
3. Expected: error (checksum mismatch).

### MT-07 Permission
1. Log in as non-admin.
2. Call backup endpoints.
3. Expected: 403.

### MT-08 Tenant isolation
1. Admin from Tenant A cannot see/restore Tenant B backups (tenant mismatch returns 404).

### MT-09 Delete backup
1. `DELETE /api/v1/admin/backups/{id}`
2. Expected: 200; file removed.

## Known limitations
- Tenant-scoped only; not full-environment.
- No scheduling/encryption at rest beyond filesystem permissions.
- No transactional atomicity across collections.
