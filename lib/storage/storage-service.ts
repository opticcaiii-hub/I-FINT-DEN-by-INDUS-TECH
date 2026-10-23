/**
 * Storage Service for I-FINT Data Cleaning & Migration Studio
 * 
 * STRICT PRIVATE STORAGE IMPLEMENTATION:
 * - Production: Vercel Blob (@vercel/blob) using access: private.
 * - Zero public access calls permitted anywhere in the storage system.
 * - Development/Test: Isolated local filesystem (.data/blob_storage/) strictly when NODE_ENV !== 'production' && !VERCEL.
 * - All downloads pass through authenticated server routes enforcing requireSession() and requireClientAccess().
 * - ZERO base64, bytea, or raw binary content stored in PostgreSQL.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { put, del, get } from '@vercel/blob';
import { SessionPayload, requireClientAccess } from '@/lib/auth';

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.json', '.tsv', '.txt'] as const;

export interface StorageMetadata {
  storageKey: string;
  blobUrl: string;
  fileHashSha256: string;
  fileSizeBytes: number;
  mimeType: string;
  originalFilename: string;
}

export interface UploadOptions {
  firmId: number;
  clientId: number;
  filename: string;
  buffer: Buffer;
  mimeType?: string;
}

export interface DownloadResult {
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
  fileHashSha256: string;
}

/**
 * Returns true if running in a deployed production environment.
 */
export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

/**
 * Returns true if Vercel Blob is configured with a valid token.
 */
export function isVercelBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Validates file buffer, size, and extension according to project rules.
 */
