import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { loadConfig } from '../config';

const KEY = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z]{3,4}$/;

/**
 * Evidence-file storage behind a tiny interface: a local folder in development, Amazon S3 in production
 * (set S3_BUCKET). Keys are generated here — never derived from user input — and objects are write-once.
 */
@Injectable()
export class StorageService {
  private s3?: S3Client;

  private bucket() {
    return loadConfig().S3_BUCKET;
  }

  private client() {
    // Region and credentials come from the environment (ECS task role in AWS).
    return (this.s3 ??= new S3Client({}));
  }

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
    if (!KEY.test(key)) throw new Error('Invalid storage key');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const bucket = this.bucket();
    if (bucket) {
      await this.client().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `evidence/${key}`,
          Body: data,
          IfNoneMatch: '*', // write-once
          ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
        }),
      );
      return { key, sha256 };
    }
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
    return { key, sha256 };
  }

  async get(key: string): Promise<Buffer> {
    if (!KEY.test(key)) throw new Error('Invalid storage key');
    const bucket = this.bucket();
    if (bucket) {
      const res = await this.client().send(new GetObjectCommand({ Bucket: bucket, Key: `evidence/${key}` }));
      return Buffer.from(await res.Body!.transformToByteArray());
    }
    return readFile(this.pathOf(key));
  }
}
