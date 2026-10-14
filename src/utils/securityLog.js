import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
import { ERRORS } from './errors.js';

export const securityLogContext = new AsyncLocalStorage();
const EVENTS = {
  'auth.login.success': 'info', 'auth.signup.success': 'info', 'auth.logout.success': 'info',
  'auth.login.failed': 'warn', 'auth.denied': 'warn', 'permission.denied': 'warn',
  'rate_limit.exceeded': 'warn', 'validation.failed': 'warn', 'image.access.denied': 'warn',
  'request.rejected': 'warn', 'request.aborted': 'warn', 'request.failed': 'error',
  'admin.action': 'info', 'file.upload.success': 'info', 'data.export.success': 'info',
  'ai.provider.failed': 'error', 'ai.unavailable': 'error', 'ai.maintenance.failed': 'error',
  'ai.lock.failed': 'error', 'image.delete.failed': 'error',
  'server.started': 'info', 'server.stopped': 'info', 'logging.dropped': 'warn',
};
const ERROR_TYPES = new Set(['Error', 'TypeError', 'RangeError', 'AbortError', 'TimeoutError',
  'SequelizeDatabaseError', 'SequelizeConnectionError', 'SequelizeConnectionRefusedError',
  'SequelizeUniqueConstraintError', 'SequelizeForeignKeyConstraintError', 'SequelizeTimeoutError']);
const OPERATIONS = new Set(['photo', 'listing', 'dialogue', 'pattern', 'cleanup', 'image_delete']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ROLES = new Set(['BUYER', 'SELLER', 'ADMIN']);
const LIMIT_SCOPES = new Set(['api', 'auth', 'ai_call', 'ai_session']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;

// 오류의 메시지·스택·SQL·본문은 읽거나 직렬화하지 않는다.
export function safeErrorType(error) {
  try { return ERROR_TYPES.has(error?.name) ? error.name : 'Error'; }
  catch { return 'Error'; }
}
export function setSecurityActor(id, role) {
  const context = securityLogContext.getStore();
  if (!context) return;
  if (integer(id) && id > 0 && ROLES.has(role)) Object.assign(context, { actor_id: id, actor_role: role });
}
export function setSecurityLimitScope(scope) {
  const context = securityLogContext.getStore();
  if (context && LIMIT_SCOPES.has(scope)) context.limit_scope = scope;
}
export function setSecurityError(code, error) {
  const context = securityLogContext.getStore();
  if (!context) {
    if (code === 'INTERNAL_ERROR') securityEvent('request.failed', { error_code: code, error_type: safeErrorType(error) });
    return;
  }
  context.error_code = Object.hasOwn(ERRORS, code) ? code : 'INTERNAL_ERROR';
  if (code === 'INTERNAL_ERROR') context.error_type = safeErrorType(error);
}

// stdout 백프레셔 중에는 개별 기록을 메모리에 쌓지 않고 누락 건수만 보관한다.
export function createSecurityLogger({ stream = process.stdout, enabled = true, key = randomBytes(32), now = () => new Date() } = {}) {
  let blocked = false, dropped = 0, closed = false;
  const drop = () => { dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1); };
  function record(event, fields) {
    const result = { schema_version: 1, timestamp: now().toISOString(), level: EVENTS[event], event,
      service: 'material-loop-backend', environment: ['production', 'development', 'test'].includes(env.nodeEnv) ? env.nodeEnv : 'unknown', pid: process.pid };
    if (typeof fields.request_id === 'string' && UUID.test(fields.request_id)) result.request_id = fields.request_id;
    if (METHODS.has(fields.method)) result.method = fields.method;
    if (typeof fields.route === 'string' && fields.route.length <= 200 && /^\/(?:api\/v1\/[a-zA-Z0-9/:_-]+|api\/v1\/\[unmatched\]|uploads\/\[file\])$/.test(fields.route)) result.route = fields.route;
    if (integer(fields.status_code) && fields.status_code >= 100 && fields.status_code <= 599) result.status_code = fields.status_code;
    if (integer(fields.duration_ms)) result.duration_ms = Math.min(fields.duration_ms, 2147483647);
    if (integer(fields.actor_id) && fields.actor_id > 0 && ROLES.has(fields.actor_role)) {
      result.actor_id = fields.actor_id; result.actor_role = fields.actor_role;
    }
    if (Object.hasOwn(ERRORS, fields.error_code)) result.error_code = fields.error_code;
    if (ERROR_TYPES.has(fields.error_type)) result.error_type = fields.error_type;
    if (OPERATIONS.has(fields.operation)) result.operation = fields.operation;
    if (LIMIT_SCOPES.has(fields.limit_scope)) result.limit_scope = fields.limit_scope;
    if (typeof fields.ip === 'string' && isIP(fields.ip)) {
      result.ip_hash = createHmac('sha256', key).update(`security-ip-v1\n${ipKeyGenerator(fields.ip, 56)}`).digest('hex');
    }
    if (event === 'logging.dropped' && integer(fields.dropped_count)) result.dropped_count = fields.dropped_count;
    return result;
  }
  function write(event, fields) {
    try {
      if (stream.write(JSON.stringify(record(event, fields)) + '\n') === false) blocked = true;
      return true;
    } catch { blocked = true; drop(); return false; }
  }
  const onError = () => { blocked = true; };
  const onDrain = () => {
    blocked = false;
    if (!dropped || closed) return;
    const count = dropped; dropped = 0;
    write('logging.dropped', { dropped_count: count });
  };
  if (enabled) { stream.on?.('error', onError); stream.on?.('drain', onDrain); }
  return {
    log(event, fields = {}) {
      if (!enabled || closed || !Object.hasOwn(EVENTS, event)) return false;
      if (blocked) { drop(); return false; }
      return write(event, fields);
    },
    status: () => ({ blocked, dropped, enabled, closed }),
    close() {
      closed = true;
      stream.off?.('error', onError); stream.off?.('drain', onDrain);
    },
  };
}

const defaultLogger = createSecurityLogger({ enabled: !env.isTest });
let logger = defaultLogger;
export const securityEvent = (event, fields = {}) => {
  try { return logger.log(event, { ...securityLogContext.getStore(), ...fields }); }
  catch { return false; }
};
// 테스트에서는 실제 stdout 대신 같은 로그 포맷의 수집기를 연결한다.
export const setSecurityLogger = replacement => { logger = replacement ?? defaultLogger; };
