import { readFileSync } from 'node:fs';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

// /api-docs 에서 API 문서(Swagger UI)를 보여 준다. 문서는 명세서에서 만든 openapi.json (npm run docs:build).
export function createDocsRouter() {
  const spec = JSON.parse(readFileSync(new URL('./openapi.json', import.meta.url), 'utf8'));
  const router = Router();

  // 코드 생성기나 Postman 에 가져가기 위한 원본 파일
  router.get('/api-docs.json', (req, res) => res.json(spec));

  router.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'Material Loop API',
      swaggerOptions: {
        persistAuthorization: true, // 새로 고침해도 입력한 토큰을 유지
        docExpansion: 'none', // 처음에는 목록만 보여 준다
        displayRequestDuration: true,
      },
    }),
  );
  return router;
}
