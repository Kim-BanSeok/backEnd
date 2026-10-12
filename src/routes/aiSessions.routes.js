import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { uploadImage } from '../middlewares/uploadImage.js';
import { validate } from '../middlewares/validate.js';
import { sessionIdSchema, answerSchema, confirmSchema } from '../validators/aiSessions.schema.js';
import * as controller from '../controllers/aiSessions.controller.js';

// AI 보조 등록은 판매자만 쓴다. 남의 세션은 services 가 FORBIDDEN 으로 거절한다.
const router = Router();
router.use('/ai-sessions', requireAuth('SELLER'));

router.post('/ai-sessions', controller.start);
router.get('/ai-sessions/:sessionId', validate(sessionIdSchema), controller.getById);
router.post('/ai-sessions/:sessionId/answers', validate(answerSchema), controller.answer);
router.post('/ai-sessions/:sessionId/confirm', validate(confirmSchema), controller.confirm);
router.post('/ai-sessions/:sessionId/abort', validate(sessionIdSchema), controller.abort);
router.post('/ai/fabric-photo', requireAuth('SELLER'), uploadImage, controller.estimatePhoto);

export default router;
