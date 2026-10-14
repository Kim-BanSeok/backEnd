import { createRequire } from 'node:module';

// Node 빌드는 기존 XLS 공장 자료의 문자 인코딩과 파일 기능을 함께 제공한다.
const XLSX = createRequire(import.meta.url)('xlsx');
export default XLSX;
