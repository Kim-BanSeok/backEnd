import sequelize from '../db/connection.js';
import { fail } from '../utils/errors.js';
import * as usersDao from '../dao/users.dao.js';
import * as storesDao from '../dao/stores.dao.js';
import * as fabricsDao from '../dao/fabrics.dao.js';
import { assertFabricRules } from './fabricRules.js';

export async function createFabric(userId, input) {
  // 승인을 먼저 확인하고, 그다음 매장을 확인한다. (명세서 9번)
  const user = await usersDao.findById(userId);
  if (!user) throw fail('UNAUTHORIZED');
  if (user.seller_approval_status !== 'APPROVED') throw fail('SELLER_NOT_APPROVED');

  const store = await storesDao.findByUserId(userId);
  if (!store) throw fail('STORE_REQUIRED');

  assertFabricRules(input);

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
