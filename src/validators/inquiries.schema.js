import { z } from 'zod';
import { INQUIRY_STATUSES } from '../utils/codes.js';

const fabricIdParams = z.object({
  fabricId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

// 내용은 앞뒤 공백을 지우고 1~1000자. 공백만 있으면 VALIDATION_ERROR. is_private 는 true/false 만 받는다.
export const createInquirySchema = {
  params: fabricIdParams,
  body: z.object({
    content: z.string().trim().min(1).max(1000),
    is_private: z.boolean().optional(),
  }),
};

// 목록: page 는 0부터, size 는 1~50 (명세서 2.6)
export const listInquiriesSchema = {
  params: fabricIdParams,
  query: z.object({
    page: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    size: z.coerce.number().int().min(1).max(50).default(20),
  }),
};

// 받은 문의 목록: status 는 WAITING, ANSWERED 만 받고, page 는 0부터, size 는 1~50
export const listReceivedInquiriesSchema = {
  query: z.object({
    status: z.enum(INQUIRY_STATUSES).optional(),
    page: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    size: z.coerce.number().int().min(1).max(50).default(20),
  }),
};

// 답변: 앞뒤 공백을 지우고 1~1000자. 공백만 있으면 VALIDATION_ERROR. 문의 번호는 양의 정수.
export const answerInquirySchema = {
  params: z.object({
    inquiryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  body: z.object({
    answer: z.string().trim().min(1).max(1000),
  }),
};
