import { randomBytes } from 'node:crypto';
import { Op } from 'sequelize';
import db from '../models/index.js';
import { env } from '../config/env.js';
import { SESSION_TTL_MS } from './aiSessions.memory.js';

const revive = payload => {
  const session = structuredClone(payload);
  for (const name of ['started_at', 'created_at', 'last_updated_at']) if (session[name]) session[name] = new Date(session[name]);
  for (const message of session.messages ?? []) if (message.created_at) message.created_at = new Date(message.created_at);
  return session;
};
const columns = session => ({ seller_id: session.seller_id, session_status: session.session_status, last_updated_at: session.last_updated_at, payload: session });
export function createDatabaseAiSessionStore() {
  const purge = () => db.AiSession.destroy({ where: { session_status: { [Op.ne]: 'CONFIRMED' }, last_updated_at: { [Op.lt]: new Date(Date.now() - SESSION_TTL_MS) } } });
  return {
    async insert(session) {
      await purge();
      const saved = { ...session, _id: randomBytes(12).toString('hex') };
      await db.AiSession.create({ session_id: saved._id, ...columns(saved) });
      return revive(saved);
    },
    async findById(id) {
      await purge();
      const found = await db.AiSession.findByPk(id);
      return found ? revive(found.payload) : null;
    },
    async save(session) {
      const [count] = await db.AiSession.update(columns(session), { where: { session_id: session._id } });
      return count ? revive(session) : null;
    },
    async clear() {
      if (!env.isTest) throw new Error('AI session clear is test-only');
      await db.AiSession.destroy({ where: {} });
    },
  };
}
