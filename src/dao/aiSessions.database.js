import { randomBytes } from 'node:crypto';
import { Op } from 'sequelize';
import db from '../models/index.js';
import { env } from '../config/env.js';
import { SESSION_TTL_MS, CONFIRMED_HISTORY_TTL_MS, isExpiredSession, needsHistoryRedaction, redactConfirmedHistory } from '../ai/sessionRetention.js';
import { tryWithAiSessionLock } from './security.dao.js';

const revive = payload => {
  const session = structuredClone(payload);
  for (const name of ['started_at', 'created_at', 'last_updated_at']) if (session[name]) session[name] = new Date(session[name]);
  for (const message of session.messages ?? []) if (message.created_at) message.created_at = new Date(message.created_at);
  return session;
};
const columns = session => ({ seller_id: session.seller_id, session_status: session.session_status, last_updated_at: session.last_updated_at, payload: session });
export function createDatabaseAiSessionStore({ now = () => Date.now() } = {}) {
  async function maintainRow(row, transaction) {
    if (!row) return { session: null, deleted: 0, redacted: 0 };
    const time = now();
    const saved = { ...row.payload, _id: row.session_id, seller_id: row.seller_id, last_updated_at: row.last_updated_at, session_status: row.session_status };
    if (isExpiredSession(saved, time)) {
      const leaseId = saved.securityLeaseId;
      if (typeof leaseId === 'string') {
        await db.AiUsageLease.destroy({ where: { lease_id: leaseId, kind: 'SESSION', user_id: row.seller_id }, transaction });
      }
      await row.destroy({ transaction });
      return { session: null, deleted: 1, redacted: 0 };
    }
    let clean = saved, changed = false;
    if (['CONFIRMED', 'ABORTED'].includes(saved.session_status) && typeof saved.securityLeaseId === 'string') {
      await db.AiUsageLease.destroy({ where: { lease_id: saved.securityLeaseId, kind: 'SESSION', user_id: row.seller_id }, transaction });
      clean = { ...saved, securityLeaseId: null };
      changed = true;
    }
    const redacted = needsHistoryRedaction(clean, time);
    if (redacted) clean = redactConfirmedHistory(clean, time);
    if (changed || redacted) await row.update({ payload: clean }, { transaction });
    return { session: revive(clean), deleted: 0, redacted: Number(redacted) };
  }
  return {
    async insert(session) {
      const saved = { ...session, _id: randomBytes(12).toString('hex') };
      await db.AiSession.create({ session_id: saved._id, ...columns(saved) });
      return revive(saved);
    },
    async findById(id) {
      return db.sequelize.transaction(async transaction => {
        const found = await db.AiSession.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        return (await maintainRow(found, transaction)).session;
      });
    },
    async save(session) {
      const saved = needsHistoryRedaction(session, now()) ? redactConfirmedHistory(session, now()) : session;
      const [count] = await db.AiSession.update(columns(saved), { where: { session_id: session._id } });
      return count ? revive(saved) : null;
    },
    async cleanup({ limit = 100 } = {}) {
      const time = now();
      const candidates = await db.AiSession.findAll({
        attributes: ['session_id'],
        where: { [Op.or]: [
          { session_status: { [Op.in]: ['IN_PROGRESS', 'ABORTED'] }, last_updated_at: { [Op.lte]: new Date(time - SESSION_TTL_MS) } },
          { session_status: 'CONFIRMED', last_updated_at: { [Op.lte]: new Date(time - CONFIRMED_HISTORY_TTL_MS) }, 'payload.history_redacted_at': { [Op.is]: null } },
          { session_status: { [Op.in]: ['CONFIRMED', 'ABORTED'] }, 'payload.securityLeaseId': { [Op.ne]: null } },
        ] },
        order: [['last_updated_at', 'ASC'], ['session_id', 'ASC']], limit,
      });
      const result = { deleted: 0, redacted: 0, skipped: 0 };
      for (const { session_id: id } of candidates) {
        const locked = await tryWithAiSessionLock(id, () => db.sequelize.transaction(async transaction => {
          const row = await db.AiSession.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE, skipLocked: true });
          return maintainRow(row, transaction);
        }));
        if (!locked.acquired) result.skipped++;
        else {
          result.deleted += locked.value.deleted;
          result.redacted += locked.value.redacted;
        }
      }
      return result;
    },
    async clear() {
      if (!env.isTest) throw new Error('AI session clear is test-only');
      await db.AiSession.destroy({ where: {} });
    },
  };
}
