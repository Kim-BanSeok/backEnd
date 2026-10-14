import { fail } from '../utils/errors.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import { getProvider } from '../ai/index.js';
import { withAiCall } from './security.service.js';
import { securityEvent, safeErrorType } from '../utils/securityLog.js';

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const round1 = (value) => Math.round(Number(value) * 10) / 10;
const outlineOf = (part, name) => {
  const given = text(part?.outline, 10);
  if (['sole', 'upper', 'rect'].includes(given)) return given;
  if (/바닥|결창|솔|sole/i.test(name)) return 'sole';
  if (/갑피|앞판|발목|upper/i.test(name)) return 'upper';
  return 'rect';
};

// AI가 준 조각 목록만 다듬는다. 도안 테이블에 저장하지 않고, 적합 판정에도 넣지 않는다.
export async function createPatternDraft(userId, input) {
  const fabric = await fabricsDao.findById(input.fabric_id);
  if (!fabric || fabric.status !== 'POSTED') throw fail('NOT_FOUND');
  const detail = await fabricsDao.findDetailByFabric(fabric.fabric_id);
  if (!detail) throw fail('NOT_FOUND');

  const limitWidth = detail.width_cm;
  const limitHeight = fabric.sale_type === 'ROLL' ? fabric.remaining_length_cm : detail.length_cm;
  let raw;
  try {
    raw = await withAiCall(userId, () => getProvider().draftPattern({
      itemName: input.item_name,
      note: input.note,
      fabric: {
        sale_type: fabric.sale_type,
        width_cm: limitWidth,
        length_cm: fabric.sale_type === 'SCRAP' ? limitHeight : null,
        remaining_length_cm: fabric.sale_type === 'ROLL' ? limitHeight : null,
      },
    }));
  } catch (error) {
    if (error.code === 'TOO_MANY_REQUESTS') throw error;
    securityEvent('ai.provider.failed', { operation: 'pattern', error_type: safeErrorType(error) });
    throw fail('AI_UNAVAILABLE');
  }

  const parts = Array.isArray(raw?.parts) ? raw.parts : [];
  const kept = [];
  for (const part of parts) {
    if (kept.length >= 6) break;
    const width = round1(part?.width_cm);
    const height = round1(part?.height_cm);
    const quantity = Number(part?.quantity);
    const name = text(part?.part_name, 40);
    if (!name || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isInteger(quantity)) continue;
    if (width < 1 || height < 1 || quantity < 1 || quantity > 20) continue;
    if (width > limitWidth + 0.05 || height > limitHeight + 0.05) continue;
    kept.push({
      part_name: name,
      width_cm: width,
      height_cm: height,
      quantity,
      grain: text(part?.grain, 20) || '폭 방향',
      outline: outlineOf(part, name),
      note: text(part?.note, 40),
    });
  }
  if (!kept.length) {
    throw fail('VALIDATION_ERROR', [{ field: 'item_name', message: '한 장 안에 들어가는 초안을 만들지 못했어요. 더 작은 물건을 적어 주세요.' }]);
  }

  const notions = (Array.isArray(raw?.notions) ? raw.notions : []).slice(0, 8).map((item) => ({
    name: text(item?.name, 40) || '부자재',
    note: text(item?.note, 120),
  })).filter((item) => item.note);

  const steps = (Array.isArray(raw?.steps) ? raw.steps : []).slice(0, 6).map((step) => text(step, 40)).filter(Boolean);
  return {
    draft: true,
    saved: false,
    title: text(raw?.title, 80) || `${input.item_name} 재단 도안`,
    item_name: input.item_name,
    seam_allowance_cm: 1,
    parts: kept,
    notions,
    steps,
    notice: '초안입니다. 추천 적합 판정이 아니고 저장되지 않습니다. 인쇄는 용지에 맞추지 말고 실제 크기로 하세요. 5cm 칸으로 배율을 확인합니다.',
  };
}
