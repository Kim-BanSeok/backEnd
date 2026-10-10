// 명세서(docs/API_명세서_v0.3.md)에서 Swagger 문서(src/docs/openapi.json)를 만든다. (npm run docs:build)
import { readFile, writeFile } from 'node:fs/promises';
import { buildOpenApi } from '../src/docs/buildOpenApi.js';

const source = new URL('../docs/API_명세서_v0.3.md', import.meta.url);
const target = new URL('../src/docs/openapi.json', import.meta.url);

const spec = buildOpenApi(await readFile(source, 'utf8'));
await writeFile(target, JSON.stringify(spec, null, 2) + '\n');

const operations = Object.values(spec.paths).flatMap((methods) => Object.values(methods));
console.log(`openapi.json 생성: 경로 ${Object.keys(spec.paths).length}개, API ${operations.length}개`);
