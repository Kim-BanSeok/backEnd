// 성공 응답은 항상 { success: true, data } 모양으로 보낸다.
export const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

// 날짜는 한국 시간 ISO 8601 로 응답한다. 예: 2026-10-14T15:00:00+09:00
export const toKstIso = (date) => {
  if (!date) return null;
  const kst = new Date(new Date(date).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace(/\.\d{3}Z$/, '+09:00');
};
