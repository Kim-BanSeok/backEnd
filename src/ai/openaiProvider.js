import { buildMessages, buildPhotoPrompt, buildListingMessages, PHOTO_FIELDS } from './prompts.js';

// OpenAI Chat Completions 로 판매자의 답에서 값을 뽑는다.
// Claude 와 같은 extract / describeImage 모양이라, AI_PROVIDER 만 바꾸면 호출부가 그대로다.
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const jsonText = (content) => {
  if (typeof content === 'string') return content;
  const blocks = Array.isArray(content) ? content : [];
  return blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
};

const parseObject = (text) => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('OpenAI 응답이 JSON 객체가 아니에요');
  return parsed;
};

async function complete(fetchImpl, { apiKey, model, timeoutMs, messages, maxTokens = 1024 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : '';
    throw new Error(`OpenAI 응답 오류 ${response.status}${message ? `: ${message}` : ''}`);
  }
  const text = jsonText(body?.choices?.[0]?.message?.content);
  if (!text.trim()) throw new Error('OpenAI 응답에 내용이 없어요');
  return {
    parsed: parseObject(text),
    usage: { input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0 },
  };
}

export function createOpenaiProvider({ apiKey, model, timeoutMs = 15000, fetchImpl = fetch }) {
  return {
    name: 'openai',
    model,
    async extract({ question, text, draft }) {
      const fields = question.field === 'listing'
        ? ['sale_type', 'title', 'width_cm', 'length_cm', 'remaining_length_cm', 'material', 'thickness', 'color_family', 'has_defect', 'defect_note', 'price', 'description']
        : question.field === 'size'
          ? (draft.sale_type === 'ROLL' ? ['width_cm', 'remaining_length_cm'] : ['width_cm', 'length_cm'])
          : [question.field];
      const built = buildMessages({ fields, text, draft });
      const system = built.find((message) => message.role === 'system')?.content ?? '';
      const user = built.filter((message) => message.role === 'user').map((message) => message.content).join('\n');
      const { parsed, usage } = await complete(fetchImpl, {
        apiKey,
        model,
        timeoutMs,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      return {
        values: Object.fromEntries(fields.map((name) => [name, parsed[name] ?? null])),
        usage,
      };
    },
    async describeImage({ mediaType, data }) {
      const { parsed, usage } = await complete(fetchImpl, {
        apiKey,
        model,
        timeoutMs,
        messages: [
          { role: 'system', content: buildPhotoPrompt() },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
              { type: 'text', text: '이 원단 사진을 보고 초안을 적어 주세요.' },
            ],
          },
        ],
      });
      return {
        values: Object.fromEntries(PHOTO_FIELDS.map((name) => [name, parsed[name] ?? null])),
        usage,
      };
    },
    async describeProduct({ text, images }) {
      const built = buildListingMessages({ text });
      const content = [
        ...(images || []).map(image => ({ type: 'image_url', image_url: { url: `data:${image.media_type};base64,${image.data}` } })),
        { type: 'text', text: built[1].content },
      ];
      const { parsed, usage } = await complete(fetchImpl, {
        apiKey,
        model,
        timeoutMs,
        messages: [{ role: 'system', content: built[0].content }, { role: 'user', content }],
        maxTokens: 2500,
      });
      return {
        values: {
          title: parsed.title ?? null,
          description: parsed.description ?? null,
          color_family: parsed.color_family ?? null,
          seller_note: parsed.seller_note ?? null,
        },
        usage,
      };
    },
  };
}
