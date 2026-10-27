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
