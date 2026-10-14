import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { uploadSheet } from '../middlewares/uploadSheet.js';
import * as controller from '../controllers/bulkSheet.controller.js';

const router = Router();

router.get('/sellers/me/fabric-sheet', requireAuth('SELLER'), controller.download);
router.post('/sellers/me/fabric-sheet', requireAuth('SELLER'), uploadSheet, controller.parse);

export default router;
