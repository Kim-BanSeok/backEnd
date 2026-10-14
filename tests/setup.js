// 모든 테스트 파일보다 먼저 실행된다. (node --import ./tests/setup.js)
// .env 의 NODE_ENV=development 보다 우선해서, 테스트가 항상 _test DB 를 쓰게 한다.
process.env.NODE_ENV = 'test';
// .env 가 openai 여도 시험은 가짜 AI 를 쓴다. 실제 키로 호출하지 않는다.
process.env.AI_PROVIDER = 'fake';
