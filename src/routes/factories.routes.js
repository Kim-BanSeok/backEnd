import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { listFactoriesSchema } from '../validators/factories.schema.js';
import * as controller from '../controllers/factories.controller.js';

const router = Router();

router.get('/factories', optionalAuth, validate(listFactoriesSchema), controller.list);

export default router;
