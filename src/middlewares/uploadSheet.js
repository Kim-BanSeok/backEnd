import multer from 'multer';
import { fail } from '../utils/errors.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
}).single('file');

export const uploadSheet = (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(fail('VALIDATION_ERROR', [{ field: 'file', message: '엑셀 파일은 2MB 이하로 올려 주세요.' }]));
      return next(fail('VALIDATION_ERROR', [{ field: 'file', message: '엑셀 파일을 보내지 못했어요.' }]));
    }
    if (err) return next(fail('VALIDATION_ERROR', [{ field: 'file', message: '엑셀 파일을 읽지 못했어요.' }]));
    if (!req.file) return next(fail('VALIDATION_ERROR', [{ field: 'file', message: '엑셀 파일을 선택해 주세요.' }]));
    const name = req.file.originalname || '';
    if (!/\.xlsx$/i.test(name)) return next(fail('VALIDATION_ERROR', [{ field: 'file', message: 'xlsx 파일을 올려 주세요.' }]));
    next();
  });
};
