import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/index.js', () => ({ config: { NODE_ENV: 'test' } }));
vi.mock('../src/lib/failureReporter.js', () => ({ reportBackendError: vi.fn() }));

import { Errors, errorHandler } from '../src/middleware/errorHandler.js';

describe('Errors: stable codes', () => {
  it('keeps the generic codes and messages when no specific code is given (old clients unchanged)', () => {
    expect(Errors.notFound('Recording')).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Recording not found' });
    expect(Errors.internal('x')).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'x' });
    expect(Errors.unprocessable('x', { a: 'b' })).toMatchObject({ statusCode: 422, code: 'UNPROCESSABLE_ENTITY', details: { a: 'b' } });
    expect(Errors.badRequest('x')).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
    expect(Errors.conflict('x')).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('carries a specific code and still keeps the English message', () => {
    const e = Errors.unprocessable('Recording transcript is empty', undefined, 'TRANSCRIPT_EMPTY');
    expect(e).toMatchObject({ statusCode: 422, code: 'TRANSCRIPT_EMPTY', message: 'Recording transcript is empty' });
    expect(Errors.notFound('Todo not found', 'TODO_NOT_FOUND').code).toBe('TODO_NOT_FOUND');
  });

  it('serialises code and message in the error envelope', () => {
    const json = vi.fn();
    const res: any = { locals: {}, status: vi.fn(() => ({ json })) };
    errorHandler(Errors.internal('Failed to process question', 'QA_FAILED'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: { code: 'QA_FAILED', message: 'Failed to process question', details: undefined } });
  });
});
