import { fail } from '../utils/errors.js';
import * as storesDao from '../dao/stores.dao.js';

// 매장 응답 (명세서 5~8번). user_id 와 날짜는 넣지 않는다.
export const toStoreResponse = (store) => ({
  storeId: store.store_id,
  store_name: store.store_name,
  store_address: store.store_address,
  store_phone: store.store_phone,
  closed_days: store.closed_days,
  pickup_guide: store.pickup_guide,
});

export async function createStore(userId, input) {
  if (await storesDao.findByUserId(userId)) throw fail('STORE_ALREADY_EXISTS');

  try {
    const store = await storesDao.insert({
      user_id: userId,
      store_name: input.store_name,
      store_address: input.store_address,
      store_phone: input.store_phone,
      closed_days: input.closed_days ?? null,
      pickup_guide: input.pickup_guide ?? null,
    });
    return { storeId: store.store_id };
  } catch (err) {
    // 동시에 두 번 눌러도 DB 의 UNIQUE(user_id)가 마지막으로 막는다.
    if (err.name === 'SequelizeUniqueConstraintError') throw fail('STORE_ALREADY_EXISTS');
    throw err;
  }
}

export async function getMyStore(userId) {
  const store = await storesDao.findByUserId(userId);
  if (!store) throw fail('NOT_FOUND');
  return toStoreResponse(store);
}

export async function updateMyStore(userId, values) {
  const store = await storesDao.findByUserId(userId);
  if (!store) throw fail('NOT_FOUND');
  await storesDao.update(store, values);
  return toStoreResponse(store);
}

export async function getStore(storeId) {
  const store = await storesDao.findById(storeId);
  if (!store) throw fail('NOT_FOUND');
  return toStoreResponse(store);
}
