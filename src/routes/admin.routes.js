import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import {
  listFabricsSchema,
  fabricIdSchema,
  rejectFabricSchema,
  listSellersSchema,
  userIdSchema,
} from '../validators/admin.schema.js';
import * as controller from '../controllers/admin.controller.js';

// 운영팀(ADMIN)만 쓰는 API. 아래 모든 경로에 역할 확인을 먼저 건다.
const router = Router();
router.use('/admin', requireAuth('ADMIN'));

router.get('/admin/fabrics', validate(listFabricsSchema), controller.listFabrics);
router.post('/admin/fabrics/:fabricId/approve', validate(fabricIdSchema), controller.approveFabric);
router.post('/admin/fabrics/:fabricId/reject', validate(rejectFabricSchema), controller.rejectFabric);

router.get('/admin/sellers', validate(listSellersSchema), controller.listSellers);
router.post('/admin/sellers/:userId/approve', validate(userIdSchema), controller.approveSeller);
router.post('/admin/sellers/:userId/reject', validate(userIdSchema), controller.rejectSeller);

export default router;
