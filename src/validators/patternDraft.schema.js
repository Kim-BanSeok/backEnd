import { z } from 'zod';

export const createPatternDraftSchema = {
  body: z.strictObject({
    fabric_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    item_name: z.string().trim().min(1).max(40),
    note: z.string().trim().max(200).nullish().transform((value) => value || null),
  }),
};
