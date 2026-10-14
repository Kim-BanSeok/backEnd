import sharp from 'sharp';
import { fail } from '../utils/errors.js';
import { MATERIALS, THICKNESSES, COLOR_FAMILIES } from '../utils/codes.js';
import { getProvider } from '../ai/index.js';
import * as usersDao from '../dao/users.dao.js';
import * as storesDao from '../dao/stores.dao.js';
import { withAiCall } from './security.service.js';
import { securityEvent, safeErrorType } from '../utils/securityLog.js';

const MAX_AI_ATTEMPTS = 2;
const MEDIA_TYPES = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const oneOf = (value, allowed) => (typeof value === 'string' && allowed.includes(value) ? value : null);
const textOrNull = (value, max) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
};

// 모델이 목록 밖 값을 주면 비운다. 길이와 가격은 사진으로 재지 않으므로 받지 않는다.
export function sanitizePhotoDraft(values) {
  const hasDefect = values?.has_defect;
  const has_defect = hasDefect === true || hasDefect === false ? hasDefect : null;
  return {
    title: textOrNull(values?.title, 100),
    material: oneOf(values?.material, MATERIALS),
    thickness: oneOf(values?.thickness, THICKNESSES),
    color_family: oneOf(values?.color_family, COLOR_FAMILIES),
    has_defect,
    defect_note: has_defect === true ? textOrNull(values?.defect_note, 255) : null,
  };
}

async function mediaTypeOf(buffer) {
  try {
    const { format } = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
    const mediaType = MEDIA_TYPES[format];
    if (!mediaType) throw new Error(`허용하지 않는 형식: ${format}`);
    return mediaType;
  } catch (error) {
    if (error.code) throw error;
    throw fail('IMAGE_TOO_LARGE');
  }
}

async function describeWithRetry(userId, buffer, mediaType) {
  const provider = getProvider();
  let lastError;
  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt += 1) {
    try {
      const result = await withAiCall(userId, () => provider.describeImage({ mediaType, data: buffer.toString('base64') }));
      if (!result || typeof result.values !== 'object' || result.values === null) throw new Error('AI 응답 형식이 올바르지 않아요');
      return result.values;
    } catch (error) {
      if (error.code === 'TOO_MANY_REQUESTS') throw error;
      lastError = error;
    }
  }
  securityEvent('ai.provider.failed', { operation: 'photo', error_type: safeErrorType(lastError) });
  throw fail('AI_UNAVAILABLE');
}

// 사진을 저장하지 않는다. 판매자가 고치기 전의 초안만 돌려준다.
export async function estimateFromPhoto(userId, buffer) {
  const user = await usersDao.findById(userId);
  if (!user) throw fail('UNAUTHORIZED');
  if (user.seller_approval_status !== 'APPROVED') throw fail('SELLER_NOT_APPROVED');
  if (!(await storesDao.findByUserId(userId))) throw fail('STORE_REQUIRED');

  const mediaType = await mediaTypeOf(buffer);
  return sanitizePhotoDraft(await describeWithRetry(userId, buffer, mediaType));
}
