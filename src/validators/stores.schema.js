import { z } from 'zod';

const storeName = z.string().trim().min(1).max(100);
const storeAddress = z.string().trim().min(1).max(255);
const storePhone = z.string().trim().min(1).max(20);
const closedDays = z.string().trim().max(100).nullable();
const pickupGuide = z.string().trim().max(5000).nullable();

export const createStoreSchema = {
  body: z.strictObject({
    store_name: storeName,
    store_address: storeAddress,
    store_phone: storePhone,
    closed_days: closedDays.optional(),
    pickup_guide: pickupGuide.optional(),
  }),
};

// 보낸 항목만 바뀐다. 하나 이상 보내야 하고, 모르는 항목(user_id 등)은 거절한다.
export const updateStoreSchema = {
  body: z
    .strictObject({
      store_name: storeName,
      store_address: storeAddress,
      store_phone: storePhone,
      closed_days: closedDays,
      pickup_guide: pickupGuide,
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { error: '수정할 항목을 하나 이상 보내 주세요' }),
};

export const storeIdSchema = {
  params: z.object({
    storeId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
};
