import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { updateMeSchema } from '../validators/users.schema.js';
import * as controller from '../controllers/users.controller.js';

const router = Router();

router.get('/users/me', requireAuth(), controller.getMe);
router.patch('/users/me', requireAuth(), validate(updateMeSchema), controller.updateMe);

export default router;
