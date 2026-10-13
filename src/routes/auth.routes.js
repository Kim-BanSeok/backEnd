import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authLimiter } from '../middlewares/rateLimiters.js';
import { requireAuth } from '../middlewares/auth.js';
import { signupSchema, loginSchema } from '../validators/auth.schema.js';
import * as controller from '../controllers/auth.controller.js';

const router = Router();

router.post('/auth/signup', authLimiter, validate(signupSchema), controller.signup);
router.post('/auth/login', authLimiter, validate(loginSchema), controller.login);
router.post('/auth/logout', requireAuth(), controller.logout);

export default router;
