export function required<T>(value: T | null | undefined, message = '필수 데이터가 없습니다.'): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
