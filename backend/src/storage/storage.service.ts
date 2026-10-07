import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Private file storage (client portal Stage 3, built to be reused - e.g.
// by Evidence later). Supabase Storage over its REST API with the
// service-role key, which never leaves the server: files are only ever
// read back through the backend after an access check, never via public
// or signed URLs. Buckets are created private on first use.
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly readyBuckets = new Set<string>();

  constructor(private config: ConfigService) {}

  private settings() {
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new ServiceUnavailableException('File storage is not configured.');
    return { url: url.replace(/\/+$/, ''), headers: { Authorization: `Bearer ${key}`, apikey: key } };
  }

  private objectUrl(base: string, bucket: string, key: string) {
    return `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async ensureBucket(bucket: string) {
    if (this.readyBuckets.has(bucket)) return;
    const { url, headers } = this.settings();
    const res = await fetch(`${url}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket, name: bucket, public: false }),
    });
    // 400/409 = already exists, which is fine.
    if (!res.ok && res.status !== 400 && res.status !== 409) {
      this.logger.error(`Creating bucket ${bucket} failed: ${res.status} ${await res.text()}`);
      throw new ServiceUnavailableException('File storage is unavailable.');
    }
    this.readyBuckets.add(bucket);
  }

  async put(bucket: string, key: string, data: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket(bucket);
    const { url, headers } = this.settings();
    const res = await fetch(this.objectUrl(url, bucket, key), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' },
      body: new Uint8Array(data),
    });
    if (!res.ok) {
      this.logger.error(`Upload ${bucket}/${key} failed: ${res.status} ${await res.text()}`);
      throw new ServiceUnavailableException('Could not store the file. Please try again.');
    }
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const { url, headers } = this.settings();
    const res = await fetch(this.objectUrl(url, bucket, key), { headers });
    if (!res.ok) {
      this.logger.error(`Download ${bucket}/${key} failed: ${res.status}`);
      throw new ServiceUnavailableException('Could not read the file. Please try again.');
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Used only to roll back a file whose database row couldn't be saved.
  async remove(bucket: string, key: string): Promise<void> {
    const { url, headers } = this.settings();
    const res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [key] }),
    });
    if (!res.ok) this.logger.error(`Delete ${bucket}/${key} failed: ${res.status}`);
  }
}
