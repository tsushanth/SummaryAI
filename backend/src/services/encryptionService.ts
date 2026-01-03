/**
 * Encryption Service
 * Simple AES-256-GCM encryption for storing tokens securely
 */

import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from config
 * Falls back to a derived key from SUPABASE_SERVICE_ROLE_KEY if ENCRYPTION_KEY not set
 */
function getEncryptionKey(): Buffer {
  if (config.ENCRYPTION_KEY) {
    // Use provided 32-byte key
    const key = Buffer.from(config.ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
    }
    return key;
  }

  // Fallback: derive key from service role key using SHA-256
  console.warn('[Encryption] ENCRYPTION_KEY not set, deriving from SUPABASE_SERVICE_ROLE_KEY');
  return crypto
    .createHash('sha256')
    .update(config.SUPABASE_SERVICE_ROLE_KEY)
    .digest();
}

/**
 * Encrypt a string (typically an OAuth token)
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex-encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string (typically an OAuth token)
 */
export function decryptToken(ciphertext: string): string {
  const key = getEncryptionKey();

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(parts[0]!, 'hex');
  const authTag = Buffer.from(parts[1]!, 'hex');
  const encrypted = parts[2]!;

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a new encryption key (for initial setup)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
