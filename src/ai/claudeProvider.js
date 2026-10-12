import { buildMessages, buildPhotoPrompt, PHOTO_FIELDS } from './prompts.js';

// Claude Messages API 로 판매자의 답에서 값을 뽑는다.
// 실패(네트워크, 시간 초과, 오류 응답, 형식 오류)는 오류를 던진다. 다시 시도하고 503 AI_UNAVAILABLE 로 바꾸는 것은 services 가 한다.
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

const jsonText = (content) => {
  const blocks = Array.isArray(content) ? content : [];
  return blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
};

const parseObject = (text) => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Claude 응답이 JSON 객체가 아니에요');
  return parsed;
};

async function complete(fetchImpl, { apiKey, model, timeoutMs, system, content }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Claude 응답 오류 ${response.status}`);

  const body = await response.json();
  const text = jsonText(body?.content);
  if (!text.trim()) throw new Error('Claude 응답에 내용이 없어요');
  return {
    parsed: parseObject(text),
    usage: { input_tokens: body.usage?.input_tokens ?? 0, output_tokens: body.usage?.output_tokens ?? 0 },
  };
}

export function createClaudeProvider({ apiKey, model, timeoutMs = 15000, fetchImpl = fetch }) {
  return {
    name: 'claude',
    model,
    async extract({ question, text, draft }) {
      const fields = question.field === 'size'
        ? (draft.sale_type === 'ROLL' ? ['width_cm', 'remaining_length_cm'] : ['width_cm', 'length_cm'])
        : [question.field];
      const messages = buildMessages({ fields, text, draft });
      const system = messages.find((message) => message.role === 'system')?.content ?? '';
      const user = messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n');
      const { parsed, usage } = await complete(fetchImpl, { apiKey, model, timeoutMs, system, content: user });
      return {
        values: Object.fromEntries(fields.map((name) => [name, parsed[name] ?? null])),
        usage,
      };
    },
    // mediaType: image/jpeg | image/png | image/webp, data: base64 문자열
    async describeImage({ mediaType, data }) {
      const { parsed, usage } = await complete(fetchImpl, {
        apiKey,
        model,
        timeoutMs,
        system: buildPhotoPrompt(),
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: '이 원단 사진을 보고 초안을 적어 주세요.' },
        ],
      });
      return {
        values: Object.fromEntries(PHOTO_FIELDS.map((name) => [name, parsed[name] ?? null])),
        usage,
      };
    },
  };
}
