import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isIP } from 'node:net';
import { securityEvent, securityLogContext } from '../utils/securityLog.js';

function eventFor(req, res, context) {
  const code = context.error_code;
  if (res.statusCode === 429) return 'rate_limit.exceeded';
  if (code === 'LOGIN_FAILED') return 'auth.login.failed';
  if (res.statusCode === 401) return 'auth.denied';
  if (res.statusCode === 403) return 'permission.denied';
  if (code === 'AI_UNAVAILABLE') return 'ai.unavailable';
  if (res.statusCode >= 500) return 'request.failed';
  if (context.route === '/uploads/[file]' && res.statusCode >= 400) return 'image.access.denied';
  if (res.statusCode === 400) return 'validation.failed';
  if (res.statusCode >= 400) return 'request.rejected';
  if (context.route === '/api/v1/auth/login') return 'auth.login.success';
  if (context.route === '/api/v1/auth/signup') return 'auth.signup.success';
  if (context.route === '/api/v1/auth/logout') return 'auth.logout.success';
  if (context.actor_role === 'ADMIN') return 'admin.action';
  if (req.method === 'POST' && ['/api/v1/fabrics/:fabricId/images', '/api/v1/ai/fabric-photo', '/api/v1/sellers/me/fabric-sheet'].includes(context.route)) return 'file.upload.success';
  if (req.method === 'GET' && context.route === '/api/v1/sellers/me/fabric-sheet') return 'data.export.success';
  return null;
}

export function securityRequestLog(req, res, next) {
  const scope = req.baseUrl.toLowerCase() === '/uploads' ? 'image' : 'api';
  const context = { request_id: randomUUID(), method: req.method,
    ip: isIP(req.ip) ? req.ip : req.socket.remoteAddress };
  // 서비스 중간 진단에도 라우트가 결정된 시점의 선언 템플릿을 사용한다.
  Object.defineProperty(context, 'route', { enumerable: true, get: () => scope === 'image' ? '/uploads/[file]'
    : typeof req.route?.path === 'string' ? '/api/v1' + req.route.path : '/api/v1/[unmatched]' });
  const started = performance.now();
  let completed = false;
  res.set('X-Request-Id', context.request_id);
  const finish = aborted => {
    if (completed) return;
    completed = true;
    // Express의 선언된 경로만 사용한다. URL·query·params와 파일명은 로그에 넣지 않는다.
    context.duration_ms = Math.max(0, Math.round(performance.now() - started));
    if (!aborted || res.headersSent) context.status_code = res.statusCode;
    const event = aborted ? 'request.aborted' : eventFor(req, res, context);
    if (event) securityEvent(event, context);
  };
  res.once('finish', () => finish(false));
  res.once('close', () => { if (!res.writableFinished) finish(true); });
  securityLogContext.run(context, next);
}
