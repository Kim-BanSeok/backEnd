import { signupSchema, loginSchema } from '../src/validators/auth.schema.js';
import { updateMeSchema } from '../src/validators/users.schema.js';
import { createStoreSchema, updateStoreSchema } from '../src/validators/stores.schema.js';
import { createFabricSchema, updateFabricSchema } from '../src/validators/fabrics.schema.js';
import { uploadImageSchema } from '../src/validators/images.schema.js';
import { createReservationSchema, acceptReservationSchema, rejectReservationSchema } from '../src/validators/reservations.schema.js';
import { rejectFabricSchema } from '../src/validators/admin.schema.js';
import { createInquirySchema, answerInquirySchema, updateInquirySchema } from '../src/validators/inquiries.schema.js';
import { createFavoriteSchema } from '../src/validators/favorites.schema.js';
import { answerSchema, confirmSchema, listingSchema } from '../src/validators/aiSessions.schema.js';
import { createPatternDraftSchema } from '../src/validators/patternDraft.schema.js';

export const extraField = '__unexpected_security_field';
export const sessionId = '1'.repeat(24);
export const fabricBody = () => ({
  sale_type: 'SCRAP', title: '면 원단', price: 3000,
  detail: { width_cm: 50, length_cm: 70, sheet_count: 1, thickness: 'NORMAL', color_family: 'BLUE' },
});
export const listingBody = () => ({
  material_text: '면', thickness: 'NORMAL', thickness_label: '보통', width_cm: 50, length_cm: 70, sheet_count: 1,
  images: [{ media_type: 'image/png', data: 'dGVzdA==' }],
});
const future = () => new Date(Date.now() + 86_400_000).toISOString();

// 정상 계약 입력과 실제 라우트를 함께 두어 스키마 검사와 라우트 연결을 따로 확인한다.
export const bodyCases = [
  { label: '가입', schema: signupSchema, path: '/auth/signup', role: null, input: () => ({ email: 'new@strict.test', password: 'password123', nickname: '판매자', role: 'SELLER', privacy_agreed: true, terms_agreed: true }) },
  { label: '로그인', schema: loginSchema, path: '/auth/login', role: null, input: () => ({ email: 'buyer@strict.test', password: 'password123' }) },
  { label: '내 정보 수정', schema: updateMeSchema, path: '/users/me', method: 'PATCH', input: () => ({ nickname: '바꾼 이름' }) },
  { label: '매장 등록', schema: createStoreSchema, path: '/stores', role: 'SELLER', input: () => ({ store_name: '매장', store_address: '양주', store_phone: '031-000-0000' }) },
  { label: '매장 수정', schema: updateStoreSchema, path: '/stores/me', method: 'PATCH', role: 'SELLER', input: () => ({ store_name: '새 이름' }) },
  { label: '원단 등록', schema: createFabricSchema, path: '/fabrics', role: 'SELLER', input: fabricBody },
  { label: '원단 수정', schema: updateFabricSchema, path: '/fabrics/1', method: 'PATCH', role: 'SELLER', input: () => ({ title: '새 제목', detail: { description: '설명' } }) },
  { label: '원단 사진', schema: uploadImageSchema, path: '/fabrics/1/images', role: 'SELLER', multipart: true, input: () => ({ image_type: 'FULL' }) },
  { label: '예약 요청', schema: createReservationSchema, path: '/reservations', input: () => ({ fabric_id: 1, pickup_at: future(), requested_sheet_count: 1 }) },
  { label: '예약 수락', schema: acceptReservationSchema, path: '/reservations/1/accept', role: 'SELLER', input: () => ({ pickup_at: future() }) },
  { label: '예약 거절', schema: rejectReservationSchema, path: '/reservations/1/reject', role: 'SELLER', input: () => ({ reason: '일정이 맞지 않아요' }) },
  { label: '운영팀 원단 반려', schema: rejectFabricSchema, path: '/admin/fabrics/1/reject', role: 'ADMIN', input: () => ({ reason: '사진을 확인해 주세요' }) },
  { label: '문의 작성', schema: createInquirySchema, path: '/fabrics/1/inquiries', input: () => ({ content: '소재가 궁금해요', is_private: true }) },
  { label: '문의 답변', schema: answerInquirySchema, path: '/inquiries/1/answer', role: 'SELLER', input: () => ({ answer: '면이에요' }) },
  { label: '문의 수정', schema: updateInquirySchema, path: '/inquiries/1', method: 'PATCH', input: () => ({ content: '수정한 문의' }) },
  { label: '관심 등록', schema: createFavoriteSchema, path: '/favorites', input: () => ({ target_type: 'FABRIC', fabric_id: 1 }) },
  { label: 'AI 답변', schema: answerSchema, path: `/ai-sessions/${sessionId}/answers`, role: 'SELLER', input: () => ({ answer: '면이에요' }) },
  { label: 'AI 확정', schema: confirmSchema, path: `/ai-sessions/${sessionId}/confirm`, role: 'SELLER', input: fabricBody },
  { label: 'AI 소개', schema: listingSchema, path: '/ai-sessions/listings', role: 'SELLER', input: listingBody },
  { label: 'AI 도안', schema: createPatternDraftSchema, path: '/pattern-drafts', input: () => ({ fabric_id: 1, item_name: '파우치', note: null }) },
];

export const noBodyCases = [
  { label: '로그아웃', path: '/auth/logout' },
  { label: 'AI 시작', path: '/ai-sessions', role: 'SELLER' },
  { label: 'AI 중단', path: `/ai-sessions/${sessionId}/abort`, role: 'SELLER' },
  { label: '원단 승인', path: '/admin/fabrics/1/approve', role: 'ADMIN' },
  { label: '판매자 승인', path: '/admin/sellers/1/approve', role: 'ADMIN' },
  { label: '판매자 거절', path: '/admin/sellers/1/reject', role: 'ADMIN' },
  { label: '예약 취소', path: '/reservations/1/cancel' },
  { label: '수령 완료', path: '/reservations/1/pickup', role: 'SELLER' },
  { label: '원단 삭제', path: '/fabrics/1', method: 'DELETE', role: 'SELLER' },
  { label: '사진 삭제', path: '/fabrics/1/images/1', method: 'DELETE', role: 'SELLER' },
  { label: '관심 삭제', path: '/favorites/1', method: 'DELETE' },
  { label: '문의 삭제', path: '/inquiries/1', method: 'DELETE' },
];
