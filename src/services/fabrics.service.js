import sequelize from '../db/connection.js';
import { fail } from '../utils/errors.js';
import * as usersDao from '../dao/users.dao.js';
import * as storesDao from '../dao/stores.dao.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import { assertFabricRules } from './fabricRules.js';
import { assertFabricOwner } from './fabricAccess.js';
import * as reservationsDao from '../dao/reservations.dao.js';

export async function createFabric(userId, input) {
  // 승인을 먼저 확인하고, 그다음 매장을 확인한다. (명세서 9번)
  const user = await usersDao.findById(userId);
  if (!user) throw fail('UNAUTHORIZED');
  if (user.seller_approval_status !== 'APPROVED') throw fail('SELLER_NOT_APPROVED');

  const store = await storesDao.findByUserId(userId);
  if (!store) throw fail('STORE_REQUIRED');

  assertFabricRules(input);
  if (input.sale_type === 'SCRAP' && (!Number.isInteger(input.detail.sheet_count) || input.detail.sheet_count < 1)) {
    throw fail('VALIDATION_ERROR', [{ field: 'detail.sheet_count', message: '판매 장수는 1장 이상인 정수로 입력해 주세요' }]);
  }

  // 원단정보와 원단상세는 한 번에 저장한다. 하나라도 실패하면 둘 다 취소된다.
  const fabric = await sequelize.transaction(async (transaction) => {
    const created = await fabricsDao.insertFabric(
      {
        store_id: store.store_id,
        title: input.title,
        sale_type: input.sale_type,
        price: input.price,
        remaining_length_cm: input.remaining_length_cm,
        // status 는 기본값 PENDING (운영팀이 승인해야 구매자에게 보임), reserved_length_cm 은 0
      },
      { transaction },
    );
    await fabricsDao.insertDetail({ fabric_id: created.fabric_id, ...input.detail }, { transaction });
    return created;
  });

  return { fabricId: fabric.fabric_id, status: fabric.status };
}

// ---- 수정 (12번)

const DETAIL_FIELDS = [
  'width_cm', 'length_cm', 'material', 'thickness', 'color_family', 'color_detail',
  'has_defect', 'defect_note', 'blend_ratio', 'weave', 'grain_direction', 'description', 'sheet_count',
];
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));
const definedOnly = (object = {}) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

// 보낸 항목만 바꾼다. 지금 값에 보낸 값을 덮어쓴 "바뀐 뒤의 모습"으로 등록 규칙을 다시 검사한다.
// 원단 행을 잠근 채로 읽고 바꿔서, 같은 원단에 동시에 수정·예약 수락이 와도 확보 길이를 잘못 보지 않는다.
export async function updateFabric(userId, fabricId, input) {
  return sequelize.transaction(async (transaction) => {
    const fabric = await fabricsDao.lockById(fabricId, { transaction });
    if (!fabric) throw fail('NOT_FOUND');
    await assertFabricOwner(userId, fabric, { transaction });
    if (fabric.status === 'SOLD_OUT') throw fail('INVALID_STATUS'); // 판매 완료는 수정할 수 없다

    if (input.sale_type !== undefined && input.sale_type !== fabric.sale_type) {
      throw fail('VALIDATION_ERROR', [{ field: 'sale_type', message: '판매 형태는 바꿀 수 없어요' }]);
    }

    const detail = await fabricsDao.findDetailByFabric(fabricId, { transaction });
    if (!detail) throw new Error(`원단 ${fabricId} 의 원단상세가 없어요`); // 원단과 상세는 함께 저장되므로 없을 수 없다

    const fabricValues = definedOnly(pick(input, ['title', 'price', 'remaining_length_cm']));
    const detailValues = definedOnly(input.detail);
    const merged = {
      sale_type: fabric.sale_type,
      remaining_length_cm: fabricValues.remaining_length_cm !== undefined ? fabricValues.remaining_length_cm : fabric.remaining_length_cm,
      detail: { ...pick(detail, DETAIL_FIELDS), ...detailValues },
    };
    assertFabricRules(merged);

    // 롤의 남은 길이를 이미 수락된 예약이 확보한 길이보다 작게 줄일 수 없다.
    if (merged.sale_type === 'ROLL' && merged.remaining_length_cm < fabric.reserved_length_cm) {
      throw fail('INSUFFICIENT_LENGTH');
    }

    // 반려된 원단을 고치면 다시 게시 대기가 되고 반려 사유가 지워진다. 게시 중이면 상태가 그대로이고 바로 반영된다.
    if (fabric.status === 'REJECTED') Object.assign(fabricValues, { status: 'PENDING', reject_reason: null });

    if (Object.keys(fabricValues).length > 0) await fabricsDao.update(fabric, fabricValues, { transaction });
    if (Object.keys(detailValues).length > 0) await fabricsDao.updateDetail(detail, detailValues, { transaction });
    // 상세만 바뀌어도 원단의 수정 시각을 갱신한다. (원단 값이 바뀌었으면 이미 갱신되어 있다)
    if (Object.keys(fabricValues).length === 0) await fabricsDao.touch(fabric, { transaction });

    return { fabricId: fabric.fabric_id, status: fabric.status };
  });
}

// ---- 삭제 (13번)

// 실제로 지우지 않고 삭제 표시(deleted_at)만 한다. 모든 상태에서 삭제할 수 있지만 요청됨·수락됨 예약이 있으면 안 된다.
export async function deleteFabric(userId, fabricId) {
  await sequelize.transaction(async (transaction) => {
    const fabric = await fabricsDao.lockById(fabricId, { transaction });
    if (!fabric) throw fail('NOT_FOUND');
    await assertFabricOwner(userId, fabric, { transaction });
    if ((await reservationsDao.countActiveByFabric(fabricId, { transaction })) > 0) {
      throw fail('FABRIC_HAS_ACTIVE_RESERVATION');
    }
    await fabricsDao.destroy(fabric, { transaction });
  });
  return null;
}
