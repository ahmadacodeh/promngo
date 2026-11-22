import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanyDto } from '@/api/types';
import { authResponse, flushPromises, freshApp, jsonResponse, mockFetch, mountView } from '@/test/utils';
import CompanyView from './CompanyView.vue';

afterEach(() => vi.unstubAllGlobals());
const CO: CompanyDto = { id: 'c1', name: 'شركة ألفا', slug: 'alpha', status: 'ACTIVE', createdAt: '2026-11-20T05:00:00Z' };

describe('CompanyView', () => {
  it('يعرض البيانات، والحفظ معطّل بلا تغيير، والاسم الفارغ مرفوض محليًا، ثم PATCH بالاسم المقصوص ويُحدّث الجلسة', async () => {
    const patches: unknown[] = [];
    mockFetch((url, init) => {
      if (init.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        return jsonResponse(200, { ...CO, name: body.name });
      }
      return jsonResponse(200, CO);
    });
    const ctx = freshApp();
    ctx.auth.apply(authResponse());
    const w = await mountView(CompanyView, { router: ctx.router, path: '/company' });
    expect(w.text()).toContain('alpha');
    expect(w.text()).toContain('نشطة');
    const btn = () => w.findAll('button').find((b) => b.text().includes('حفظ الاسم'))!;
    expect(btn().attributes('disabled')).toBeDefined();
    await w.find('input').setValue('   ');
    await w.find('form').trigger('submit');
    expect(w.text()).toContain('اسم الشركة مطلوب.');
    expect(patches).toHaveLength(0);
    await w.find('input').setValue('  شركة ألفا الجديدة ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(patches).toEqual([{ name: 'شركة ألفا الجديدة' }]);
    expect(ctx.auth.company?.name).toBe('شركة ألفا الجديدة');
  });
});
