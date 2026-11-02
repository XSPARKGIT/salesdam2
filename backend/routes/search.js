import express from 'express';
import { globalSearch, suggest, reindexObjectRoute } from '../controllers/searchController.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceTenant } from '../middleware/tenant.js';
import { checkAppPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(requireAuth, enforceTenant);
router.get('/', globalSearch);
router.get('/suggest', suggest);
router.post('/reindex/:objectApiName', checkAppPermission('canCustomizeApplication'), reindexObjectRoute);

export default router;
