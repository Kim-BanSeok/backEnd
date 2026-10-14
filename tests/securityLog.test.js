import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createSecurityLogger, safeErrorType, securityEvent, setSecurityLogger, securityLogContext } from '../src/utils/securityLog.js';

function collect(t, options = {}) {
  const lines = [];
  const stream = new EventEmitter();
  stream.write = line => { lines.push(line); return true; };
  const logger = createSecurityLogger({ stream, key: Buffer.alloc(32, 7), ...options });
  t.after(() => logger.close());
  return { logger, lines, stream };
}

test('보안 로그는 고정 스키마의 JSON 한 줄이며 시간·수준·요청·검증된 사용자를 기록한다', (t) => {
  const { logger, lines } = collect(t, { now: () => new Date('2026-10-14T09:00:00Z') });
  const id = randomUUID();
  logger.log('auth.login.success', { request_id: id, method: 'POST', route: '/api/v1/auth/login', status_code: 200,
    duration_ms: 5, actor_id: 2, actor_role: 'SELLER', ip: '127.0.0.1' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].split('\n').length, 2);
  const row = JSON.parse(lines[0]);
  assert.equal(row.schema_version, 1);
  assert.equal(row.timestamp, '2026-10-14T09:00:00.000Z');
  assert.equal(row.level, 'info');
  assert.equal(row.event, 'auth.login.success');
  assert.equal(row.request_id, id);
  assert.equal(row.actor_id, 2);
  assert.equal(row.actor_role, 'SELLER');
  assert.equal(row.status_code, 200);
  assert.match(row.ip_hash, /^[a-f0-9]{64}$/);
  assert.ok(!lines[0].includes('127.0.0.1'));
});

test('필드 허용 목록으로 본문·토큰·개인정보·SQL·스택·파일명·프롬프트를 버린다', (t) => {
  const { logger, lines } = collect(t);
  const secret = 'SECRET-MARKER';
  logger.log('request.failed', { password: secret, token: secret, authorization: secret, cookie: secret,
    email: secret, phone_number: secret, body: { memo: secret }, query: { signature: secret }, url: secret,
    sql: secret, stack: secret, message: secret, error: { message: secret }, filename: secret, image: secret, prompt: secret,
    method: secret, route: `/uploads/${secret}.jpg?signature=${secret}`, actor_id: secret,
    actor_role: secret, error_type: secret, error_code: secret, operation: secret, limit_scope: secret, request_id: secret });
  assert.ok(!lines.join('').includes(secret));
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ['schema_version', 'timestamp', 'level', 'event', 'service', 'environment', 'pid'].sort());
});

test('개행·제어문자·비정상 경로·이벤트 이름으로 로그 레코드를 주입하지 못한다', (t) => {
  const { logger, lines } = collect(t);
  logger.log('permission.denied', { route: '/api/v1/users/me\r\n{"event":"forged"}',
    request_id: randomUUID() + '\nforged', error_code: 'FORBIDDEN\nforged', actor_role: 'ADMIN\nforged' });
  assert.equal(logger.log('auth.denied\n{"event":"forged"}'), false);
  assert.equal(logger.log('__proto__'), false);
  assert.equal(logger.log('constructor'), false);
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('forged'));
  assert.equal(JSON.parse(lines[0]).event, 'permission.denied');
});

test('불완전하거나 음수·비정상인 ID·시간·상태·역할은 기록하지 않는다', (t) => {
  const { logger, lines } = collect(t);
  logger.log('auth.denied', { actor_id: -1, actor_role: 'ADMIN', status_code: 999, duration_ms: Infinity, ip: 'bad' });
  const row = JSON.parse(lines[0]);
  for (const field of ['actor_id', 'actor_role', 'status_code', 'duration_ms', 'ip_hash']) assert.ok(!(field in row));
});

test('IP 가명은 같은 주소·IPv4-mapped·IPv6 /56을 묶고 키가 바뀌면 달라진다', (t) => {
  const one = collect(t);
  for (const ip of ['198.51.100.1', '::ffff:198.51.100.1', '198.51.100.2', '2001:db8:1234:5601::1', '2001:db8:1234:56ff::2']) {
    one.logger.log('auth.denied', { ip });
  }
  const hashes = one.lines.map(line => JSON.parse(line).ip_hash);
  assert.equal(hashes[0], hashes[1]);
  assert.notEqual(hashes[0], hashes[2]);
  assert.equal(hashes[3], hashes[4]);
  const other = collect(t, { key: Buffer.alloc(32, 8) });
  other.logger.log('auth.denied', { ip: '198.51.100.1' });
  assert.notEqual(hashes[0], JSON.parse(other.lines[0]).ip_hash);
});

