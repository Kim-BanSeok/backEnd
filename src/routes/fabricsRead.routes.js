import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { listFabricsSchema, fabricIdSchema, listMyFabricsSchema } from '../validators/fabricsRead.schema.js';
import * as controller from '../controllers/fabricsRead.controller.js';

const router = Router();

router.get('/fabrics', optionalAuth, validate(listFabricsSchema), controller.list);
router.get('/fabrics/:fabricId', optionalAuth, validate(fabricIdSchema), controller.getById);
router.get('/sellers/me/fabrics', requireAuth('SELLER'), validate(listMyFabricsSchema), controller.listMine);

export default router;
