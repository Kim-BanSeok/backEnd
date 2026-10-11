import { z } from 'zod';
import { idParam } from './common.schema.js';

export const getRecommendationsSchema = {
  params: z.object({ fabricId: idParam }),
};
