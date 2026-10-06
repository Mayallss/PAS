import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { loadConfig } from '../config';

const KEY = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z]{3,4}$/;

/**
 * Evidence-file storage behind a tiny interface so production can swap the local folder for GCS (docs/05).
 * Keys are generated here — never derived from user input — and objects are write-once.
 */
@Injectable()
export class StorageService {
  private root() {
    return resolve(loadConfig().STORAGE_DIR);
  }

  private pathOf(key: string) {
    if (!KEY.test(key)) throw new Error('Invalid storage key');
    const root = this.root();
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(data: Buffer, ext: string): Promise<{ key: string; sha256: string }> {
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${ext}`;
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
    return { key, sha256: createHash('sha256').update(data).digest('hex') };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }
}
