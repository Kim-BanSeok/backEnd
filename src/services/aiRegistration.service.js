import { fail } from '../utils/errors.js';
import { toKstIso } from '../utils/response.js';
import { withKeyLock } from '../utils/keyedMutex.js';
import { getProvider } from '../ai/index.js';
import * as flow from '../ai/flow.js';
import * as aiSessionsDao from '../dao/aiSessions.dao.js';
import * as usersDao from '../dao/users.dao.js';
import * as storesDao from '../dao/stores.dao.js';
import { createFabric } from './fabrics.service.js';
import { reserveSession, releaseSession, renewSession, withAiCall } from './security.service.js';
import { withAiSessionLock } from '../dao/security.dao.js';
import { env } from '../config/env.js';

const withSessionLock = (sessionId, task) => env.ai.sessionStore === 'database' ? withAiSessionLock(sessionId, task) : withKeyLock(`ai-session:${sessionId}`, task);

const MAX_AI_ATTEMPTS = 2; // 처음 한 번 + 다시 시도 1회 (명세서 19번)

const message = (role, content) => ({ role, content, created_at: new Date() });
const toMessageView = (m) => ({ role: m.role, content: m.content, created_at: toKstIso(m.created_at) });

// 이 세션을 이어서 해도 되는 상태인지: 확정·중단된 세션이면 AI_SESSION_CLOSED
const assertOpen = (session) => {
  if (session.session_status !== 'IN_PROGRESS') throw fail('AI_SESSION_CLOSED');
};

// 본인의 세션을 찾는다. 없으면 404, 남의 세션이면 403.
async function findOwn(userId, sessionId) {
  const session = await aiSessionsDao.findById(sessionId);
  if (!session) throw fail('NOT_FOUND');
  if (session.seller_id !== userId) throw fail('FORBIDDEN');
  return session;
}

const base = (session) => ({ sessionId: session._id, ...flow.toView(session) });

// 세션이 바뀔 때마다 마지막 갱신 시각을 새로 한다. (방치된 세션을 24시간 뒤 지우는 기준)
// 저장한 세션을 돌려준다. (그 사이 방치 세션으로 정리되었다면 지금 메모리의 세션을 그대로 돌려준다)
const persist = async (session) => {
  session.last_updated_at = new Date();
  const saved = (await aiSessionsDao.save(session)) ?? session;
  if (session.session_status === 'IN_PROGRESS') await renewSession(session.securityLeaseId);
  else await releaseSession(session.securityLeaseId);
  return saved;
};

// 다음 질문을 대화 기록에 남긴다. 더 물을 것이 없으면 마무리 안내를 남긴다.
const recordNextQuestion = (session) => {
  const next = flow.currentQuestion(session);
  session.messages.push(message('assistant', next ? next.text : flow.COMPLETE_MESSAGE));
};

// ==== 17. AI 등록 시작

export async function startSession(userId) {
  // 승인을 먼저 확인하고, 그다음 매장을 확인한다. (명세서 17번)
  const user = await usersDao.findById(userId);
  if (!user) throw fail('UNAUTHORIZED');
  if (user.seller_approval_status !== 'APPROVED') throw fail('SELLER_NOT_APPROVED');
  if (!(await storesDao.findByUserId(userId))) throw fail('STORE_REQUIRED');

  const provider = getProvider();
  const session = flow.newSession({ sellerId: userId, now: new Date(), model: provider.model });
  session.securityLeaseId = await reserveSession(userId);
  recordNextQuestion(session);
  try { return base(await aiSessionsDao.insert(session)); }
  catch (error) { await releaseSession(session.securityLeaseId); throw error; }
}

// ==== 18. AI 등록 세션 조회

export async function getSession(userId, sessionId) {
  const session = await findOwn(userId, sessionId);
  return { ...base(session), messages: session.messages.map(toMessageView), fabric_id: session.fabric_id };
}

// ==== 19. AI 등록 답변 보내기

// AI 응답이 실패·시간 초과·형식 오류이면 1회 다시 시도하고, 그래도 안 되면 503 AI_UNAVAILABLE 이다.
async function extractWithRetry(session, question, text) {
  const provider = getProvider();
  let lastError;
  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt += 1) {
    session.call_count += 1;
    try {
      const result = await withAiCall(session.seller_id, () => provider.extract({ question, text, draft: session.ai_draft }));
      if (!result || typeof result.values !== 'object' || result.values === null) throw new Error('AI 응답 형식이 올바르지 않아요');
      session.input_tokens += result.usage?.input_tokens ?? 0;
      session.output_tokens += result.usage?.output_tokens ?? 0;
      return result.values;
    } catch (error) {
      if (error.code === 'TOO_MANY_REQUESTS') throw error;
      lastError = error;
    }
  }
  console.error('AI 호출 실패', lastError);
  throw fail('AI_UNAVAILABLE');
}

// 말하듯 쓴 답은 answer 로, 선택 버튼을 누른 값은 selected 로 보낸다. 둘 다 없고 finish 도 아니면 입력 검사에서 VALIDATION_ERROR 다.
export function answerSession(userId, sessionId, { answer, selected, finish }) {
  return withSessionLock(sessionId, async () => {
    const session = await findOwn(userId, sessionId);
    assertOpen(session);

    const question = flow.currentQuestion(session);
    const hasAnswer = selected !== undefined || answer !== undefined;
    const userText = selected ?? answer;

    if (hasAnswer) {
      if (!question) {
        throw fail('VALIDATION_ERROR', [{ field: selected !== undefined ? 'selected' : 'answer', message: '더 이상 물어볼 것이 없어요. 등록하거나 중단해 주세요' }]);
      }
      if (selected !== undefined) {
        // 선택 버튼 값은 AI 를 부르지 않고 바로 받는다. 선택 목록에 없는 값이면 VALIDATION_ERROR.
        if (!flow.applySelected(session, question, selected)) {
          throw fail('VALIDATION_ERROR', [{ field: 'selected', message: '선택할 수 없는 값이에요' }]);
        }
      } else {
        const values = await extractWithRetry(session, question, answer);
        flow.applyValues(session, question, values);
      }
      session.messages.push(message('user', userText));
    }

    if (finish) flow.finish(session); // 더 묻지 않고 지금까지의 초안을 보여 준다
    recordNextQuestion(session);
    return base(await persist(session));
  });
}

// ==== 20. AI 등록 확정

// 판매자가 확인·수정한 최종본으로 원단을 만든다. 요청 본문은 POST /fabrics 와 같고 같은 검사를 한다.
// 두 번 눌러도 원단은 하나만 만들어진다. 검사에 걸려 실패하면 세션은 계속 진행 중이다.
export function confirmSession(userId, sessionId, input) {
  return withSessionLock(sessionId, async () => {
    const session = await findOwn(userId, sessionId);
    assertOpen(session);

    const created = await createFabric(userId, input); // 승인·매장·규칙 검사와 저장. 실패하면 던진다
    session.session_status = 'CONFIRMED';
    session.final_data = input; // 최종본. 초안(ai_draft)은 그대로 남아 비교할 수 있다
    session.fabric_id = created.fabricId;
    await persist(session);
    return created;
  });
}

// ==== 21. AI 등록 중단

export function abortSession(userId, sessionId) {
  return withSessionLock(sessionId, async () => {
    const session = await findOwn(userId, sessionId);
    assertOpen(session);

    session.session_status = 'ABORTED';
    await persist(session);
    return {
      sessionId: session._id,
      session_status: session.session_status,
      ai_draft: session.ai_draft,
      unconfirmed_fields: session.unconfirmed_fields,
    };
  });
}
