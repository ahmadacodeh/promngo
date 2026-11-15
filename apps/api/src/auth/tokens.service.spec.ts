import { describe, expect, it } from 'vitest';
import { safeEqualHex, sha256Hex } from './tokens.service.js';

describe('sha256Hex / safeEqualHex', () => {
  it('SHA-256 معروف', () => expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
  it('يساوي ويخالف', () => {
    expect(safeEqualHex(sha256Hex('a'), sha256Hex('a'))).toBe(true);
    expect(safeEqualHex(sha256Hex('a'), sha256Hex('b'))).toBe(false);
  });
  it('أطوال مختلفة أو فارغة أو غير hex لا ترمي وتعيد false', () => {
    expect(safeEqualHex('ab', 'abcd')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqualHex('zz', 'zz')).toBe(false);
  });
});
