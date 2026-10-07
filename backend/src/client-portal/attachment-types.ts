// Which files the client portal accepts (Stage 3, agreed with the user
// 2026-10-07) and how they're recognised. The type is decided from the
// file's own bytes, and the name's extension must agree - so a renamed
// web page or program is refused even when called "photo.png". SVG, HTML
// and executables are never accepted.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_UPLOAD = 5;

// Shown inline in the browser; everything else downloads.
export const INLINE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

interface FileKind {
  mimeType: string;
  extensions: string[];
  matches: (b: Buffer) => boolean;
}

const startsWith = (b: Buffer, bytes: number[], offset = 0) => bytes.every((v, i) => b[offset + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

// Office files are zip archives; the part names in a zip's headers are
// plain text, so the archive must contain the folder for its own type.
const officeZip = (folder: string) => (b: Buffer) =>
  startsWith(b, [0x50, 0x4b, 0x03, 0x04]) && b.includes('[Content_Types].xml') && b.includes(folder);

// Plain text: valid UTF-8, no NUL bytes, and nothing that looks like markup
// a browser might run.
function isPlainText(b: Buffer): boolean {
  if (b.includes(0)) return false;
  const text = b.toString('utf8');
  if (Buffer.byteLength(text, 'utf8') !== b.length || text.includes('�')) return false;
  return !/<\s*(script|html|!doctype|iframe|svg|object|embed)\b/i.test(text.slice(0, 4096));
}

const KINDS: FileKind[] = [
  { mimeType: 'image/png', extensions: ['png'], matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'], matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mimeType: 'image/gif', extensions: ['gif'], matches: (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')) },
  { mimeType: 'image/webp', extensions: ['webp'], matches: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8) },
  { mimeType: 'application/pdf', extensions: ['pdf'], matches: (b) => startsWith(b, ascii('%PDF-')) },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    matches: officeZip('word/'),
  },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    matches: officeZip('xl/'),
  },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['pptx'],
    matches: officeZip('ppt/'),
  },
  { mimeType: 'text/plain', extensions: ['txt'], matches: isPlainText },
  { mimeType: 'text/csv', extensions: ['csv'], matches: isPlainText },
];

export const ALLOWED_EXTENSIONS = KINDS.flatMap((k) => k.extensions);

// Returns the canonical MIME type, or null if the file isn't one we accept
// or its content doesn't match its extension.
export function detectAttachmentType(fileName: string, data: Buffer): string | null {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  const kind = KINDS.find((k) => k.extensions.includes(ext));
  if (!kind || data.length === 0) return null;
  return kind.matches(data) ? kind.mimeType : null;
}

// Display/download name: no folders, no control or path characters, at
// most 200 characters, extension kept.
export function cleanFileName(original: string): string {
  const base = (original || 'file').split(/[\\/]/).pop() || 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim() || 'file';
  if (cleaned.length <= 200) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 200 - ext.length) + ext;
}
