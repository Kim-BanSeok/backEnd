import { env } from '../config/env.js';
import { createMemoryAiSessionStore } from './aiSessions.memory.js';
import { createDatabaseAiSessionStore } from './aiSessions.database.js';

// AI 등록 세션 저장소의 입구. 운영은 DB, 명시한 개발 실험·테스트는 memory도 지원한다.
// 저장소는 insert(session), findById(id), save(session) 을 지킨다. 없으면 null 을 돌려준다.
function createStore() {
  if (env.ai.sessionStore === 'database') return createDatabaseAiSessionStore();
  if (env.ai.sessionStore === 'memory') return createMemoryAiSessionStore();
  throw new Error(`지원하지 않는 AI_SESSION_STORE: ${env.ai.sessionStore}`);
}

export const aiSessionsStore = createStore();
export const insert = (session) => aiSessionsStore.insert(session);
export const findById = (id) => aiSessionsStore.findById(id);
export const save = (session) => aiSessionsStore.save(session);