test('원시 오류를 직렬화하지 않고 허용한 오류 종류만 남긴다', () => {
  const error = new Error('SECRET-MARKER');
  error.sql = 'SECRET-MARKER';
  error.toJSON = () => { assert.fail('원시 오류를 직렬화하면 안 됩니다.'); };
  assert.equal(safeErrorType(error), 'Error');
  assert.equal(safeErrorType({ name: 'SequelizeDatabaseError', message: 'SECRET-MARKER' }), 'SequelizeDatabaseError');
  assert.equal(safeErrorType({ name: 'SECRET-MARKER' }), 'Error');
  assert.equal(safeErrorType({ get name() { throw new Error('SECRET-MARKER'); } }), 'Error');
});

test('stdout 백프레셔 중에는 기록을 쌓지 않고 누락 건수만 보관해 drain 때 알린다', (t) => {
  const { logger, lines, stream } = collect(t);
  stream.write = line => { lines.push(line); return false; };
  assert.equal(logger.log('auth.denied'), true);
  for (let i = 0; i < 100; i++) assert.equal(logger.log('auth.denied', { password: 'SECRET-MARKER' }), false);
  assert.equal(lines.length, 1);
  assert.equal(logger.status().dropped, 100);
  stream.write = line => { lines.push(line); return true; };
  stream.emit('drain');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).event, 'logging.dropped');
  assert.equal(JSON.parse(lines[1]).dropped_count, 100);
  assert.equal(logger.status().dropped, 0);
  assert.equal(logger.log('auth.denied'), true);
});

test('출력 예외·오류 이벤트도 외부로 던지지 않고 복구 후 누락을 알린다', (t) => {
  const { logger, lines, stream } = collect(t);
  stream.write = () => { throw new Error('SECRET-MARKER'); };
  assert.equal(logger.log('request.failed'), false);
  assert.doesNotThrow(() => stream.emit('error', new Error('SECRET-MARKER')));
  assert.equal(logger.status().blocked, true);
  stream.write = line => { lines.push(line); return true; };
  stream.emit('drain');
  assert.equal(JSON.parse(lines[0]).dropped_count, 1);
  assert.ok(!lines.join('').includes('SECRET-MARKER'));
});

test('로그 수집기의 예외나 입력 getter 예외는 서비스 동작으로 전파하지 않는다', (t) => {
  setSecurityLogger({ log() { throw new Error('SECRET-MARKER'); } });
  t.after(() => setSecurityLogger());
  assert.equal(securityEvent('auth.denied'), false);
  assert.equal(securityEvent('auth.denied', { get body() { throw new Error('SECRET-MARKER'); } }), false);
});

test('AsyncLocalStorage는 동시에 진행한 요청의 사용자·요청 ID를 섞지 않는다', async (t) => {
  const { logger, lines } = collect(t);
  setSecurityLogger(logger);
  t.after(() => setSecurityLogger());
  const ids = [randomUUID(), randomUUID()];
  await Promise.all(ids.map((request_id, index) => securityLogContext.run({ request_id, actor_id: index + 1, actor_role: 'BUYER' }, async () => {
    await new Promise(resolve => setTimeout(resolve, index ? 1 : 10));
    securityEvent('auth.logout.success');
  })));
  for (const line of lines) {
    const row = JSON.parse(line);
    assert.equal(row.actor_id, ids.indexOf(row.request_id) + 1);
  }
});

test('닫거나 비활성화한 수집기는 기록·이벤트 리스너를 남기지 않는다', (t) => {
  const { logger, stream } = collect(t);
  assert.equal(stream.listenerCount('error'), 1);
  logger.close();
  assert.equal(stream.listenerCount('error'), 0);
  assert.equal(logger.log('auth.denied'), false);
  const disabled = collect(t, { enabled: false });
  assert.equal(disabled.logger.log('auth.denied'), false);
  assert.equal(disabled.stream.listenerCount('error'), 0);
});

test('운영 설정의 기본 수집기는 실제 stdout에 JSON을 출력하며 DB나 AI를 호출하지 않는다', () => {
  const cwd = path.resolve(import.meta.dirname, '../../.local-runtime/security-logs-20261014/config-only');
  mkdirSync(cwd, { recursive: true });
  const source = `const {securityEvent} = await import(${JSON.stringify(new URL('../src/utils/securityLog.js', import.meta.url).href)}); securityEvent('server.started', { token: 'SECRET-MARKER', password: 'SECRET-MARKER' });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd, env: { ...process.env, NODE_ENV: 'production', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only',
      JWT_SECRET: 'a'.repeat(32), AI_SESSION_STORE: 'database' }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(child.status, 0, child.stderr);
  const row = JSON.parse(child.stdout);
  assert.equal(row.event, 'server.started');
  assert.equal(row.environment, 'production');
  assert.ok(!child.stdout.includes('SECRET-MARKER'));
});
