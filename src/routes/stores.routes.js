import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createStoreSchema, updateStoreSchema, storeIdSchema } from '../validators/stores.schema.js';
import * as controller from '../controllers/stores.controller.js';

const router = Router();

router.post('/stores', requireAuth('SELLER'), validate(createStoreSchema), controller.create);
// /stores/me 는 /stores/:storeId 보다 먼저 와야 한다. (아니면 "me" 가 storeId 로 읽힌다)
router.get('/stores/me', requireAuth('SELLER'), controller.getMine);
router.patch('/stores/me', requireAuth('SELLER'), validate(updateStoreSchema), controller.updateMine);
router.get('/stores/:storeId', optionalAuth, validate(storeIdSchema), controller.getById);

export default router;
