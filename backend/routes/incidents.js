import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { checkAppPermission } from '../middleware/permissions.js';
import { enforceTenant, injectTenantId } from '../middleware/tenant.js';
import {
  getIncidents,
  getAllIncidents,
  getIncident,
  createIncident,
  updateIncident,
  upvoteIncident,
  addComment,
  deleteComment,
  addReply,
  deleteReply,
  editIncident,
  closeIncident,
} from '../controllers/incidentController.js';

const router = Router();

// Require authentication for all incident routes
router.use(requireAuth);
router.use(enforceTenant);
router.use(injectTenantId);

// GET /api/incidents/admin/all - Incident administration.
// Tenant admins see only their own tenant; cross-tenant listing is
// limited to platform operators (superuser). See API_CONTRACT_CONFORMANCE.md.
router.get('/admin/all', checkAppPermission('canCustomizeApplication'), getAllIncidents);

// GET /api/incidents - List incidents
router.get('/', getIncidents);

// GET /api/incidents/:id - Get incident details
router.get('/:id', getIncident);

// POST /api/incidents - Create new incident
router.post('/', createIncident);

// PATCH /api/incidents/:id - Update incident (admin only)
router.patch('/:id', checkAppPermission('canCustomizeApplication'), updateIncident);

// PATCH /api/incidents/:id/edit - Edit incident (reporter or admin)
router.patch('/:id/edit', editIncident);

// PATCH /api/incidents/:id/close - Close incident (reporter or admin)
router.patch('/:id/close', closeIncident);

// POST /api/incidents/:id/upvote - Upvote incident
router.post('/:id/upvote', upvoteIncident);

// POST /api/incidents/:id/comments - Add comment
router.post('/:id/comments', addComment);

// DELETE /api/incidents/:id/comments/:commentId - Delete comment
router.delete('/:id/comments/:commentId', deleteComment);

// POST /api/incidents/:id/comments/:commentId/replies - Add reply to comment
router.post('/:id/comments/:commentId/replies', addReply);

// DELETE /api/incidents/:id/comments/:commentId/replies/:replyId - Delete reply
router.delete('/:id/comments/:commentId/replies/:replyId', deleteReply);

export default router;
