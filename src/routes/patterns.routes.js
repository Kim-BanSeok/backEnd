import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { listPatternsSchema, patternIdSchema } from '../validators/patterns.schema.js';
import * as controller from '../controllers/patterns.controller.js';

const router = Router();

router.get('/patterns', optionalAuth, validate(listPatternsSchema), controller.list);
router.get('/patterns/:patternId', optionalAuth, validate(patternIdSchema), controller.getById);

export default router;
