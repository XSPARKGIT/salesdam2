# Recent Features — Manual Test Flows

## 1. Attachments
1. Open a Contact/Lead record.
2. Use Attachments panel to upload a small .txt/.png.
3. Verify file appears with metadata.
4. Click Preview/Download.
5. Invalid file type/oversize → error.

## 2. Communication Preferences & Consent
1. Open record → Communication Preferences panel.
2. Change email/WhatsApp/telephone/marketing/preferred channel → saves.
3. Record consent grant/denial/withdrawal.
4. Verify history preserved and current preference updated.

## 3. Backup & Recovery
1. Admin → Admin Settings → Backup & Recovery.
2. Create Backup → listed.
3. Verify → valid.
4. Restore (test tenant) → data restored.
5. Non-admin → 403.

## 4. Activity Timeline & Follow-Up
1. Open record → timeline.
2. Add call/email/meeting/note/task.
3. Filter by type/date/user.
4. Qualifying call with followUpRequired → task + notification.
5. Complete task → completion metadata.

## 5. Audit Logs
1. Any user → Audit Logs (sidebar/profile).
2. Perform action → appears in list.
3. "Only my actions" checkbox filters.
4. Non-admin cannot see others' logs.

## 6. Auth Lockout Isolation
1. Fail login 10 times for User A.
2. User B from same IP can still log in.

## 7. Admin Password Reset
1. Admin resets user password.
2. User logs in with new password (old fails).

## 8. Email-Only Login
1. Login with email + password → success.
2. Login with username → fail.

## 9. Onboarding
1. New user sees welcome modal.
2. Start tour → tooltips navigate.
3. Skip/finish → no auto replay after completion.

## 10. Telephony Stub
1. Lead/Contact record → Call button.
2. Enter number → Call.
3. Expect 501 not implemented message.

## 11. Audit Logs (All Users)
1. Log in as any user.
2. Perform an action (create record).
3. Open Audit Logs (sidebar or profile menu).
4. Verify entry appears with timestamp/action/resource/user/IP/status.
5. Toggle "Only my actions" → only own events.
6. Non-admin cannot see others' events.

## 12. Admin Password Reset
1. Admin opens user detail.
2. Reset password.
3. User logs in with new password (old fails).

## 13. Email-Only Login
1. Login with email + password → success.
2. Login with username (non-email) → fail.

## 14. Auth Lockout Isolation
1. Fail login 10x for User A.
2. User B same IP can still log in.

## 15. Telephony Stub
1. Lead/Contact record → Call button.
2. Enter number → Call.
3. Expect 501 message.

## 16. Onboarding
1. New user sees welcome modal.
2. Start tour → tooltips navigate.
3. Skip/finish → no auto replay after completion.

## 17. Backup Restore
1. Create backup.
2. Delete test record.
3. Restore backup.
4. Verify record restored.
5. Tenant isolation: other tenant unchanged.
