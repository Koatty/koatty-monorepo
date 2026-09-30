import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { AgentRunStore } from './agent';

/** Local durable store. Exclusive lock + atomic rename on a local filesystem.
 * A crash during CAS may retain a .lock: fail closed and reconcile manually.
 * For clustered/network filesystem deployments, inject a transactional database/CAS store. */
export function createFileAgentRunStore(directory: string): AgentRunStore {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync(directory);
  const fileFor = (key: string) => path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
  const read = (file: string): string | null => {
    try {
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { if (!fs.fstatSync(fd).isFile()) throw new Error('Invalid run record'); return fs.readFileSync(fd, 'utf8'); }
      finally { fs.closeSync(fd); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  };
  return {
    get: key => read(fileFor(key)),
    compareAndSet(key, expected, value) {
      const file = fileFor(key);
      const lock = file + '.lock';
      let fd: number;
      try { fd = fs.openSync(lock, 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
      const temp = file + '.' + randomUUID() + '.tmp';
      try {
        if (read(file) !== expected) return false;
        const output = fs.openSync(temp, 'wx', 0o600);
        try { fs.writeFileSync(output, value); fs.fsyncSync(output); } finally { fs.closeSync(output); }
        fs.renameSync(temp, file);
        const dir = fs.openSync(root, 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
        return true;
      } finally {
        fs.closeSync(fd); fs.unlinkSync(lock);
        try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    },
  };
}
