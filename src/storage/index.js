import { env } from '../config/env.js';
import { createLocalStorage } from './local.js';

// STORAGE_PROVIDER 에 따라 사진 저장소를 고른다. 클라우드 저장소를 쓰게 되면 여기에 제공자를 추가한다.
function createStorage() {
  if (env.storageProvider === 'local') {
    return createLocalStorage({ rootDir: env.uploadDir, publicUrl: env.publicUrl });
  }
  throw new Error(`지원하지 않는 STORAGE_PROVIDER: ${env.storageProvider}`);
}

export const storage = createStorage();
