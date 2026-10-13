import { ERRORS } from '../utils/errors.js';

// API 명세서(docs/API_명세서_v0.3.md)를 OpenAPI 3 문서로 바꾼다. 명세서가 정답이고, 이 파일은 읽기만 한다.
// 순수 함수라서 테스트에서 "명세서와 openapi.json 이 같은지" 확인할 수 있다. (scripts/build-openapi.js 가 파일로 저장)

const LABELS = ['요청', '처리 규칙', '오류 코드'];
// "Form 항목 (multipart/form-data)" 처럼 뒤에 설명이 붙어도 같은 라벨로 본다. 구역 이름은 앞 단어(Path, Query, Body, Form)로 통일한다.
const ITEM_LABEL = /^(Path|Query|Body|Form) 항목/;
const isLabel = (line) =>
  LABELS.includes(line) || ITEM_LABEL.test(line) || /^요청 예시/.test(line) || /^성공 응답 \(\d+\)$/.test(line);
const normalizeLabel = (line) => (ITEM_LABEL.test(line) ? `${line.match(ITEM_LABEL)[1]} 항목` : line);

// ---- 표 읽기

const isTableLine = (line) => line.startsWith('|');
const splitRow = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isSeparator = (line) => /^\|\s*:?-{3,}/.test(line);

function parseTable(lines) {
  const rows = lines.filter((l) => isTableLine(l) && !isSeparator(l)).map(splitRow);
  const [header, ...body] = rows;
  return { header, rows: body };
}

// ---- 항목 설명에서 규칙 꺼내기 ("값: A, B", "최소 1자", "기본값 SCRAP" ...)

function typeOf(typeText) {
  const nullable = /또는 null/.test(typeText);
  const t = typeText.replace(/\s*또는 null/, '').trim();
  const map = { 문자열: { type: 'string' }, 정수: { type: 'integer' }, 숫자: { type: 'number' }, 'true/false': { type: 'boolean' }, 객체: { type: 'object' }, 배열: { type: 'array', items: {} }, 파일: { type: 'string', format: 'binary' } };
  return { schema: { ...(map[t] ?? { type: 'string' }) }, nullable };
}

function applyRules(schema, text) {
  const values = text.match(/값: ([A-Za-z0-9_, ]+?)(?:,\s*기본값|$|\s*\/|\))/);
  if (values) {
    const list = values[1].split(',').map((v) => v.trim()).filter(Boolean);
    if (list.length) schema.enum = list;
  }
  const def = text.match(/기본값 ([A-Za-z0-9_]+)/);
  if (def) schema.default = schema.type === 'integer' ? Number(def[1]) : def[1];

  if (schema.type === 'string' && !schema.format) {
    const min = text.match(/최소 (\d+)자/);
    const max = text.match(/최대 (\d+)자/);
    if (min) schema.minLength = Number(min[1]);
    if (max) schema.maxLength = Number(max[1]);
  } else if (schema.type === 'integer') {
    const min = text.match(/최소 (-?\d+)(?!\d|자)/);
    const max = text.match(/최대 (\d+)(?!\d|자)/);
    if (min) schema.minimum = Number(min[1]);
    if (max) schema.maximum = Number(max[1]);
  }
  return schema;
}

function fieldSchema(typeText, description) {
  const { schema, nullable } = typeOf(typeText);
  applyRules(schema, description);
  if (nullable) schema.nullable = true;
  schema.description = description;
  return schema;
}

// ---- 요청 항목 표 → 객체 스키마. detail.material 같은 이름은 안쪽 객체로 넣는다.

function bodySchema(rows) {
  const root = { type: 'object', properties: {}, required: [] };
  for (const [name, type, required, description] of rows) {
    const parts = name.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      node.properties[part] ??= { type: 'object', properties: {}, required: [] };
      node = node.properties[part];
    }
    const leaf = parts.at(-1);
    const schema = fieldSchema(type, description);
    if (schema.type === 'object') Object.assign(schema, { properties: {}, required: [] }); // 안쪽 항목(detail.xxx)이 채워진다
    // 이미 object 로 만들어 둔 항목(detail)의 안쪽은 지우지 않고 설명만 덧붙인다.
    if (node.properties[leaf]?.type === 'object' && schema.type === 'object') {
      node.properties[leaf].description = description;
    } else {
      node.properties[leaf] = schema;
    }
    if (required === '필수') node.required.push(leaf);
  }
  // required 가 비면 빼야 OpenAPI 문법에 맞는다.
  const prune = (n) => {
    if (n.required && n.required.length === 0) delete n.required;
    Object.values(n.properties ?? {}).forEach(prune);
  };
  prune(root);
  return root;
}

