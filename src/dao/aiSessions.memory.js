import { randomBytes } from 'node:crypto';
import { withKeyLock } from '../utils/keyedMutex.js';
import { isExpiredSession, needsHistoryRedaction, redactConfirmedHistory } from '../ai/sessionRetention.js';
export { SESSION_TTL_MS } from '../ai/sessionRetention.js';

// 명시한 개발 실험·테스트용 저장소. 운영에서는 DB 저장소만 허용한다.

export function createMemoryAiSessionStore({ now = () => Date.now() } = {}) {
  const sessions = new Map();

  const maintain = id => {
    const session = sessions.get(id);
    if (!session) return { deleted: 0, redacted: 0 };
    if (isExpiredSession(session, now())) { sessions.delete(id); return { deleted: 1, redacted: 0 }; }
    if (needsHistoryRedaction(session, now())) {
      sessions.set(id, structuredClone(redactConfirmedHistory(session, now())));
      return { deleted: 0, redacted: 1 };
    }
    return { deleted: 0, redacted: 0 };
  };

  return {
    // 읽고 쓸 때는 복사본을 주고받아서, 저장된 세션이 밖에서 바뀌지 않는다.
    async insert(session) {
      const id = randomBytes(12).toString('hex'); // MongoDB ObjectId 와 같은 24자 16진수
      sessions.set(id, structuredClone({ ...session, _id: id }));
      return structuredClone(sessions.get(id));
    },
    async findById(id) {
      maintain(id);
      const found = sessions.get(id);
      return found ? structuredClone(found) : null;
    },
    async save(session) {
      if (!sessions.has(session._id)) return null; // 그 사이 정리되었으면 저장하지 않는다
      sessions.set(session._id, structuredClone(needsHistoryRedaction(session, now()) ? redactConfirmedHistory(session, now()) : session));
      return structuredClone(sessions.get(session._id));
    },
    async cleanup({ limit = 100 } = {}) {
      const result = { deleted: 0, redacted: 0, skipped: 0 };
      const ids = [...sessions].filter(([, session]) => isExpiredSession(session, now()) || needsHistoryRedaction(session, now())).slice(0, limit).map(([id]) => id);
      for (const id of ids) {
        const changed = await withKeyLock(`ai-session:${id}`, () => maintain(id));
        result.deleted += changed.deleted;
        result.redacted += changed.redacted;
      }
      return result;
    },
    async clear() {
      sessions.clear();
    },
  };
}
