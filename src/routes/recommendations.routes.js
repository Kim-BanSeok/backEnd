import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { getRecommendationsSchema } from '../validators/recommendations.schema.js';
import * as controller from '../controllers/recommendations.controller.js';

const router = Router();

// 공개 API. 로그인하지 않아도 되고, 잘못된 토큰을 보내면 401 이다. (명세서 2.3)
router.get('/fabrics/:fabricId/recommendations', optionalAuth, validate(getRecommendationsSchema), controller.get);

export default router;
