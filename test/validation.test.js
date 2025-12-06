import { describe, it, expect } from 'vitest';
import {
  isValidEmail,
  sanitizeString,
  parseInteger,
  isDeadlinePassed,
  isAfterCutoff
} from '../src/lib/validation.js';

describe('isValidEmail', () => {
  it('validates correct emails', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name@domain.org')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('invalid')).toBe(false);
    expect(isValidEmail('@domain.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('user@domain')).toBe(false);
    expect(isValidEmail('user@domain.')).toBe(false);
    expect(isValidEmail('user @domain.com')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(123)).toBe(false);
  });

  it('rejects emails over 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@b.co';
    expect(isValidEmail(longEmail)).toBe(false);
  });

  it('trims whitespace', () => {
    expect(isValidEmail('  test@example.com  ')).toBe(true);
  });
});

describe('sanitizeString', () => {
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('limits length', () => {
    expect(sanitizeString('hello world', 5)).toBe('hello');
  });

  it('handles non-strings', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
    expect(sanitizeString(123)).toBe('');
  });

  it('uses default max length of 256', () => {
    const longString = 'a'.repeat(300);
    expect(sanitizeString(longString).length).toBe(256);
  });
});

describe('parseInteger', () => {
  it('parses valid integers', () => {
    expect(parseInteger('42')).toBe(42);
    expect(parseInteger(42)).toBe(42);
    expect(parseInteger('0')).toBe(0);
  });

  it('applies min/max bounds', () => {
    expect(parseInteger('5', 10)).toBe(10);
    expect(parseInteger('100', 0, 50)).toBe(50);
    expect(parseInteger('25', 10, 50)).toBe(25);
  });

  it('returns default for invalid input', () => {
    expect(parseInteger('abc')).toBe(0);
    expect(parseInteger('abc', 0, 100, 50)).toBe(50);
    expect(parseInteger(null)).toBe(0);
    expect(parseInteger(undefined)).toBe(0);
  });
});

describe('isDeadlinePassed', () => {
  it('returns false for future deadline', () => {
    const future = new Date(Date.now() + 86400000);
    expect(isDeadlinePassed(future)).toBe(false);
  });

  it('returns true for past deadline', () => {
    const past = new Date(Date.now() - 86400000);
    expect(isDeadlinePassed(past)).toBe(true);
  });

  it('handles string dates', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(isDeadlinePassed(past)).toBe(true);
  });

  it('returns false for empty deadline', () => {
    expect(isDeadlinePassed(null)).toBe(false);
    expect(isDeadlinePassed('')).toBe(false);
  });

  it('returns false for invalid date', () => {
    expect(isDeadlinePassed('invalid')).toBe(false);
  });

  it('accepts custom now parameter', () => {
    const deadline = new Date('2025-01-15T12:00:00Z');
    const before = new Date('2025-01-14T12:00:00Z');
    const after = new Date('2025-01-16T12:00:00Z');
    expect(isDeadlinePassed(deadline, before)).toBe(false);
    expect(isDeadlinePassed(deadline, after)).toBe(true);
  });
});

describe('isAfterCutoff', () => {
  it('returns true after cutoff time', () => {
    const now = new Date('2025-01-15T20:00:00');
    expect(isAfterCutoff('19:00', now)).toBe(true);
  });

  it('returns false before cutoff time', () => {
    const now = new Date('2025-01-15T18:00:00');
    expect(isAfterCutoff('19:00', now)).toBe(false);
  });

  it('returns false for empty cutoff', () => {
    expect(isAfterCutoff(null)).toBe(false);
    expect(isAfterCutoff('')).toBe(false);
  });

  it('returns false for invalid time format', () => {
    expect(isAfterCutoff('invalid')).toBe(false);
    expect(isAfterCutoff('25:00')).toBe(false);
  });
});
