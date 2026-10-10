import { fail } from '../utils/errors.js';
import { toKstIso } from '../utils/response.js';
import * as usersDao from '../dao/users.dao.js';
import * as storesDao from '../dao/stores.dao.js';

// 내 정보 응답 (명세서 3·4번). 식별자는 camelCase, 나머지는 ERD 이름 그대로 snake_case.
// password_hash 와 deleted_at 은 넣지 않는다. hasStore 는 계산 값이다.
export const toMeResponse = (user, hasStore) => ({
  userId: user.user_id,
  email: user.email,
  nickname: user.nickname,
  role: user.role,
  phone_number: user.phone_number,
  seller_approval_status: user.seller_approval_status,
  hasStore,
  created_at: toKstIso(user.created_at),
});

const hasStore = async (userId) => (await storesDao.findByUserId(userId)) !== null;

export async function getMe(userId) {
  const user = await usersDao.findById(userId);
  if (!user) throw fail('NOT_FOUND');
  return toMeResponse(user, await hasStore(userId));
}

export async function updateMe(userId, values) {
  const user = await usersDao.findById(userId);
  if (!user) throw fail('NOT_FOUND');
  await usersDao.update(user, values);
  return toMeResponse(user, await hasStore(userId));
}
