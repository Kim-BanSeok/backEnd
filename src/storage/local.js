import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 사진을 내 컴퓨터 폴더에 저장한다. 파일은 /uploads/... 주소로 보여 준다. (app.js 의 express.static)
// 다른 저장소(클라우드)도 같은 모양(put, remove, keyOf)으로 만들면 services 를 고치지 않고 바꿀 수 있다.
export function createLocalStorage({ rootDir, publicUrl }) {
  const root = path.resolve(rootDir);

  // key 가 저장 폴더 밖을 가리키지 못하게 한다. (예: ../../secret)
  const resolveKey = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error(`잘못된 저장 경로: ${key}`);
    return full;
  };

  return {
    // 파일을 저장하고 공개 주소를 돌려준다.
    async put(key, buffer) {
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, buffer);
      return `${publicUrl}/uploads/${key}`;
    },

    // 없는 파일을 지워도 오류가 아니다.
    async remove(key) {
      await rm(resolveKey(key), { force: true });
    },

    // 공개 주소에서 저장 key 를 꺼낸다. 이 저장소의 주소가 아니면 null.
    keyOf(url) {
      try {
        const { pathname } = new URL(url);
        return pathname.startsWith('/uploads/') ? decodeURIComponent(pathname.slice('/uploads/'.length)) : null;
      } catch {
        return null;
      }
    },
  };
}
