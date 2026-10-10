import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { uploadImage } from '../middlewares/uploadImage.js';
import { validate } from '../middlewares/validate.js';
import { uploadImageSchema, deleteImageSchema } from '../validators/images.schema.js';
import * as controller from '../controllers/images.controller.js';

const router = Router();

// 로그인·역할 확인 → 사진 받기(multipart) → 입력 검사 순서. 로그인하지 않은 요청의 파일은 받지 않는다.
router.post(
  '/fabrics/:fabricId/images',
  requireAuth('SELLER'),
  uploadImage,
  validate(uploadImageSchema),
  controller.upload,
);
router.delete(
  '/fabrics/:fabricId/images/:imageId',
  requireAuth('SELLER'),
  validate(deleteImageSchema),
  controller.remove,
);

export default router;