export function validateFileBeforeStorage(filename: string, buffer: Buffer): void {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('File validation failed: Uploaded file is empty (0 bytes).');
  }

  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File validation failed: File size (${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of 25 MB.`);
  }

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext as any)) {
    throw new Error(`File validation failed: Unsupported file extension "${ext}". Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
}

/**
 * Computes deterministic SHA-256 hash for a given byte buffer.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Sanitizes a filename for storage paths.
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Generates an isolated path for a file scoped by firm and client.
 */
export function buildStoragePath(firmId: number, clientId: number, filename: string, hash: string): string {
  const safeName = sanitizeFilename(filename);
  return `firms/${firmId}/clients/${clientId}/${hash.substring(0, 12)}_${safeName}`;
}

/**
 * Resolves local storage directory.
 */
function getLocalStorageDir(): string {
  const localDir = path.resolve(process.cwd(), '.data', 'blob_storage');
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  return localDir;
}

/**
 * Stores a file in external storage strictly with PRIVATE access.
 * NEVER makes client files public.
 */
export async function internalUploadStorage(options: UploadOptions): Promise<StorageMetadata> {
  const { firmId, clientId, filename, buffer, mimeType = 'application/octet-stream' } = options;

  // 1. Validation
  validateFileBeforeStorage(filename, buffer);
  const fileHash = computeSha256(buffer);
  const storagePath = buildStoragePath(firmId, clientId, filename, fileHash);

  // 2. Production Vercel Blob Storage — Strictly PRIVATE
  if (isProductionEnvironment() || isVercelBlobConfigured()) {
    if (!isVercelBlobConfigured()) {
      throw new Error(
        'Storage Configuration Error: BLOB_READ_WRITE_TOKEN is missing in production environment. ' +
        'Local filesystem storage is strictly prohibited in production deployments.'
      );
    }

    // STRICT INVARIANT: Always use access: 'private'
    const blobResult = await put(storagePath, buffer, {
      access: 'private',
      contentType: mimeType,
      addRandomSuffix: true,
    });

    // Do not expose direct public URL — return authenticated download endpoint reference
    const secureDownloadUrl = `/api/clients/${clientId}/data-cleaning/download?key=${encodeURIComponent(blobResult.pathname)}`;

    return {
      storageKey: blobResult.pathname,
      blobUrl: secureDownloadUrl,
      fileHashSha256: fileHash,
      fileSizeBytes: buffer.byteLength,
      mimeType,
      originalFilename: filename,
    };
  }

  // 3. Local Development / Test Storage Fallback (non-production only)
  const baseDir = getLocalStorageDir();
  const targetFilePath = path.join(baseDir, storagePath.replace(/\//g, path.sep));
  const parentDir = path.dirname(targetFilePath);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Prevent overwrite if same storage path exists
  if (!fs.existsSync(targetFilePath)) {
    fs.writeFileSync(targetFilePath, buffer);
  }

  const localKey = `local://${storagePath}`;
  const secureLocalUrl = `/api/clients/${clientId}/data-cleaning/download?key=${encodeURIComponent(localKey)}`;

  return {
    storageKey: localKey,
    blobUrl: secureLocalUrl,
    fileHashSha256: fileHash,
    fileSizeBytes: buffer.byteLength,
    mimeType,
    originalFilename: filename,
  };
}

/**
 * Downloads a private file from external storage without session (for verified internal callers).
 * Enforces firm and client path isolation.
 */
export async function internalDownloadStorage(
  firmId: number,
  clientId: number,
  storageKey: string
): Promise<DownloadResult> {
  // Enforce path isolation: key MUST start with firms/${firmId}/clients/${clientId}/
  const expectedPrefix = `firms/${firmId}/clients/${clientId}/`;
  const cleanKey = storageKey.replace(/^local:\/\//, '');

  if (!cleanKey.startsWith(expectedPrefix)) {
    throw new Error(`Security Violation: Cross-client or cross-firm access denied for storage key "${storageKey}".`);
  }

  // Local storage download
  if (storageKey.startsWith('local://')) {
    if (isProductionEnvironment()) {
      throw new Error('Security Error: Local storage key cannot be accessed in production environment.');
    }
    const baseDir = getLocalStorageDir();
    const filePath = path.join(baseDir, cleanKey.replace(/\//g, path.sep));

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found in local storage: "${cleanKey}"`);
    }

    const buffer = fs.readFileSync(filePath);
    const hash = computeSha256(buffer);
    const ext = path.extname(cleanKey).toLowerCase();
    const contentType = getMimeTypeFromExt(ext);

    return {
      buffer,
      contentType,
      sizeBytes: buffer.byteLength,
      fileHashSha256: hash,
    };
  }

  // Vercel Blob private download
  if (!isVercelBlobConfigured() && isProductionEnvironment()) {
    throw new Error('Storage Configuration Error: BLOB_READ_WRITE_TOKEN is missing.');
  }

  // Fetch private blob using @vercel/blob get() with access: 'private'
  const blobResult = await get(storageKey, { access: 'private' });
  if (!blobResult || blobResult.statusCode === 304 || !blobResult.stream) {
    throw new Error(`Failed to fetch private blob from Vercel storage: key "${storageKey}" not found or empty.`);
  }

  // Convert Web ReadableStream to Node Buffer
  const reader = blobResult.stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  const hash = computeSha256(buffer);

  return {
    buffer,
    contentType: blobResult.blob.contentType || 'application/octet-stream',
    sizeBytes: buffer.byteLength,
    fileHashSha256: hash,
  };
}

/**
 * Deletes a private file from external storage.
 */
export async function internalDeleteStorage(
  firmId: number,
  clientId: number,
  storageKey: string
): Promise<void> {
  const expectedPrefix = `firms/${firmId}/clients/${clientId}/`;
  const cleanKey = storageKey.replace(/^local:\/\//, '');

  if (!cleanKey.startsWith(expectedPrefix)) {
    throw new Error(`Security Violation: Cross-client or cross-firm access denied for storage key "${storageKey}".`);
  }

  if (storageKey.startsWith('local://')) {
    const baseDir = getLocalStorageDir();
    const filePath = path.join(baseDir, cleanKey.replace(/\//g, path.sep));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return;
  }

  if (isVercelBlobConfigured()) {
    await del(storageKey);
  }
}

/**
 * Authenticated upload: strictly enforces session and client authorization.
 */
export async function uploadFileSecure(
  session: SessionPayload,
  clientId: number,
  filename: string,
  buffer: Buffer,
  mimeType?: string
): Promise<StorageMetadata> {
  await requireClientAccess(session, clientId);
  return internalUploadStorage({
    firmId: session.firmId,
    clientId,
    filename,
    buffer,
    mimeType,
  });
}

/**
 * Authenticated download: strictly enforces session and client authorization.
 */
export async function downloadFileSecure(
  session: SessionPayload,
  clientId: number,
  storageKey: string
): Promise<DownloadResult> {
  await requireClientAccess(session, clientId);
  return internalDownloadStorage(session.firmId, clientId, storageKey);
}

/**
 * Authenticated delete: strictly enforces session and client authorization.
 */
export async function deleteFileSecure(
  session: SessionPayload,
  clientId: number,
  storageKey: string
): Promise<void> {
  await requireClientAccess(session, clientId);
  return internalDeleteStorage(session.firmId, clientId, storageKey);
}

/**
 * Helper to map extensions to MIME types.
 */
function getMimeTypeFromExt(ext: string): string {
  switch (ext) {
    case '.csv':
      return 'text/csv';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.json':
      return 'application/json';
    case '.tsv':
      return 'text/tab-separated-values';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}
