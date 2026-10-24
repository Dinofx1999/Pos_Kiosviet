import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';

export const UPLOAD_URL_PREFIX = '/uploads';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_REQUEST = 10;

const SIGNATURES: Array<{ ext: string; mime: string; test: (b: Buffer) => boolean }> = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a') },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

export function uploadRoot(): string {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');
}

export interface UploadedImage { url: string; fileName: string; size: number; mimeType: string }

/** Stores product images on local disk under <UPLOAD_DIR>/products/<tenantId>/<uuid>.<ext>; served statically at /uploads/... */
@Injectable()
export class UploadsService {
  async saveImages(user: RequestUser, files: Array<{ buffer: Buffer; originalname: string; size: number }>): Promise<UploadedImage[]> {
    if (!files.length) throw Errors.validation('Chưa chọn tệp ảnh');
    if (files.length > MAX_IMAGES_PER_REQUEST) throw Errors.validation(`Tối đa ${MAX_IMAGES_PER_REQUEST} ảnh mỗi lần tải lên`);
    const dir = path.join(uploadRoot(), 'products', user.tenantId);
    await mkdir(dir, { recursive: true });
    const out: UploadedImage[] = [];
    for (const f of files) {
      if (f.size > MAX_IMAGE_BYTES) throw Errors.validation(`Ảnh "${f.originalname}" vượt quá 5MB`);
      const sig = SIGNATURES.find((s) => s.test(f.buffer));
      if (!sig) throw Errors.validation(`Tệp "${f.originalname}" không phải ảnh JPEG/PNG/GIF/WebP hợp lệ`);
      const fileName = `${randomUUID()}.${sig.ext}`;
      await writeFile(path.join(dir, fileName), f.buffer, { flag: 'wx' });
      out.push({ url: `${UPLOAD_URL_PREFIX}/products/${user.tenantId}/${fileName}`, fileName, size: f.size, mimeType: sig.mime });
    }
    return out;
  }

  /** Deletes a file previously uploaded by this tenant. URLs outside the tenant folder are rejected. */
  async deleteImage(user: RequestUser, url: string): Promise<void> {
    const rel = this.tenantRelativePath(user, url);
    await unlink(path.join(uploadRoot(), rel)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
  }

  /** Accepts only our own upload URLs for this tenant or absolute http(s) URLs (external CDN). */
  static assertImageUrl(user: RequestUser, url: string): void {
    if (/^https?:\/\/[^\s]+$/i.test(url)) return;
    if (!url.startsWith(`${UPLOAD_URL_PREFIX}/products/${user.tenantId}/`) || url.includes('..')) throw Errors.validation('Đường dẫn ảnh không hợp lệ', { url });
  }

  private tenantRelativePath(user: RequestUser, url: string): string {
    const prefix = `${UPLOAD_URL_PREFIX}/products/${user.tenantId}/`;
    if (!url.startsWith(prefix) || url.includes('..') || url.includes('/', prefix.length)) throw Errors.validation('Đường dẫn ảnh không hợp lệ', { url });
    return path.join('products', user.tenantId, url.slice(prefix.length));
  }
}
