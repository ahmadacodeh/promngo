/**
 * TypeORM + pg: `query()` يعيد الصفوف مباشرة في SELECT/INSERT، لكن `[rows, affectedCount]` في
 * UPDATE/DELETE ... RETURNING. هذا المساعد يوحّد الشكل حتى لا يُقرأ الطول أو الصف الأول خطأً
 * (كان حارس «صفر صفوف محدَّثة» لا يعمل أبدًا لأن الطول دائمًا 2).
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as T[];
  }
  return result as T[];
}
