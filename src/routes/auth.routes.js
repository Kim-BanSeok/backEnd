import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authLimiter } from '../middlewares/rateLimiters.js';
import { signupSchema, loginSchema } from '../validators/auth.schema.js';
import * as controller from '../controllers/auth.controller.js';

const router = Router();

router.post('/auth/signup', authLimiter, validate(signupSchema), controller.signup);
router.post('/auth/login', authLimiter, validate(loginSchema), controller.login);

export default router;
