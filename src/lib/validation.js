/**
 * Shared validation utilities
 * Works in both browser and server environments (no DOM dependencies)
 */

/**
 * Validate email format
 * Uses a simple pattern that avoids ReDoS vulnerability
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  // Limit length to prevent ReDoS
  if (trimmed.length > 254) return false;
  // Basic email check - simple indexOf-based validation
  const atIndex = trimmed.indexOf('@');
  if (atIndex < 1) return false;
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= atIndex + 1 || dotIndex === trimmed.length - 1) return false;
  // No spaces allowed
  if (trimmed.includes(' ')) return false;
  return true;
}

/**
 * Sanitize string input - trim and limit length
 * @param {string} str - String to sanitize
 * @param {number} maxLength - Maximum length (default: 256)
 * @returns {string} Sanitized string
 */
export function sanitizeString(str, maxLength = 256) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().slice(0, Math.max(0, maxLength));
}

/**
 * Parse and validate integer with bounds
 * @param {*} value - Value to parse
 * @param {number} min - Minimum value (default: 0)
 * @param {number} max - Maximum value (default: Infinity)
 * @param {number} defaultValue - Default if invalid (default: 0)
 * @returns {number} Parsed integer or default
 */
export function parseInteger(value, min = 0, max = Infinity, defaultValue = 0) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return defaultValue;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

/**
 * Check if deadline has passed
 * @param {string|Date} deadline - Deadline datetime
 * @param {Date} now - Current time (optional, for testing)
 * @returns {boolean} True if deadline has passed
 */
export function isDeadlinePassed(deadline, now = new Date()) {
  if (!deadline) return false;
  const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(deadlineDate.getTime())) return false;
  return now >= deadlineDate;
}

/**
 * Check if time is after cutoff (HH:MM format)
 * @param {string} cutoffTime - Cutoff time in HH:MM format
 * @param {Date} now - Current time (optional, for testing)
 * @returns {boolean} True if after cutoff
 */
export function isAfterCutoff(cutoffTime, now = new Date()) {
  if (!cutoffTime) return false;
  const parts = cutoffTime.split(':');
  if (parts.length !== 2) return false;
  const hours = Number.parseInt(parts[0], 10);
  const minutes = Number.parseInt(parts[1], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const cutoff = new Date(now);
  cutoff.setHours(hours, minutes, 0, 0);
  return now >= cutoff;
}
