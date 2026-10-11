import { fail } from '../utils/errors.js';
import { toKstIso } from '../utils/response.js';
import * as favoritesDao from '../dao/favorites.dao.js';
import * as fabricsDao from '../dao/fabrics.dao.js';

// 대상이 없거나 저장할 수 없는 상태면 NOT_FOUND 다. (명세서 39번 오류 코드에 FABRIC_NOT_AVAILABLE 은 없다)
async function assertSavableFabric(userId, fabricId) {
  const fabric = await fabricsDao.findById(fabricId);
  if (!fabric || fabric.status !== 'POSTED') throw fail('NOT_FOUND');
  if (await favoritesDao.findByUserAndFabric(userId, fabricId)) throw fail('FAVORITE_DUPLICATED');
}

async function assertSavablePattern(userId, patternId) {
  const pattern = await favoritesDao.findPatternById(patternId);
  if (!pattern || !pattern.is_active) throw fail('NOT_FOUND');
  if (await favoritesDao.findByUserAndPattern(userId, patternId)) throw fail('FAVORITE_DUPLICATED');
}

// 관심저장 추가 (명세서 39번). 게시 중인 원단, 사용 중인 도안만 저장할 수 있다.
export async function createFavorite(userId, { target_type, fabric_id, pattern_id }) {
  if (target_type === 'FABRIC') await assertSavableFabric(userId, fabric_id);
  else await assertSavablePattern(userId, pattern_id);

  try {
    const favorite = await favoritesDao.insert({
      user_id: userId,
      target_type,
      fabric_id: fabric_id ?? null,
      pattern_id: pattern_id ?? null,
    });
    return { favoriteId: favorite.favorite_id };
  } catch (err) {
    // 동시에 두 번 눌러도 DB 의 UNIQUE(user_id, 대상)가 마지막으로 막는다.
    if (err.name === 'SequelizeUniqueConstraintError') throw fail('FAVORITE_DUPLICATED');
    throw err;
  }
}

// 관심 목록 항목 (명세서 40번). 원단과 도안은 항목 모양이 다르다.
// 도안 항목은 명세서에 예시가 없어서 원단 항목과 같은 규칙으로 정한 임시안이다. (리더 확인 필요)
// 삭제·판매 완료된 원단도 남기고 fabric_status 와 is_deleted 로 "판매 종료"를 알린다.
export const toFavoriteItem = (favorite) => {
  const base = {
    favoriteId: favorite.favorite_id,
    target_type: favorite.target_type,
    created_at: toKstIso(favorite.created_at),
  };
  if (favorite.target_type === 'FABRIC') {
    const fabric = favorite.fabric;
    return {
      ...base,
      fabricId: fabric.fabric_id,
      title: fabric.title,
      sale_type: fabric.sale_type,
      price: fabric.price,
      thumbnail_url: fabric.images[0]?.thumbnail_url ?? null,
      fabric_status: fabric.status,
      is_deleted: fabric.deleted_at !== null,
    };
  }
  const pattern = favorite.pattern;
  return {
    ...base,
    patternId: pattern.pattern_id,
    pattern_name: pattern.pattern_name,
    category: pattern.category,
    image_url: pattern.image_url,
    is_active: pattern.is_active,
  };
};

// 내 관심 목록 (명세서 40번). 최근에 저장한 것이 먼저다.
export async function listMyFavorites(userId, { target_type, page, size }) {
  const { rows, count } = await favoritesDao.findPageByUser({
    userId,
    targetType: target_type,
    limit: size,
    offset: page * size,
  });
  return {
    content: rows.map(toFavoriteItem),
    page,
    size,
    totalElements: count,
    totalPages: Math.ceil(count / size),
  };
}

// 관심저장 삭제 (명세서 41번). 본인이 저장한 것만 지울 수 있다.
export async function deleteFavorite(userId, favoriteId) {
  const favorite = await favoritesDao.findById(favoriteId);
  if (!favorite) throw fail('NOT_FOUND');
  if (favorite.user_id !== userId) throw fail('FORBIDDEN');
  await favoritesDao.destroy(favorite);
  return null;
}
