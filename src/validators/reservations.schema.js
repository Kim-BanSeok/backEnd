import { z } from 'zod';
import { RESERVATION_STATUSES } from '../utils/codes.js';
import { pageQuery, idParam } from './common.schema.js';

const INT_MAX = 2147483647; // PostgreSQL INTEGER 의 최댓값

// 희망 픽업 일시: ISO 8601 이고 시간대는 +09:00 같은 오프셋이나 Z(UTC) 모두 받는다. 지금 이후여야 한다. (명세서 2.5, 25번)
const futureDateTime = z
  .iso.datetime({ offset: true, error: 'ISO 8601 형식의 날짜와 시간이어야 해요 (예: 2026-10-14T15:00:00+09:00)' })
  .transform((value) => new Date(value))
  .refine((date) => date.getTime() > Date.now(), { error: '지금 이후의 시각이어야 해요' });

// 25. 예약 요청
// 판매 형태에 따라 requested_length_cm 가 필수인지는 원단을 읽어야 알 수 있어서 services 가 검사한다.
export const createReservationSchema = {
  body: z.object({
    fabric_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    pickup_at: futureDateTime,
    memo: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => v || null),
    requested_length_cm: z.number().int().min(1).max(INT_MAX).nullish().transform((v) => v ?? null),
    requested_sheet_count: z.number().int().min(1).max(9999).nullish().transform((v) => v ?? null),
    pattern_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullish().transform((v) => v ?? null),
  }),
};

// 26. 내 예약 목록 (구매자)
export const listMyReservationsSchema = {
  query: z.object({
    status: z.enum(RESERVATION_STATUSES).optional(),
    ...pageQuery,
  }),
};

// 27. 받은 예약 목록 (판매자)
export const listReceivedReservationsSchema = {
  query: z.object({
    status: z.enum(RESERVATION_STATUSES).optional(),
    fabric_id: idParam.optional(),
    ...pageQuery,
  }),
};

// 28, 31, 32. 예약 번호만 받는다. (요청 본문은 없다)
export const reservationIdSchema = {
  params: z.object({ reservationId: idParam }),
};

// 29. 예약 수락: 본문은 없어도 되고, pickup_at 을 보내면 픽업 일시를 조정한다.
// 본문을 아예 안 보내면 req.body 가 없으므로 빈 객체로 본다.
export const acceptReservationSchema = {
  params: z.object({ reservationId: idParam }),
  body: z.preprocess((value) => value ?? {}, z.object({ pickup_at: futureDateTime.optional() })),
};

// 30. 예약 거절: 사유 필수 (공백만 있으면 안 됨)
export const rejectReservationSchema = {
  params: z.object({ reservationId: idParam }),
  body: z.object({ reason: z.string().trim().min(1).max(255) }),
};
