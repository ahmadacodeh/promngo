import { FILE_LIMITS } from '../work/model.js';

/** قاعدة مرفقات التسليم (قرار §10-4): قائمة امتدادات مسموحة + تحقق من محتوى الملف الفعلي لا من اسمه وحده. */
export const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'md', 'html', 'htm'] as const;
export type AllowedExt = (typeof ALLOWED_EXTENSIONS)[number];

export const MIME_BY_EXT: Record<AllowedExt, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
};

const TEXT_EXTS: readonly AllowedExt[] = ['md', 'html', 'htm'];

/** نوع المحتوى عند التنزيل (النصوص مع ترميز صريح). */
export const downloadContentType = (mime: string): string => (mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime);

export interface FileCheckOk {
  ok: true;
  ext: AllowedExt;
  mime: string;
  fileName: string;
  size: number;
}
export interface FileCheckFail {
  ok: false;
  code: 'FILE_TOO_LARGE' | 'FILE_TYPE_NOT_ALLOWED';
  reason: string;
  fileName: string;
}

export function extensionOf(name: string): AllowedExt | null {
  const i = name.lastIndexOf('.');
  if (i < 1 || i === name.length - 1) return null; // لا اسم أساسيًا (.pdf) أو لا امتداد (a.)
  const ext = name.slice(i + 1).toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as AllowedExt) : null;
}

/** محارف تحكم (C0 وDEL) ومحارف تحكم الاتجاه التي تُستعمل لتزييف الامتداد الظاهر. */
const isUnsafeChar = (n: number): boolean =>
  n <= 0x1f ||
  n === 0x7f ||
  n === 0x200e ||
  n === 0x200f ||
  (n >= 0x202a && n <= 0x202e) ||
  (n >= 0x2066 && n <= 0x2069);

/**
 * multer يقرأ اسم الملف كـ latin1: العربية تصل مشوّهة (mojibake). نعيد ترميزها إلى UTF-8 إن كانت كل
 * محارفها ≤ 0xFF وأنتجت UTF-8 سليمًا؛ ثم نزيل مسارات المجلدات والمحارف التحكمية ومحارف الاتجاه
 * (تُستعمل لتزييف الامتداد) ونقصّ الطول مع الإبقاء على الامتداد.
 */
export function normalizeFileName(raw: string): string {
  let name = raw;
  if ([...raw].every((c) => c.charCodeAt(0) <= 0xff)) {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    if (!decoded.includes('�')) name = decoded;
  }
  name = name.replace(/^.*[\\/]/, '');
  name = [...name].filter((ch) => !isUnsafeChar(ch.codePointAt(0) ?? 0)).join('').trim();
  if (name.length > 200) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name;
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean => bytes.every((b, i) => buf[offset + i] === b);

function contentMatches(ext: AllowedExt, buf: Buffer): boolean {
  switch (ext) {
    case 'pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'webp':
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8); // RIFF....WEBP
    default: {
      if (buf.includes(0)) return false; // نص بلا بايتات صفرية وبترميز UTF-8 سليم
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buf);
        return true;
      } catch {
        return false;
      }
    }
  }
}

export function checkFile(rawName: string, buf: Buffer): FileCheckOk | FileCheckFail {
  const fileName = normalizeFileName(rawName);
  const fail = (code: FileCheckFail['code'], reason: string): FileCheckFail => ({ ok: false, code, reason, fileName: fileName || '—' });
  if (buf.length === 0) return fail('FILE_TYPE_NOT_ALLOWED', `الملف «${fileName}» فارغ.`);
  if (buf.length > FILE_LIMITS.maxBytes) return fail('FILE_TOO_LARGE', `الملف «${fileName}» أكبر من 10 ميغابايت.`);
  const ext = extensionOf(fileName);
  if (!ext) return fail('FILE_TYPE_NOT_ALLOWED', `نوع الملف «${fileName}» غير مسموح. المسموح: ${ALLOWED_EXTENSIONS.join('، ')}.`);
  if (!contentMatches(ext, buf)) {
    const kind = TEXT_EXTS.includes(ext) ? 'نص UTF-8 سليم' : 'ملف بصيغة .' + ext;
    return fail('FILE_TYPE_NOT_ALLOWED', `محتوى «${fileName}» لا يطابق امتداده (المتوقع ${kind}).`);
  }
  return { ok: true, ext, mime: MIME_BY_EXT[ext], fileName, size: buf.length };
}

/** اسم آمن لترويسة Content-Disposition: بديل ASCII + filename* وفق RFC 5987 (يحفظ العربية). */
export function contentDisposition(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot).replace(/[^A-Za-z0-9.]/g, '') : '';
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 80) || 'file';
  const star = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${base}${ext}"; filename*=UTF-8''${star}`;
}
