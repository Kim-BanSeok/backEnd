import { Op } from 'sequelize';
import db from '../models/index.js';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

const lockPool = new pg.Pool({ host: env.db.host, port: env.db.port, user: env.db.username, password: env.db.password, database: env.db.database, max: 4, connectionTimeoutMillis: 5000, allowExitOnIdle: true });
lockPool.on('error', () => console.error('AI session lock connection failed'));
export async function withAiSessionLock(sessionId, work) {
  const key = createHash('sha256').update(`fabric-ai-session:${sessionId}`).digest().readBigInt64BE().toString();
  const connection = await lockPool.connect();
  let locked = false;
  try {
    await connection.query("SET lock_timeout = '60s'");
    await connection.query('SELECT pg_advisory_lock($1::bigint)', [key]);
    locked = true;
    return await work();
  } finally {
    try { if (locked) await connection.query('SELECT pg_advisory_unlock($1::bigint)', [key]); }
    finally { connection.release(); }
  }
}

export const findRevokedToken = (hash) => db.RevokedToken.findByPk(hash);
export const revokeToken = (hash, expiresAt) => db.RevokedToken.findOrCreate({ where: { token_hash: hash }, defaults: { expires_at: expiresAt } });
export const purgeRevokedTokens = () => db.RevokedToken.destroy({ where: { expires_at: { [Op.lte]: new Date() } } });

export async function lockBucket(key, windowStart, transaction) {
  await db.AiUsageBucket.findOrCreate({ where: { bucket_key: key }, defaults: { window_start: windowStart, request_count: 0 }, transaction });
  return db.AiUsageBucket.findByPk(key, { transaction, lock: transaction.LOCK.UPDATE });
}
export const updateBucket = (bucket, values, transaction) => bucket.update(values, { transaction });
export const purgeLeases = (kind, now, transaction) => db.AiUsageLease.destroy({ where: { kind, expires_at: { [Op.lte]: now } }, transaction });
export const countLeases = (kind, now, userId, transaction) => db.AiUsageLease.count({ where: { kind, expires_at: { [Op.gt]: now }, ...(userId !== undefined && { user_id: userId }) }, transaction });
export const insertLease = (values, transaction) => db.AiUsageLease.create(values, { transaction });
export const releaseLease = (leaseId) => db.AiUsageLease.destroy({ where: { lease_id: leaseId } });
export const renewLease = (leaseId, expiresAt) => db.AiUsageLease.update({ expires_at: expiresAt }, { where: { lease_id: leaseId } });
