import { describe, it, expect } from 'vitest';
import { friendlyError } from '../src/utils/errors';

describe('friendlyError', () => {
  it('returns the default fallback when err is null or undefined', () => {
    expect(friendlyError(null)).toMatch(/something went wrong/i);
    expect(friendlyError(undefined)).toMatch(/something went wrong/i);
  });

  it('honors a custom fallback when the error is unrecognized', () => {
    expect(friendlyError(new Error('some weird thing'), 'Quiz failed.')).toBe('Quiz failed.');
  });

  it('maps a 401 status to "API key rejected"', () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    expect(friendlyError(err)).toMatch(/api key rejected/i);
  });

  it('maps invalid-api-key messages without a status to "API key rejected"', () => {
    expect(friendlyError(new Error('invalid_api_key'))).toMatch(/api key rejected/i);
    expect(friendlyError(new Error('authentication failure'))).toMatch(/api key rejected/i);
  });

  it('maps a 403 status to an access-denied sentence', () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    expect(friendlyError(err)).toMatch(/access denied/i);
  });

  it('maps quota / billing messages to a credit-exhausted sentence', () => {
    expect(friendlyError(new Error('insufficient_quota'))).toMatch(/credit is exhausted/i);
    expect(friendlyError(new Error('credit balance is too low'))).toMatch(/credit is exhausted/i);
  });

  it('maps a 429 status (or "rate limit" text) to a retry-in-30s sentence', () => {
    const err = Object.assign(new Error('Too many requests'), { status: 429 });
    expect(friendlyError(err)).toMatch(/too many requests.*30/i);
    expect(friendlyError(new Error('rate_limit_exceeded'))).toMatch(/too many requests/i);
  });

  it('maps a 529 / 503 / "overloaded" to an overloaded sentence', () => {
    expect(friendlyError(Object.assign(new Error('overloaded'), { status: 529 }))).toMatch(/overloaded/i);
    expect(friendlyError(Object.assign(new Error('service_unavailable'), { status: 503 }))).toMatch(/overloaded/i);
  });

  it('maps content-filter messages to a softer-wording sentence', () => {
    expect(friendlyError(new Error('prohibited_content'))).toMatch(/softer wording/i);
    expect(friendlyError(new Error('content_filter triggered'))).toMatch(/softer wording/i);
  });

  it('maps a 400 (or "invalid_request") to a regenerate hint', () => {
    const err = Object.assign(new Error('bad request'), { status: 400 });
    expect(friendlyError(err)).toMatch(/try regenerating/i);
  });

  it('detects stale-client deploy errors from dynamic-import failures', () => {
    expect(friendlyError(new Error('Failed to fetch dynamically imported module: /assets/x.js'))).toMatch(/refresh the page/i);
    expect(friendlyError(new Error('MIME type of "text/html" is not executable'))).toMatch(/refresh the page/i);
  });

  it('maps network-failure phrases to a connection-check sentence', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toMatch(/network error/i);
    expect(friendlyError(new Error('ECONNRESET while reading'))).toMatch(/network error/i);
    expect(friendlyError(new Error('request timeout'))).toMatch(/network error/i);
  });

  it('maps JSON-parse failures to a regenerate hint', () => {
    expect(friendlyError(new Error('Unexpected token } in JSON at position 5'))).toMatch(/unexpected output/i);
    expect(friendlyError(new Error('malformed response'))).toMatch(/unexpected output/i);
  });

  it('catches an unknown 5xx as "provider is having issues"', () => {
    const err = Object.assign(new Error('Internal'), { status: 502 });
    expect(friendlyError(err)).toMatch(/provider is having issues/i);
  });

  it('reads status from statusCode and from a numeric code property', () => {
    const a = Object.assign(new Error('rl'), { statusCode: 429 });
    const b = Object.assign(new Error('rl'), { code: 429 });
    expect(friendlyError(a)).toMatch(/too many requests/i);
    expect(friendlyError(b)).toMatch(/too many requests/i);
  });

  it('stringifies non-Error throws', () => {
    expect(friendlyError('rate_limit exceeded')).toMatch(/too many requests/i);
    expect(friendlyError({ message: 'opaque' })).toMatch(/something went wrong/i);
  });
});
