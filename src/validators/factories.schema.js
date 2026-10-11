import { z } from 'zod';
import { FACTORY_CATEGORY_CODES } from '../factories/categories.js';

export const listFactoriesSchema = {
  query: z.object({
    category: z.enum(FACTORY_CATEGORY_CODES).optional(),
    page: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    size: z.coerce.number().int().min(1).max(50).default(20),
  }),
};
