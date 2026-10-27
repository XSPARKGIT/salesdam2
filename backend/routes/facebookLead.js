import express from 'express';
import { handleLeadgen } from '../controllers/facebookLeadController.js';

const router = express.Router();
router.post('/leadgen', handleLeadgen);
export default router;