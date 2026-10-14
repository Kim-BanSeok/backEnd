import { z } from 'zod';

// 여러 API 가 함께 쓰는 검사. (명세서 2.6 "페이지 나누기": page 는 0부터 기본 0, size 는 기본 20 최대 50)
export const pageQuery = {
  page: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  size: z.coerce.number().int().min(1).max(50).default(20),
};

// 주소에 들어오는 번호 (양의 정수)
export const idParam = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// 본문을 받지 않는 API는 생략 또는 빈 객체만 허용한다. 추가 JSON·multipart 텍스트 필드는 거절한다.
export const emptyBodySchema = z.strictObject({}).default({});
