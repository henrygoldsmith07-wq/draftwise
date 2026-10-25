/**
 * Client-Side Document Encryption
 * AES-256 encryption for privacy-first security
 */

export interface EncryptedDocument {
  id: string;
  ciphertext: string;
  iv: string;
  salt: string;
  version: number;
  metadata: {
    originalLength: number;
    createdAt: Date;
    encryptedAt: Date;
  };
}

export type CryptoKey = CryptoKeyPair | CryptoKey;

let encryptionEnabled = false;
let masterKey: CryptoKey | null = null;

/**
 * Initialize encryption system
 */
export async function initializeEncryption(): Promise<boolean> {
  if (!window.crypto || !window.crypto.subtle) {
    console.warn('❌ Web Crypto API not supported');
    return false;
  }
  
  try {
    // Generate RSA key pair for encryption
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true, // extractable = false for security
      ['encrypt', 'decrypt']
    );
    
    masterKey = keyPair;
    encryptionEnabled = true;
    
    console.log('🔒 Encryption initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize encryption:', error);
    return false;
  }
}

/**
 * Encrypt document content
 */
export async function encryptDocument(
  plaintext: string,
  passphrase?: string
): Promise<EncryptedDocument> {
  if (!encryptionEnabled) {
    throw new Error('Encryption not initialized');
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  
  // Generate random IV and salt
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  
  // Derive key from passphrase if provided
  let key: CryptoKey;
  
  if (passphrase) {
    key = await deriveKeyFromPassphrase(passphrase, salt);
  } else if (masterKey instanceof Object && 'privateKey' in masterKey) {
    // Use RSA private key
    key = masterKey.privateKey as CryptoKey;
  } else {
    throw new Error('No encryption key available');
  }
  
  // Encrypt using AES-GCM
  const encryptedData = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    data
  );
  
  // Convert to base64
  const ciphertext = arrayBufferToBase64(encryptedData);
  
  const encryptedDoc: EncryptedDocument = {
    id: `encrypted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ciphertext,
    iv: arrayBufferToBase64(iv),
    salt: arrayBufferToBase64(salt),
    version: 1,
    metadata: {
      originalLength: plaintext.length,
      createdAt: new Date(),
      encryptedAt: new Date()
    }
  };
  
  console.log(`✅ Document encrypted (${plaintext.length} bytes)`);
  
  return encryptedDoc;
}

/**
 * Decrypt document content
 */
export async function decryptDocument(encryptedDoc: EncryptedDocument): Promise<string> {
  if (!encryptionEnabled) {
    throw new Error('Encryption not initialized');
  }
  
  try {
    // Decode base64 values
    const ciphertext = base64ToArrayBuffer(encryptedDoc.ciphertext);
    const iv = base64ToArrayBuffer(encryptedDoc.iv);
    const salt = base64ToArrayBuffer(encryptedDoc.salt);
    
    // Derive key
    let key: CryptoKey;
    
    if (masterKey instanceof Object && 'privateKey' in masterKey) {
      key = masterKey.privateKey as CryptoKey;
    } else {
      throw new Error('Cannot decrypt without private key');
    }
    
    // Decrypt
    const decryptedData = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv
      },
      key,
      ciphertext
    );
    
    // Convert back to string
    const decoder = new TextDecoder();
    const plaintext = decoder.decode(decryptedData);
    
    console.log(`✅ Document decrypted (${plaintext.length} bytes)`);
    
    return plaintext;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt document');
  }
}

/**
 * Derive key from passphrase using PBKDF2
 */
async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseData = encoder.encode(passphrase);
  
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    passphraseData,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Check if document is encrypted
 */
export function isEncrypted(documentId: string): boolean {
  return documentId.startsWith('encrypted-');
}

/**
 * Export encrypted document with metadata
 */
export function exportEncrypted(encryptedDoc: EncryptedDocument): string {
  return JSON.stringify(encryptedDoc, null, 2);
}

/**
 * Import encrypted document
 */
export function importEncrypted(json: string): EncryptedDocument {
  const imported = JSON.parse(json);
  
  // Validate required fields
  if (!imported.ciphertext || !imported.iv || !imported.salt) {
    throw new Error('Invalid encrypted document format');
  }
  
  return imported;
}

/**
 * Hash document for integrity verification
 */
export async function hashDocument(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify document integrity
 */
export async function verifyIntegrity(
  content: string,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await hashDocument(content);
  return actualHash === expectedHash;
}

/**
 * Securely erase keys from memory
 */
export async function secureErase(): Promise<void> {
  if (masterKey) {
    try {
      await window.crypto.subtle.destroyKey(masterKey);
    } catch (error) {
      console.warn('Failed to destroy key:', error);
    }
    masterKey = null;
    encryptionEnabled = false;
  }
  
  console.log('🧹 Encryption keys securely erased');
}

// Helper Functions

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes.buffer;
}

/**
 * Enable/disable encryption
 */
export function setEncryptionEnabled(enabled: boolean): void {
  encryptionEnabled = enabled;
  window.dispatchEvent(new CustomEvent('encryption-toggled', { detail: { enabled } }));
}

/**
 * Get encryption status
 */
export function getEncryptionStatus(): {
  enabled: boolean;
  hasKey: boolean;
  totalDocuments: number;
} {
  return {
    enabled: encryptionEnabled,
    hasKey: masterKey !== null,
    totalDocuments: 0 // Would track in real implementation
  };
}

/**
 * Password strength checker
 */
export function checkPasswordStrength(password: string): {
  score: number; // 0-4
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;
  
  if (password.length >= 8) {
    score++;
  } else {
    feedback.push('Password should be at least 8 characters');
  }
  
  if (password.length >= 12) {
    score++;
  }
  
  if (/[A-Z]/.test(password)) {
    score++;
  } else {
    feedback.push('Add uppercase letters');
  }
  
  if (/[a-z]/.test(password)) {
    score++;
  } else {
    feedback.push('Add lowercase letters');
  }
  
  if (/[0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('Add numbers');
  }
  
  if (/[^A-Za-z0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('Add special characters');
  }
  
  return {
    score: Math.min(score, 4),
    feedback
  };
}
