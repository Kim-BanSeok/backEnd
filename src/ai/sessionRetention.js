export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const CONFIRMED_HISTORY_TTL_MS = 30 * SESSION_TTL_MS;

export const isExpiredSession = (session, now) =>
  ['IN_PROGRESS', 'ABORTED'].includes(session.session_status) &&
  new Date(session.last_updated_at).getTime() <= now - SESSION_TTL_MS;

export const needsHistoryRedaction = (session, now) =>
  session.session_status === 'CONFIRMED' && !session.history_redacted_at &&
  new Date(session.last_updated_at).getTime() <= now - CONFIRMED_HISTORY_TTL_MS;

// 확정 기록과 최종 등록값은 보존한다. 자유 입력 대화와 AI 초안은 보관 기간 뒤 비운다.
export const redactConfirmedHistory = (session, now) => ({
  ...session,
  messages: [],
  ai_draft: {},
  unconfirmed_fields: [],
  flags: {},
  history_redacted_at: session.history_redacted_at || new Date(now).toISOString(),
});
