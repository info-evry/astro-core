import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  truncateText,
  formatCurrency,
  formatDate,
  formatTime,
  formatDateTime
} from '../src/lib/formatting.js';

describe('escapeHtml', () => {
  it('escapes HTML entities', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("'single'")).toBe('&#039;single&#039;');
  });

  it('handles empty/null input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('converts numbers to strings', () => {
    expect(escapeHtml(123)).toBe('123');
  });
});

describe('truncateText', () => {
  it('truncates long text', () => {
    expect(truncateText('hello world', 6)).toBe('hello…');
  });

  it('preserves short text', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('handles empty input', () => {
    expect(truncateText('')).toBe('');
    expect(truncateText(null)).toBe('');
  });

  it('uses default max length of 40', () => {
    const longString = 'a'.repeat(50);
    expect(truncateText(longString).length).toBe(40);
  });
});

describe('formatCurrency', () => {
  it('formats cents to EUR', () => {
    const result = formatCurrency(1500);
    expect(result).toMatch(/15[,.]00/);
    expect(result).toContain('€');
  });

  it('handles zero', () => {
    const result = formatCurrency(0);
    expect(result).toMatch(/0[,.]00/);
  });

  it('handles invalid input', () => {
    expect(formatCurrency('abc')).toBe('0,00 €');
    expect(formatCurrency(NaN)).toBe('0,00 €');
  });

  it('supports custom locale and currency', () => {
    const result = formatCurrency(1000, 'en-US', 'USD');
    expect(result).toContain('$');
  });
});

describe('formatDate', () => {
  it('formats date objects', () => {
    const date = new Date('2025-01-15T12:00:00Z');
    const result = formatDate(date);
    expect(result).toContain('2025');
    expect(result).toContain('15');
  });

  it('formats date strings', () => {
    const result = formatDate('2025-01-15');
    expect(result).toContain('2025');
  });

  it('returns dash for empty input', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate('')).toBe('-');
  });

  it('returns dash for invalid date', () => {
    expect(formatDate('invalid')).toBe('-');
  });
});

describe('formatTime', () => {
  it('formats time from date', () => {
    const date = new Date('2025-01-15T14:30:00Z');
    const result = formatTime(date);
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it('returns dash for empty input', () => {
    expect(formatTime(null)).toBe('-');
    expect(formatTime('')).toBe('-');
  });
});

describe('formatDateTime', () => {
  it('formats date and time', () => {
    const date = new Date('2025-01-15T14:30:00Z');
    const result = formatDateTime(date);
    expect(result).toContain('2025');
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it('returns dash for empty input', () => {
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime('')).toBe('-');
  });
});
