import express from 'express';
import {
  listConversations,
  getConversation,
  listMessages,
  assignConversation,
  setStatus,
  linkRecord,
  reply,
  replyWithTemplate,
  addNote,
  createRecordFromConversation,
} from '../controllers/inboxController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);

router.get('/', listConversations);
router.get('/:id', getConversation);
router.get('/:id/messages', listMessages);
router.post('/:id/assign', assignConversation);
router.post('/:id/status', setStatus);
router.post('/:id/link', linkRecord);
router.post('/:id/reply', reply);
router.post('/:id/reply-template', replyWithTemplate);
router.post('/:id/notes', addNote);
router.post('/:id/create-record', createRecordFromConversation);

export default router;
