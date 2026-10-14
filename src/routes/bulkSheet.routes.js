import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { uploadSheet } from '../middlewares/uploadSheet.js';
import { validate } from '../middlewares/validate.js';
import * as controller from '../controllers/bulkSheet.controller.js';

const router = Router();

router.get('/sellers/me/fabric-sheet', requireAuth('SELLER'), validate({}), controller.download);
router.post('/sellers/me/fabric-sheet', requireAuth('SELLER'), uploadSheet, validate({}), controller.parse);

export default router;
