/**
 * Token encryption utilities
 * In production, use proper encryption libraries like crypto-js or node:crypto
 */

/**
 * Encrypt a token for storage
 * This is a placeholder implementation - use proper encryption in production
 */
export function encryptToken(token: string): string {
  // In production, use proper encryption with a secret key
  // For now, just prefix to indicate it's "encrypted"
  return `encrypted:${token}`;
}

/**
 * Decrypt a token for use
 * This is a placeholder implementation - use proper decryption in production
 */
export function decryptToken(encryptedToken: string): string {
  // In production, use proper decryption with a secret key
  // For now, just remove the prefix
  return encryptedToken.replace("encrypted:", "");
}

/**
 * Check if a token is encrypted
 */
export function isTokenEncrypted(token: string): boolean {
  return token.startsWith("encrypted:");
}

/**
 * Validate GitHub token format
 */
export function isValidGitHubToken(token: string): boolean {
  // GitHub personal access tokens start with 'ghp_' or 'gho_'
  // OAuth tokens are typically longer alphanumeric strings
  return token.length > 20 && /^[a-zA-Z0-9_]+$/.test(token);
}