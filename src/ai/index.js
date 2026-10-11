import { env } from '../config/env.js';
import { createFakeProvider } from './fakeProvider.js';
import { createOpenAiProvider } from './openaiProvider.js';

// AI_PROVIDER 에 따라 AI 제공자를 고른다. (fake: 개발·시험용 규칙, openai: 실제 AI)
function createProvider() {
  if (env.ai.provider === 'openai') {
    return createOpenAiProvider({ apiKey: env.ai.openaiApiKey, model: env.ai.openaiModel, timeoutMs: env.ai.timeoutMs });
  }
  return createFakeProvider();
}

let provider = createProvider();

export const getProvider = () => provider;

// 시험에서 실패하는 AI 등을 끼워 넣을 때 쓴다. 인자를 안 주면 원래 제공자로 되돌린다.
export const setProvider = (replacement) => {
  provider = replacement ?? createProvider();
};