// ---- JSON 예시: 명세서의 JSON 은 줄마다 빈 줄이 끼어 있고 목록 생략은 "..." 한 줄로 적혀 있다.

function parseJson(lines) {
  const text = lines
    .map((l) => l.trim())
    .filter((l) => l && l !== '...')
    .join('')
    .replace(/,\s*([\]}])/g, '$1'); // "..." 를 지우면서 생긴 마지막 쉼표
  return JSON.parse(text);
}

// 예시 값으로 응답 모양(스키마)을 추정한다. 필드 설명은 없고 타입만 보여 준다.
function inferSchema(value) {
  if (value === null) return { nullable: true };
  if (Array.isArray(value)) return { type: 'array', items: value.length ? inferSchema(value[0]) : {} };
  switch (typeof value) {
    case 'object':
      return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inferSchema(v)])) };
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    default:
      return { type: 'string' };
  }
}

// ---- 권한 표기 → 보안 설정

function securityOf(permission) {
  if (permission === '공개') return { security: [] };
  if (permission.startsWith('공개')) return { security: [{}, { bearerAuth: [] }] }; // 로그인하면 더 많이 보임
  return { security: [{ bearerAuth: [] }] };
}

// ---- 한 API 의 본문 줄들을 읽는다

function parseOperation(no, title, area, lines) {
  const clean = lines.map((l) => l.trim()).filter((l) => l !== '');

  // 구역 나누기: 라벨 줄이 나올 때마다 새 구역
  const sections = [];
  let current = { label: '__info', lines: [] };
  for (const line of clean) {
    if (!isTableLine(line) && isLabel(line)) {
      sections.push(current);
      current = { label: normalizeLabel(line), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  const info = Object.fromEntries(parseTable(sections[0].lines).rows.map(([k, v]) => [k, v]));
  const [method, fullUrl] = info['Method / URL'].split(/\s+/);
  const path = fullUrl.replace(/^\/api\/v1/, '');
  const permission = info['권한'];

  const op = {
    tags: [area],
    summary: `${no}. ${title}`,
    operationId: `api${no}`,
    parameters: [],
    responses: {},
    ...securityOf(permission),
    'x-api-no': no,
    'x-priority': info['구분'],
    'x-permission': permission,
  };

  const descParts = [info['설명'], `**권한:** ${permission} · **구분:** ${info['구분']}`];

  const formRows = sections.find((s) => s.label === 'Form 항목');
  const bodyRows = sections.find((s) => s.label === 'Body 항목');
  for (const [label, where] of [['Path 항목', 'path'], ['Query 항목', 'query']]) {
    const section = sections.find((s) => s.label === label);
    if (!section) continue;
    for (const [name, type, required, description] of parseTable(section.lines).rows) {
      op.parameters.push({
        name,
        in: where,
        required: where === 'path' ? true : required === '필수',
        description,
        schema: fieldSchema(type, description),
      });
    }
  }
  if (!op.parameters.length) delete op.parameters;

  // 요청 본문
  const exampleSections = sections.filter((s) => s.label.startsWith('요청 예시'));
  if (bodyRows) {
    const schema = bodySchema(parseTable(bodyRows.lines).rows);
    const examples = {};
    exampleSections.forEach((s, i) => {
      const name = s.label.match(/\((.+)\)/)?.[1] ?? (exampleSections.length > 1 ? `예시 ${i + 1}` : '예시');
      examples[name] = { value: parseJson(s.lines) };
    });
    op.requestBody = { required: true, content: { 'application/json': { schema, examples } } };
  } else if (formRows) {
    const schema = bodySchema(parseTable(formRows.lines).rows);
    op.requestBody = { required: true, content: { 'multipart/form-data': { schema } } };
  }

  // 성공 응답
  const success = sections.find((s) => /^성공 응답/.test(s.label));
  const code = success.label.match(/\((\d+)\)/)[1];
  const example = parseJson(success.lines);
  op.responses[code] = {
    description: '성공',
    content: { 'application/json': { schema: inferSchema(example), example } },
  };

  // 처리 규칙
  const rules = sections.find((s) => s.label === '처리 규칙');
  if (rules) descParts.push('**처리 규칙**\n\n' + rules.lines.map((l) => `- ${l}`).join('\n'));

  // 오류 코드: 같은 HTTP 상태끼리 묶어서, 코드마다 예시를 보여 준다.
  const errorTable = parseTable(sections.find((s) => s.label === '오류 코드').lines);
  const byStatus = new Map();
  for (const [status, errorCode, when] of errorTable.rows) {
    if (!ERRORS[errorCode]) throw new Error(`${no}번: 오류 코드 표에 없는 코드 ${errorCode}`);
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push({ errorCode, when });
  }
  for (const [status, list] of byStatus) {
    op.responses[status] = {
      description: list.map((e) => `**${e.errorCode}** — ${e.when}`).join('\n\n'),
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          examples: Object.fromEntries(
            list.map((e) => [
              e.errorCode,
              {
                summary: e.errorCode,
                value: { success: false, error: { code: e.errorCode, message: ERRORS[e.errorCode].message } },
              },
            ]),
          ),
        },
      },
    };
  }

  op.description = descParts.join('\n\n');
  return { path, method: method.toLowerCase(), op };
}

// ---- 전체

export function buildOpenApi(markdown) {
  const lines = markdown.split(/\r?\n/);

  const versionLine = lines.find((l) => /^\| 버전 \|/.test(l));
  const version = versionLine ? splitRow(versionLine)[1] : 'v0';

  const start = lines.findIndex((l) => l.startsWith('# 5. API 상세'));
  const end = lines.findIndex((l, i) => i > start && /^# 6\./.test(l));
  if (start < 0 || end < 0) throw new Error('명세서에서 "5. API 상세" 구간을 찾지 못했어요');

  const paths = {};
  const tagOrder = [];
  let area = '';
  let block = null;

  const flush = () => {
    if (!block) return;
    const { path, method, op } = parseOperation(block.no, block.title, block.area, block.lines);
    (paths[path] ??= {})[method] = op;
    block = null;
  };

  for (const line of lines.slice(start + 1, end)) {
    const areaMatch = line.match(/^## \d+\.\d+ (.+)$/);
    const apiMatch = line.match(/^### (\d+)\. (.+)$/);
    if (areaMatch) {
      flush();
      area = areaMatch[1].trim();
      tagOrder.push(area);
    } else if (apiMatch) {
      flush();
      block = { no: Number(apiMatch[1]), title: apiMatch[2].trim(), area, lines: [] };
    } else if (block) {
      block.lines.push(line);
    }
  }
  flush();

  return {
    openapi: '3.0.3',
    info: {
      title: 'Material Loop API',
      version: version.replace(/\s*\(.*\)/, ''),
      description:
        '양주시 자투리 원단 거래 웹 서비스 API. 기본 계약은 v0.3이며 2026-10-14 보안 확장(API_SECURITY_2026-10-14.md)이 우선 적용됩니다. 이 문서는 API_명세서_v0.3.md에서 자동 생성합니다.\n\n' +
        '- 성공 응답은 `{ "success": true, "data": ... }`, 실패는 `{ "success": false, "error": { "code", "message", "details?" } }` 예요.\n' +
        '- 로그인 후 받은 `accessToken` 을 오른쪽 위 **Authorize** 에 붙여 넣으면 로그인이 필요한 API 를 호출해 볼 수 있어요.\n' +
        '- 식별자(`userId`, `fabricId` 등)는 camelCase, 그 밖의 항목은 snake_case 예요.',
    },
    servers: [{ url: '/api/v1', description: '이 서버' }],
    tags: tagOrder.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: '로그인 응답의 accessToken (유효기간 24시간)' },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', description: '오류 코드 (명세서 3장)' },
                message: { type: 'string', description: '사용자에게 그대로 보여 줘도 되는 한글 메시지' },
                details: {
                  type: 'array',
                  description: 'VALIDATION_ERROR 일 때 항목별 이유',
                  items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    },
  };
}
