import { Router } from 'express';
import { ok } from '../utils/response.js';
import { validate } from '../middlewares/validate.js';

const router = Router();

router.get('/health', validate({}), (req, res) => ok(res, { status: 'ok' }));

export default router;
