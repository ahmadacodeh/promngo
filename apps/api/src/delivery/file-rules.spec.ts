import { describe, expect, it } from 'vitest';
import { checkFile, contentDisposition, downloadContentType, extensionOf, normalizeFileName } from './file-rules.js';

const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(8)]);

describe('checkFile — قبول الملفات السليمة', () => {
  it.each([
    ['تقرير.pdf', pdf, 'application/pdf'],
    ['a.PNG', png, 'image/png'],
    ['a.jpg', jpg, 'image/jpeg'],
    ['a.jpeg', jpg, 'image/jpeg'],
    ['a.webp', webp, 'image/webp'],
    ['ملاحظات.md', Buffer.from('# عنوان\nنص عربي ✓'), 'text/markdown'],
    ['page.html', Buffer.from('<h1>مرحبا</h1>'), 'text/html'],
    ['page.htm', Buffer.from('\uFEFF<p>BOM</p>'), 'text/html'],
  ])('%s', (name, buf, mime) => {
    const r = checkFile(name, buf);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mime).toBe(mime);
  });
});

describe('checkFile — الرفض', () => {
  it('امتداد غير مسموح أو غائب أو مزدوج', () => {
    for (const name of ['run.exe', 'a.zip', 'noext', 'a.pdf.exe', 'a.html.', '.pdf', 'a.svg', 'a.js', 'a.php']) {
      const r = checkFile(name, pdf);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.code).toBe('FILE_TYPE_NOT_ALLOWED');
    }
  });
  it('المحتوى لا يطابق الامتداد (امتداد مزيَّف)', () => {
    expect(checkFile('a.png', pdf).ok).toBe(false);
    expect(checkFile('a.pdf', png).ok).toBe(false);
    expect(checkFile('a.jpg', webp).ok).toBe(false);
    expect(checkFile('a.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])).ok).toBe(false);
    expect(checkFile('a.pdf', Buffer.from('MZ\x90\x00 تنفيذي')).ok).toBe(false);
    expect(checkFile('a.pdf', Buffer.from(' %PDF-1.4')).ok).toBe(false); // الترويسة عند البايت 0 فقط
  });
  it('النصوص: UTF-8 غير سليم أو بايت صفري ← مرفوض', () => {
    expect(checkFile('a.md', Buffer.from([0x23, 0xff, 0xfe, 0x20])).ok).toBe(false);
    expect(checkFile('a.html', Buffer.from('<p>a\0b</p>')).ok).toBe(false);
  });
  it('فارغ ← مرفوض بسبب واضح، وأكبر من 10MB ← FILE_TOO_LARGE', () => {
    const empty = checkFile('a.pdf', Buffer.alloc(0));
    expect(empty).toMatchObject({ ok: false, code: 'FILE_TYPE_NOT_ALLOWED' });
    if (!empty.ok) expect(empty.reason).toContain('فارغ');
    const big = checkFile('a.pdf', Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024)]));
    expect(big).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });
    expect(checkFile('a.pdf', Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024 - pdf.length)])).ok).toBe(true); // الحد نفسه مسموح
  });
});

describe('normalizeFileName', () => {
  it('يستعيد العربية من ترميز latin1 المشوّه', () => {
    const mojibake = Buffer.from('تقرير نهائي.pdf', 'utf8').toString('latin1');
    expect(normalizeFileName(mojibake)).toBe('تقرير نهائي.pdf');
  });
  it('لا يفسد اسمًا لاتينيًا ولا اسمًا عربيًا سليمًا أصلًا', () => {
    expect(normalizeFileName('report final.pdf')).toBe('report final.pdf');
    expect(normalizeFileName('تقرير.pdf')).toBe('تقرير.pdf');
    expect(normalizeFileName('café.pdf')).toBe('café.pdf'); // لاتيني ممتد لا يُنتج UTF-8 سليمًا فيبقى كما هو
  });
  it('يزيل مسارات المجلدات والمحارف التحكمية ومحارف قلب الاتجاه (تزييف الامتداد)', () => {
    expect(normalizeFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(normalizeFileName('C:\\Users\\a\\b.png')).toBe('b.png');
    expect(normalizeFileName('a\r\nb.pdf')).toBe('ab.pdf');
    expect(normalizeFileName('gpj\u202Etxt.exe')).toBe('gpjtxt.exe');
    expect(checkFile('doc\u202Efdp.exe', pdf).ok).toBe(false);
  });
  it('يقصّ الطول مع الإبقاء على الامتداد', () => {
    const out = normalizeFileName('x'.repeat(500) + '.pdf');
    expect(out).toHaveLength(200);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('extensionOf / downloadContentType / contentDisposition', () => {
  it('extensionOf حساس للامتداد الأخير فقط وغير حساس للحالة', () => {
    expect(extensionOf('A.PdF')).toBe('pdf');
    expect(extensionOf('a.tar.pdf')).toBe('pdf');
    expect(extensionOf('a.')).toBeNull();
    expect(extensionOf('pdf')).toBeNull();
  });
  it('النصوص تُقدَّم بترميز صريح والباقي كما هو', () => {
    expect(downloadContentType('text/html')).toBe('text/html; charset=utf-8');
    expect(downloadContentType('application/pdf')).toBe('application/pdf');
  });
  it('Content-Disposition: attachment، بديل ASCII، وfilename* يحفظ العربية، بلا حقن ترويسات', () => {
    const h = contentDisposition('تقرير نهائي.pdf');
    expect(h).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.pdf"; filename\*=UTF-8''/);
    expect(decodeURIComponent(h.split("UTF-8''")[1]!)).toBe('تقرير نهائي.pdf');
    const evil = contentDisposition('a"\r\nSet-Cookie: x=1.pdf');
    expect(evil).not.toMatch(/[\r\n]/);
    expect(evil.match(/"/g)).toHaveLength(2); // علامتا اقتباس فقط (حول البديل ASCII)
  });
});
