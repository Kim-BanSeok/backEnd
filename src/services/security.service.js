import { createHash, randomUUID } from 'node:crypto';
import sequelize from '../db/connection.js';
import { env } from '../config/env.js';
import { fail } from '../utils/errors.js';
import * as dao from '../dao/security.dao.js';
import { setSecurityLimitScope } from '../utils/securityLog.js';

export const tokenFingerprint = token => createHash('sha256').update(token).digest('hex');
export const isTokenRevoked = async token => Boolean(await dao.findRevokedToken(tokenFingerprint(token)));
export async function logout(token, expiresAt) {
  await dao.revokeToken(tokenFingerprint(token), new Date(expiresAt * 1000));
  await dao.purgeRevokedTokens();
  return null;
}

// Global bucket row serializes admissions across all server processes. Provider calls run after commit.
async function reserve(userId, kind) {
  const policy = kind === 'CALL' ? env.ai.callLimits : env.ai.sessionLimits;
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
  return sequelize.transaction(async transaction => {
    const global = await dao.lockBucket(`${kind}:global`, windowStart, transaction);
    const user = await dao.lockBucket(`${kind}:user:${userId}`, windowStart, transaction);
    for (const bucket of [global, user]) {
      if (bucket.window_start.getTime() !== windowStart.getTime()) await dao.updateBucket(bucket, { window_start: windowStart, request_count: 0 }, transaction);
    }
    await dao.purgeLeases(kind, now, transaction);
    const totalActive = await dao.countLeases(kind, now, undefined, transaction);
    const userActive = await dao.countLeases(kind, now, userId, transaction);
    if (global.request_count >= policy.globalHourly || user.request_count >= policy.userHourly || totalActive >= policy.globalConcurrent || userActive >= policy.userConcurrent) {
      setSecurityLimitScope(kind === 'CALL' ? 'ai_call' : 'ai_session');
      throw fail('TOO_MANY_REQUESTS');
    }
    await dao.updateBucket(global, { request_count: global.request_count + 1 }, transaction);
    await dao.updateBucket(user, { request_count: user.request_count + 1 }, transaction);
    const leaseId = randomUUID();
    const ttl = kind === 'CALL' ? env.ai.timeoutMs + 5000 : 24 * 3600000;
    await dao.insertLease({ lease_id: leaseId, kind, user_id: userId, expires_at: new Date(now.getTime() + ttl) }, transaction);
    return leaseId;
  });
}
export const reserveSession = userId => reserve(userId, 'SESSION');
export const releaseSession = leaseId => leaseId ? dao.releaseLease(leaseId) : Promise.resolve();
export const renewSession = leaseId => leaseId ? dao.renewLease(leaseId, new Date(Date.now() + 24 * 3600000)) : Promise.resolve();
export async function withAiCall(userId, work) {
  const leaseId = await reserve(userId, 'CALL');
  try { return await work(); }
  finally { await dao.releaseLease(leaseId); }
}
