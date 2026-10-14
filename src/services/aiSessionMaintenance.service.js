import { aiSessionsStore } from '../dao/aiSessions.dao.js';
import { securityEvent, safeErrorType } from '../utils/securityLog.js';

// 요청이 없는 동안에도 만료·보관 정책을 적용한다. 한 프로세스의 정리 작업은 겹치지 않는다.
export function startAiSessionMaintenance({
  store = aiSessionsStore, intervalMs = 60_000,
  onError = error => securityEvent('ai.maintenance.failed', { operation: 'cleanup', error_type: safeErrorType(error) }),
} = {}) {
  let stopped = false, pending = null;
  const run = () => {
    if (stopped || pending) return;
    pending = Promise.resolve().then(() => store.cleanup()).catch(onError).finally(() => { pending = null; });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run();
  return async () => { stopped = true; clearInterval(timer); await pending; };
}
