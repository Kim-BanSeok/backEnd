import { fail } from '../utils/errors.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import * as reservationsDao from '../dao/reservations.dao.js';
import * as recommendationsDao from '../dao/recommendations.dao.js';
import { recommend, NOTICE_PHYSICAL_CHECK, ROLL_UNIT_CM } from './recommendation.rules.js';
import { scrapStock } from './sheetStock.js';

const unavailable = (message) => ({ available: false, items: [], notices: [NOTICE_PHYSICAL_CHECK], message });

// 원단 기준 도안 추천 (명세서 24번). 로그인하지 않아도 볼 수 있다.
// 게시 중이 아니거나, 자투리가 예약 중이거나, 롤의 구매 가능 길이가 90cm 미만이면 available 이 false 이고 items 가 비어 있다.
export async function getRecommendations(fabricId) {
  const fabric = await fabricsDao.findById(fabricId);
  if (!fabric) throw fail('NOT_FOUND');

  if (fabric.status !== 'POSTED') return unavailable('게시 중인 원단만 도안을 추천해요');
  if (fabric.sale_type === 'SCRAP') {
    const detail = await fabricsDao.findDetailByFabric(fabric.fabric_id);
    const accepted = await reservationsDao.existsAcceptedByFabric(fabric.fabric_id);
    if (scrapStock(fabric, detail, accepted ? 1 : 0).available < 1) return unavailable('이미 예약 중인 원단이에요');
  }
  if (fabric.sale_type === 'ROLL' && fabric.remaining_length_cm - fabric.reserved_length_cm < ROLL_UNIT_CM) {
    return unavailable('구매할 수 있는 길이가 90cm 미만이에요');
  }

  const detail = await fabricsDao.findDetailByFabric(fabric.fabric_id);
  if (!detail) throw new Error(`원단 ${fabric.fabric_id} 의 원단상세가 없어요`); // 원단과 상세는 함께 저장되므로 없을 수 없다

  const patterns = await recommendationsDao.listActivePatternsWithParts();
  const { items, notices } = recommend(fabric, detail, patterns);
  return {
    available: true,
    items,
    notices,
    message: items.length === 0 ? '이 원단으로 만들 수 있는 도안이 아직 없어요' : null,
  };
}
