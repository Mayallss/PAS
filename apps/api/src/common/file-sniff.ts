/**
 * Identifies an uploaded file from its first bytes. The browser-supplied name and Content-Type are never trusted:
 * only these formats are accepted as evidence files, whatever the upload claims to be.
 */
export interface SniffedType {
  mime: string;
  ext: string;
}

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString('latin1');

export function sniffFileType(buf: Buffer): SniffedType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (ascii(buf, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  // ISO-BMFF photos from phones: "....ftypheic" / heix / mif1 …
  if (ascii(buf, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heif'].includes(ascii(buf, 8, 12))) {
    return { mime: 'image/heic', ext: '.heic' };
  }
  return null;
}

/** Keeps a readable original name for downloads without path parts or control characters. */
export function safeFileName(name: string, ext: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 150);
  if (!cleaned) return `file${ext}`;
  return cleaned.toLowerCase().endsWith(ext) || (ext === '.jpg' && /\.jpe?g$/i.test(cleaned)) ? cleaned : `${cleaned}${ext}`;
}
