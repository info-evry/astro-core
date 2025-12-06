/**
 * Shared formatting utilities
 * Works in both browser and server environments
 */

/**
 * Escape HTML entities to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Truncate text to a maximum length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length (default: 40)
 * @returns {string} Truncated string
 */
export function truncateText(str, maxLength = 40) {
  if (!str || str.length <= maxLength) return str || '';
  return str.slice(0, Math.max(0, maxLength - 1)) + '…';
}

/**
 * Format currency in cents to display format
 * @param {number} cents - Amount in cents
 * @param {string} locale - Locale for formatting (default: 'fr-FR')
 * @param {string} currency - Currency code (default: 'EUR')
 * @returns {string} Formatted currency string
 */
export function formatCurrency(cents, locale = 'fr-FR', currency = 'EUR') {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '0,00 €';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  }).format(cents / 100);
}

/**
 * Format date to locale string
 * @param {string|Date} date - Date to format
 * @param {string} locale - Locale for formatting (default: 'fr-FR')
 * @returns {string} Formatted date string
 */
export function formatDate(date, locale = 'fr-FR') {
  if (!date) return '-';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Format time to locale string (HH:MM)
 * @param {string|Date} date - Date to format
 * @param {string} locale - Locale for formatting (default: 'fr-FR')
 * @returns {string} Formatted time string
 */
export function formatTime(date, locale = 'fr-FR') {
  if (!date) return '-';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format datetime to locale string
 * @param {string|Date} date - Date to format
 * @param {string} locale - Locale for formatting (default: 'fr-FR')
 * @returns {string} Formatted datetime string
 */
export function formatDateTime(date, locale = 'fr-FR') {
  if (!date) return '-';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
