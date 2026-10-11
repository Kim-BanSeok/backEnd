import { randomBytes } from 'node:crypto';

// AI 등록 세션을 서버 메모리에 저장한다. (서버를 다시 켜면 사라진다. 이후 MongoDB 저장소로 바꿀 때 같은 모양을 지킨다.)
// 방치된 세션(IN_PROGRESS, ABORTED)은 마지막 갱신(last_updated_at) 24시간 뒤 지워지고, 확정된 세션(CONFIRMED)은 기록으로 남는다. (명세서 6.4)
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createMemoryAiSessionStore({ now = () => Date.now() } = {}) {
  const sessions = new Map();

  const purgeExpired = () => {
    const limit = now() - SESSION_TTL_MS;
    for (const [id, session] of sessions) {
      if (session.session_status !== 'CONFIRMED' && session.last_updated_at.getTime() < limit) sessions.delete(id);
    }
  };

  return {
    // 읽고 쓸 때는 복사본을 주고받아서, 저장된 세션이 밖에서 바뀌지 않는다.
    async insert(session) {
      purgeExpired();
      const id = randomBytes(12).toString('hex'); // MongoDB ObjectId 와 같은 24자 16진수
      sessions.set(id, structuredClone({ ...session, _id: id }));
      return structuredClone(sessions.get(id));
    },
    async findById(id) {
      purgeExpired();
      const found = sessions.get(id);
      return found ? structuredClone(found) : null;
    },
    async save(session) {
      if (!sessions.has(session._id)) return null; // 그 사이 정리되었으면 저장하지 않는다
      sessions.set(session._id, structuredClone(session));
      return structuredClone(session);
    },
    async clear() {
      sessions.clear();
    },
  };
}
