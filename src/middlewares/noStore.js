// API와 접근 검사 대상 사진은 인증 여부·성공/실패에 관계없이 저장하지 않는다.
// 프론트 빌드의 공개 JS/CSS 등 정적 자원에는 이 정책을 적용하지 않는다.
export function noStore(_req, res, next) {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', Expires: '0' });
  next();
}
