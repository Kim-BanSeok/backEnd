import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createFabricSchema } from '../validators/fabrics.schema.js';
import * as controller from '../controllers/fabrics.controller.js';

// 원단 등록·수정·삭제 (리더 담당). 원단 조회(목록·상세·내 원단)는 fabricsRead.* 파일에 따로 있다.
const router = Router();

router.post('/fabrics', requireAuth('SELLER'), validate(createFabricSchema), controller.create);

export default router;
