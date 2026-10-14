import { z } from 'zod';
import { IMAGE_TYPES } from '../utils/codes.js';

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const uploadImageSchema = {
  params: z.object({ fabricId: id }),
  body: z.strictObject({
    // multipart 로 온 빈 칸('')은 보내지 않은 것으로 본다.
    image_type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(IMAGE_TYPES).optional()),
  }),
};

export const deleteImageSchema = {
  params: z.object({ fabricId: id, imageId: id }),
};
