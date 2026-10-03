/**
 * Text utility functions for WCAG 2.1 AAA Accessibility and Content Sanitization.
 */

/**
 * Strips all Unicode emojis, emoticons, pictographs, symbols, dingbats,
 * and variation selectors to ensure 100% WCAG 2.1 AAA screen reader friendliness.
 */
export function stripEmojis(text: string): string {
  if (!text) return '';
  return text
    // Strip Unicode Emoji presentation, symbols, pictographs, flags, enclosed alphanumerics
    .replace(
      /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B06}\u{2934}\u{2935}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{FE0E}\u{FE0F}\u{200D}]/gu,
      ''
    )
    // Normalize spaces left by removed emojis
    .replace(/[ \t]{2,}/g, ' ')
    // Normalize trailing spaces on empty lines
    .replace(/\n[ \t]+\n/g, '\n\n')
    .trim();
}

/**
 * Escapes HTML special characters for safe Telegram HTML and Web Dashboard rendering.
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Validates that a URL is a legitimate public HTTP or HTTPS web address.
 * Defends against Server-Side Request Forgery (SSRF) and local file inclusion.
 */
export function isValidPublicHttpUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const url = new URL(urlString.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    const host = url.hostname.toLowerCase();
    // Block localhost, link-local, loopback, private RFC1918 subnets, AWS/GCP metadata IP
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes output text to prevent secret exfiltration / prompt injection leaks.
 */
export function sanitizeSecretLeaks(text: string, secrets: (string | undefined | null)[]): string {
  if (!text) return '';
  let sanitized = text;
  for (const s of secrets) {
    if (s && s.length >= 8) {
      // Replace secret substring with [REDACTED]
      sanitized = sanitized.split(s).join('[REDACTED_SECRET]');
    }
  }
  return sanitized;
}
