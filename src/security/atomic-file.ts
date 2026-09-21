import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Same-directory replacement. The guard revalidates session/path/content just
 * before commit. This reduces, but cannot eliminate, local symlink TOCTOU. */
export function writeAtomic(path: string, content: string | Buffer, guard: () => void): void {
  guard();
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.bridge-write-${randomBytes(12).toString('hex')}`);
  let fd: number | undefined;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
    guard();
    renameSync(temp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}
