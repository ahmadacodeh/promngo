import { describe, expect, it } from 'vitest';
import { rowsOf } from './db.js';

describe('rowsOf', () => {
  it('يفك الصيغة [rows, count] الخاصة بـ UPDATE/DELETE ... RETURNING', () => {
    expect(rowsOf([[{ id: 'a' }, { id: 'b' }], 2])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  it('صفر صفوف محدَّثة ← مصفوفة فارغة (لا الطول 2)', () => {
    expect(rowsOf([[], 0])).toEqual([]);
    expect(rowsOf([[], 0])).toHaveLength(0);
  });
  it('نتيجة SELECT/INSERT تبقى كما هي حتى لو كان فيها صفان بالضبط', () => {
    const two = [{ id: 'a' }, { id: 'b' }];
    expect(rowsOf(two)).toBe(two);
    expect(rowsOf([])).toEqual([]);
  });
});
