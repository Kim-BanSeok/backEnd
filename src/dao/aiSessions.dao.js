import { env } from '../config/env.js';
import { createMemoryAiSessionStore } from './aiSessions.memory.js';

// AI 등록 세션 저장소의 입구. AI_SESSION_STORE 에 따라 저장소를 고른다. (지금은 memory 만 있다)
// 저장소는 insert(session), findById(id), save(session) 을 지킨다. 없으면 null 을 돌려준다.
function createStore() {
  if (env.ai.sessionStore === 'memory') return createMemoryAiSessionStore();
  throw new Error(`지원하지 않는 AI_SESSION_STORE: ${env.ai.sessionStore}`);
}

export const aiSessionsStore = createStore();
export const insert = (session) => aiSessionsStore.insert(session);
export const findById = (id) => aiSessionsStore.findById(id);
export const save = (session) => aiSessionsStore.save(session);
