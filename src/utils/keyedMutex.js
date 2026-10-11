// 같은 key 의 작업을 한 줄로 세운다. (예: 같은 AI 세션에 답변이 동시에 와도 하나씩 처리해서 서로의 변경을 덮어쓰지 않는다.)
// 서버 한 대 안에서만 순서를 보장한다. 여러 대로 늘리면 저장소의 조건부 갱신으로 바꿔야 한다.
const tails = new Map();

export async function withKeyLock(key, task) {
  const previous = tails.get(key) ?? Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  tails.set(key, tail);

  await previous; // 앞의 작업이 끝나길 기다린다. (앞의 작업이 실패해도 mine 은 항상 풀리므로 이 줄은 던지지 않는다)
  try {
    return await task();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key); // 더 기다리는 작업이 없으면 정리한다
  }
}
