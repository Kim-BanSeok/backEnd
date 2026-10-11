import { buildMessages } from './prompts.js';

// OpenAI Chat Completions 로 판매자의 답에서 값을 뽑는다. (JSON 모드)
// 실패(네트워크, 시간 초과, 오류 응답, 형식 오류)는 오류를 던진다. 다시 시도하고 503 AI_UNAVAILABLE 로 바꾸는 것은 services 가 한다.
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export function createOpenAiProvider({ apiKey, model, timeoutMs = 15000, fetchImpl = fetch }) {
  return {
    name: 'openai',
    model,
    async extract({ question, text, draft }) {
      const fields = question.field === 'size'
        ? (draft.sale_type === 'ROLL' ? ['width_cm', 'remaining_length_cm'] : ['width_cm', 'length_cm'])
        : [question.field];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: buildMessages({ fields, text, draft }),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`OpenAI 응답 오류 ${response.status}`);

      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('OpenAI 응답에 내용이 없어요');
      const parsed = JSON.parse(content); // 형식이 깨졌으면 여기서 오류
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('OpenAI 응답이 JSON 객체가 아니에요');

      // 요청한 항목만 받는다. 목록 밖의 값인지는 flow.js 가 항목마다 검사한다.
      return {
        values: Object.fromEntries(fields.map((name) => [name, parsed[name] ?? null])),
        usage: { input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
