import { fail } from '../utils/errors.js';
import * as storesDao from '../dao/stores.dao.js';

// 내 원단인지 확인한다. 남의 원단이면 FORBIDDEN. (없는 원단의 NOT_FOUND 는 부르는 쪽에서 먼저 처리한다)
// 사진·수정·삭제가 함께 쓴다. 트랜잭션 안에서 부를 때는 options 로 { transaction } 을 넘긴다.
export async function assertFabricOwner(userId, fabric, options = {}) {
  const store = await storesDao.findById(fabric.store_id, options);
  if (!store || store.user_id !== userId) throw fail('FORBIDDEN');
}
