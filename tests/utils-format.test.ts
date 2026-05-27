import { describe, it, expect } from 'vitest';
import { slugify, extractHtml, parseJson } from '../src/utils/format';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric runs with hyphens', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('---foo bar---')).toBe('foo-bar');
  });

  it('collapses repeated separators into a single hyphen', () => {
    expect(slugify('foo   ___   bar')).toBe('foo-bar');
  });

  it('clips the result at 40 characters', () => {
    const long = 'a'.repeat(80);
    const out = slugify(long);
    expect(out).toHaveLength(40);
    expect(out).toBe('a'.repeat(40));
  });

  it('returns an empty string when the input has no alphanumerics', () => {
    expect(slugify('!!! ??? ...')).toBe('');
  });
});

describe('extractHtml', () => {
  it('unwraps a ```html fenced block', () => {
    const input = 'Sure, here is the page:\n```html\n<!DOCTYPE html><html><body>hi</body></html>\n```\nLet me know!';
    expect(extractHtml(input)).toBe('<!DOCTYPE html><html><body>hi</body></html>');
  });

  it('returns text untouched when it already starts with <!DOCTYPE', () => {
    const input = '<!DOCTYPE html><html><body>x</body></html>';
    expect(extractHtml(input)).toBe(input);
  });

  it('returns text untouched when it already starts with <html', () => {
    const input = '<html><body>x</body></html>';
    expect(extractHtml(input)).toBe(input);
  });

  it('clips trailing prose after </html>', () => {
    const input = 'Here you go: <html><body>hi</body></html>\n\nNotes about the doc.';
    expect(extractHtml(input)).toBe('<html><body>hi</body></html>');
  });

  it('clips leading prose before <!DOCTYPE', () => {
    const input = 'Preface…\n<!DOCTYPE html><html><body>hi</body></html>';
    expect(extractHtml(input)).toBe('<!DOCTYPE html><html><body>hi</body></html>');
  });

  it('falls back to the original string when no HTML markers are present', () => {
    expect(extractHtml('plain text response')).toBe('plain text response');
  });

  it('returns text from start marker to end of string when </html> is missing', () => {
    const input = 'Header text. <!DOCTYPE html><html><body>still streaming';
    expect(extractHtml(input)).toBe('<!DOCTYPE html><html><body>still streaming');
  });
});

describe('parseJson', () => {
  it('parses a clean array out of plain text', () => {
    expect(parseJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('parses an object when wrapType is "{"', () => {
    expect(parseJson('{"a": 1}', '{')).toEqual({ a: 1 });
  });

  it('unwraps a ```json fenced block', () => {
    const text = "Here's the data:\n```json\n[{\"x\": 1}]\n```";
    expect(parseJson(text)).toEqual([{ x: 1 }]);
  });

  it('unwraps an unlabeled ``` fenced block', () => {
    const text = '```\n[1, 2]\n```';
    expect(parseJson(text)).toEqual([1, 2]);
  });

  it('strips prose before and after the JSON payload', () => {
    const text = 'Sure, here it is: [1, 2, 3]. Hope that helps.';
    expect(parseJson(text)).toEqual([1, 2, 3]);
  });

  it('tolerates trailing commas in arrays and objects', () => {
    expect(parseJson('[1, 2, 3,]')).toEqual([1, 2, 3]);
    expect(parseJson('{"a": 1, "b": 2,}', '{')).toEqual({ a: 1, b: 2 });
  });

  it('throws when the payload is unrepairable JSON', () => {
    expect(() => parseJson('not json at all', '{')).toThrow();
  });
});
