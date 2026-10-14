import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createPatternDraftSchema } from '../validators/patternDraft.schema.js';
import * as controller from '../controllers/patternDraft.controller.js';

const router = Router();

router.post('/pattern-drafts', requireAuth('BUYER'), validate(createPatternDraftSchema), controller.create);

export default router;
