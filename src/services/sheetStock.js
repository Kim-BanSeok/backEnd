// 자투리 장수. sheet_count 는 남은 전체(확보분 포함)이고 reserved_sheet_count 는 수락으로 잡아 둔 장수다.
// 예전 데이터는 장수 칸이 비어 있고, 수락 예약만 있는 경우에는 한 장 전체가 예약된 것으로 본다.

export function scrapStock(fabric, detail, acceptedCount = 0) {
  const total = Number.isInteger(detail?.sheet_count) ? detail.sheet_count : 1;
  const held = fabric?.reserved_sheet_count || 0;
  const legacyFull = held === 0 && acceptedCount > 0;
  const available = legacyFull ? 0 : Math.max(0, total - held);
  return {
    total,
    held: legacyFull ? total : held,
    available,
    isReserved: available < 1 && (held > 0 || legacyFull),
  };
}
