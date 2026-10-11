import { fail } from '../utils/errors.js';
import { toKstIso } from '../utils/response.js';
import * as inquiriesDao from '../dao/inquiries.dao.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import * as storesDao from '../dao/stores.dao.js';

// 문의 작성 (명세서 42번). 구매자(BUYER)는 라우트에서 막고, 여기서는 게시 중인 원단인지 본다.
// 게시 중이 아니거나 삭제됐거나 없는 원단은 NOT_FOUND 다. (42번 오류 코드에 FABRIC_NOT_AVAILABLE 은 없다)
// seller_id 는 요청에 없어서 원단의 매장 주인으로 서버가 채운다.
export async function createInquiry(buyerId, fabricId, { content, is_private }) {
  const fabric = await fabricsDao.findById(fabricId);
  if (!fabric || fabric.status !== 'POSTED') throw fail('NOT_FOUND');
  const store = await storesDao.findById(fabric.store_id);

  const inquiry = await inquiriesDao.insert({
    fabric_id: fabric.fabric_id,
    buyer_id: buyerId,
    seller_id: store.user_id,
    content,
    is_private: is_private ?? false,
  });
  return { inquiryId: inquiry.inquiry_id, status: inquiry.status };
}

const PRIVATE_CONTENT = '비공개 문의입니다';

// 문의 목록 항목 (명세서 43번). 비공개 문의를 볼 수 없는 사람에게는 content 와 answer 만 가린다.
// 탈퇴한 구매자는 buyer_nickname 이 null 이다. (명세서에 없어서 개인정보를 보이지 않게 정했다)
export const toInquiryItem = (inquiry, fabric, canRead) => ({
  inquiryId: inquiry.inquiry_id,
  fabricId: fabric.fabric_id,
  fabric_title: fabric.title,
  buyer_nickname: inquiry.buyer?.nickname ?? null,
  is_private: inquiry.is_private,
  status: inquiry.status,
  content: canRead ? inquiry.content : PRIVATE_CONTENT,
  answer: canRead ? inquiry.answer : null,
  answered_at: toKstIso(inquiry.answered_at),
  created_at: toKstIso(inquiry.created_at),
});

// 원단 문의 목록 (명세서 43번). viewer 는 로그인하지 않았으면 undefined 다. 최근 문의가 먼저다.
// 원단은 11번 원단 상세와 같은 규칙으로 본다: 게시 중이 아니면 판매자 본인과 운영팀만 볼 수 있고, 나머지는 NOT_FOUND 다.
// 비공개 문의는 작성자, 그 원단의 판매자, 운영팀만 내용과 답변을 볼 수 있다.
export async function listFabricInquiries(viewer, fabricId, { page, size }) {
  const fabric = await fabricsDao.findById(fabricId);
  if (!fabric) throw fail('NOT_FOUND');
  const store = await storesDao.findById(fabric.store_id);
  const isSeller = viewer?.userId === store.user_id;
  const isAdmin = viewer?.role === 'ADMIN';
  if (fabric.status !== 'POSTED' && !isSeller && !isAdmin) throw fail('NOT_FOUND');

  const { rows, count } = await inquiriesDao.findPageByFabric({ fabricId, limit: size, offset: page * size });
  return {
    content: rows.map((inquiry) => {
      const canRead = !inquiry.is_private || isSeller || isAdmin || viewer?.userId === inquiry.buyer_id;
      return toInquiryItem(inquiry, fabric, canRead);
    }),
    page,
    size,
    totalElements: count,
    totalPages: Math.ceil(count / size),
  };
}

// 받은 문의 목록 (명세서 44번). 문의의 seller_id 가 나인 것만 보이고, 판매자는 비공개 문의도 내용을 본다. 최근 문의가 먼저다.
// 원단을 삭제했어도 문의는 남는다. (명세서에 없어서 판매자가 받은 문의를 놓치지 않게 정했다)
// 받은 문의가 없으면(매장이 없는 판매자 포함) 빈 목록이다.
export async function listReceivedInquiries(sellerId, { status, page, size }) {
  const { rows, count } = await inquiriesDao.findPageBySeller({
    sellerId,
    status,
    includeDeletedFabric: true,
    limit: size,
    offset: page * size,
  });
  return {
    content: rows.map((inquiry) => toInquiryItem(inquiry, inquiry.fabric, true)),
    page,
    size,
    totalElements: count,
    totalPages: Math.ceil(count / size),
  };
}

// 문의 답변 (명세서 45번). 문의의 seller_id 가 나인 판매자만 답변할 수 있다. (없는 문의·삭제한 문의는 NOT_FOUND, 남의 문의는 FORBIDDEN)
// 답변하면 ANSWERED 가 되고, 다시 보내면 답변과 답변 시각(answered_at)을 새로 쓴다.
// 원단이 삭제됐어도 문의는 남아 있어서 답변할 수 있다. (명세서에 없어서 막는 오류 코드가 없는 대로 정했다)
export async function answerInquiry(sellerId, inquiryId, { answer }) {
  const inquiry = await inquiriesDao.findById(inquiryId);
  if (!inquiry) throw fail('NOT_FOUND');
  if (inquiry.seller_id !== sellerId) throw fail('FORBIDDEN');

  const updated = await inquiriesDao.update(inquiry, { answer, status: 'ANSWERED', answered_at: new Date() });
  return { inquiryId: updated.inquiry_id, status: updated.status };
}
