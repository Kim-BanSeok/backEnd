import multer from 'multer';
import { fail } from '../utils/errors.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, fieldSize: 1024, parts: 6 },
}).single('file');

// multipart/form-data 로 온 사진 1장(필드 이름 file)을 req.file 에 담고, 함께 온 텍스트 항목은 req.body 에 담는다.
// 파일 형식(jpg·png·webp)은 내용으로 확인해야 해서 services 가 한다. 여기서는 크기와 받는 모양만 본다.
export const uploadImage = (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(fail('IMAGE_TOO_LARGE'));
      const field = err.field || 'file';
      return next(fail('VALIDATION_ERROR', [{ field, message: '보낼 수 없는 항목이에요' }]));
    }
    // 깨진 multipart 등 읽을 수 없는 요청
    if (err) return next(fail('VALIDATION_ERROR', [{ field: 'body', message: '요청 형식이 올바르지 않아요' }]));

    req.body ??= {}; // multipart 가 아니면 body 가 없을 수 있다.
    if (!req.file) {
      return next(fail('VALIDATION_ERROR', [{ field: 'file', message: '이미지 파일을 보내 주세요' }]));
    }
    next();
  });
};
