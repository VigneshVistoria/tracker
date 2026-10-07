import { ServiceUnavailableException } from '@nestjs/common';

// Stand-in for StorageService in every test - the tests never touch
// Supabase Storage. Exposes what was stored, and can be told to fail an
// upload to prove nothing is left behind.
export class MemoryStorage {
  objects = new Map<string, { data: Buffer; contentType: string }>();
  failPutsAfter: number | null = null;
  private puts = 0;

  async put(bucket: string, key: string, data: Buffer, contentType: string) {
    if (this.failPutsAfter !== null && this.puts++ >= this.failPutsAfter) {
      throw new ServiceUnavailableException('Could not store the file. Please try again.');
    }
    this.objects.set(`${bucket}/${key}`, { data: Buffer.from(data), contentType });
  }

  async get(bucket: string, key: string) {
    const o = this.objects.get(`${bucket}/${key}`);
    if (!o) throw new ServiceUnavailableException('Could not read the file. Please try again.');
    return o.data;
  }

  async remove(bucket: string, key: string) {
    this.objects.delete(`${bucket}/${key}`);
  }

  reset() {
    this.objects.clear();
    this.failPutsAfter = null;
    this.puts = 0;
  }
}
