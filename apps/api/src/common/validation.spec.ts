import { IsEmail, IsNotEmpty, IsString, validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ApiException } from './api-exception.js';
import { validationExceptionFactory } from './validation.js';

class Dto {
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() password!: string;
}

describe('validationExceptionFactory', () => {
  it('يبني VALIDATION_FAILED برسالة عربية لكل حقل', () => {
    const d = Object.assign(new Dto(), { email: 'x', password: '' });
    const ex = validationExceptionFactory(validateSync(d));
    expect(ex).toBeInstanceOf(ApiException);
    const body = ex.getResponse() as { code: string; details?: { fields?: Record<string, string> }; fields?: Record<string, string> };
    expect(body.code).toBe('VALIDATION_FAILED');
    const fields = body.details?.fields ?? body.fields!;
    expect(fields.email).toMatch(/[؀-ۿ]/);
    expect(fields.password).toMatch(/[؀-ۿ]/);
  });
});
