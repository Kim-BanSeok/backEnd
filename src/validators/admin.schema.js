import { z } from 'zod';
import { FABRIC_STATUSES, SELLER_APPROVAL_STATUSES } from '../utils/codes.js';
import { pageQuery, idParam } from './common.schema.js';

// 33. 게시 대기 원단 목록: status 기본값 PENDING
export const listFabricsSchema = {
  query: z.object({
    status: z.enum(FABRIC_STATUSES).default('PENDING'),
    ...pageQuery,
  }),
};

// 34. 게시 승인
export const fabricIdSchema = {
  params: z.object({ fabricId: idParam }),
};

// 35. 게시 반려: 사유 필수 (공백만 있으면 안 됨)
export const rejectFabricSchema = {
  params: z.object({ fabricId: idParam }),
  body: z.strictObject({ reason: z.string().trim().min(1).max(255) }),
};

// 36. 판매자 목록: status 기본값 PENDING
export const listSellersSchema = {
  query: z.object({
    status: z.enum(SELLER_APPROVAL_STATUSES).default('PENDING'),
    ...pageQuery,
  }),
};

// 37, 38. 판매자 승인·거절: 요청 본문은 없다.
export const userIdSchema = {
  params: z.object({ userId: idParam }),
};
