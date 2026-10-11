/**
 * Development-only, encrypted, single-node snapshot store.
 * A production adapter should use native OS secure storage and transactional DB.
 * The caller supplies a 32-byte secret from an OS keystore; never store it here.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { open, mkdir, lstat, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const copy = value => JSON.parse(JSON.stringify(value));
const initToken = Symbol('private-construction');
const formatVersion = 1;
const filename = 'jobs.enc';
const markerName = '.initialized';
const jobIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}:[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const allowedStatuses = new Set(['running', 'waiting_network', 'waiting_retry', 'succeeded', 'blocked', 'failed', 'cancelled']);
function assertJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job) ||
      !jobIdPattern.test(job.id || '') || !allowedStatuses.has(job.status) ||
      !Number.isSafeInteger(job.cursor) || job.cursor < 0 ||
      (job.attempt !== undefined && (!Number.isSafeInteger(job.attempt) || job.attempt < 1 || job.attempt > 6)) ||
      (job.status === 'waiting_retry' && (typeof job.retryAt !== 'string' || !Number.isFinite(Date.parse(job.retryAt))))) {
    throw new TypeError('Invalid job state');
  }
}


export class StoreIntegrityError extends Error {
  constructor() { super('Encrypted automation state is unavailable or failed integrity verification'); this.name = 'StoreIntegrityError'; }
}

export class EncryptedFileStore {
  #directory;
  #key;
  #writeTail = Promise.resolve();
  #lockFile;
  #lockHandle;
  #closed = false;

  constructor(token) { if (token !== initToken) throw new TypeError('Use EncryptedFileStore.open({directory, key})'); }

  static async open({ directory, key }) {
    if (typeof directory !== 'string' || !directory.trim() || !Buffer.isBuffer(key) || key.length !== 32) {
      throw new TypeError('An explicit directory and 32-byte encryption key are required');
    }
    const folder = resolve(directory);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    if (!(await lstat(folder)).isDirectory()) throw new StoreIntegrityError();
    const current = await stat(folder);
    if ((current.mode & 0o077) !== 0) throw new StoreIntegrityError();

    // The caller must run one local worker per data directory. Never auto-remove
    // a stale lock: an action may have completed without its checkpoint.
    const lockFile = join(folder, '.writer.lock');
    let handle;
    try { handle = await open(lockFile, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('STORE_ALREADY_OPEN: inspect and reconcile an existing lock before recovery');
      throw error;
    }
    try {
      const store = new EncryptedFileStore(initToken);
      store.#directory = folder;
      store.#key = Buffer.from(key);
      store.#lockFile = lockFile;
      store.#lockHandle = handle;
      // Integrity and key correctness are verified at open. Never overwrite
      // malformed data with an empty state.
      await store.#initialize();
      return store;
    } catch (error) {
      await handle.close();
      await rm(lockFile, { force: true });
      throw error;
    }
  }

  #assertOpen() { if (this.#closed) throw new Error('STORE_CLOSED'); }

  async #initialize() {
    // Legacy stores may have jobs.enc without a marker. Upgrade non-destructively.
    // A marker without a journal proves that a previously initialized journal
    // disappeared; silently treating it as a new store risks lost/duplicate work.
    const marker = join(this.#directory, markerName);
    let marked = false;
    try {
      const data = await readFile(marker);
      if (data.toString() !== 'GCA1\n') throw new StoreIntegrityError();
      marked = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let present = true;
    try { await lstat(join(this.#directory, filename)); }
    catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
    if (!present && marked) throw new StoreIntegrityError();
    if (!present) await this.#save({});
    await this.#load(); // Authenticate existing state before writing a marker.
    if (!marked) {
      const handle = await open(marker, 'wx', 0o600);
      try { await handle.writeFile('GCA1\n'); await handle.sync(); }
      finally { await handle.close(); }
      const folder = await open(this.#directory, 'r');
      try { await folder.sync(); } finally { await folder.close(); }
    }
  }

  async #load() {
    this.#assertOpen();
    let raw;
    try { raw = await readFile(join(this.#directory, filename)); }
    catch (error) { if (error.code === 'ENOENT') throw new StoreIntegrityError(); throw error; }
    try {
      if (raw.length < 4 + 12 + 16 || raw.subarray(0, 4).toString() !== 'GCA1') throw new Error('Invalid header');
      const iv = raw.subarray(4, 16);
      const tag = raw.subarray(16, 32);
      const ciphertext = raw.subarray(32);
      const cipher = createDecipheriv('aes-256-gcm', this.#key, iv);
      cipher.setAAD(Buffer.from(`GoreeCloud-Automations-state-v${formatVersion}`));
      cipher.setAuthTag(tag);
      const data = JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8'));
      if (!data || data.version !== formatVersion || !data.jobs ||
          Object.getPrototypeOf(data.jobs) !== Object.prototype || Array.isArray(data.jobs)) throw new Error('Invalid state');
      for (const [id, job] of Object.entries(data.jobs)) {
        if (id !== job?.id) throw new Error('Invalid job');
        assertJob(job);
      }
      return data.jobs;
    } catch { throw new StoreIntegrityError(); }
  }

  async #save(jobs) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(`GoreeCloud-Automations-state-v${formatVersion}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ version: formatVersion, jobs })), cipher.final()]);
    const bytes = Buffer.concat([Buffer.from('GCA1'), iv, cipher.getAuthTag(), ciphertext]);
    const temporary = join(this.#directory, `.jobs-${randomBytes(12).toString('hex')}.tmp`);
    let file;
    try {
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(bytes);
      await file.sync();
      await file.close(); file = null;
      await rename(temporary, join(this.#directory, filename));
      const dir = await open(this.#directory, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    } finally {
      if (file) await file.close();
      await rm(temporary, { force: true });
    }
  }

  async #write(mutator) {
    this.#assertOpen();
    const transaction = this.#writeTail.then(async () => {
      const jobs = await this.#load();
      const result = mutator(jobs);
      if (result.modified) await this.#save(jobs);
      return result.value;
    });
    this.#writeTail = transaction.then(() => {}, () => {});
    return transaction;
  }

  async get(id) { await this.#writeTail; const jobs = await this.#load(); return Object.hasOwn(jobs, id) ? copy(jobs[id]) : null; }
  async list() { await this.#writeTail; return Object.values(await this.#load()).map(copy); }
  async createIfAbsent(job) {
    assertJob(job);
    return this.#write(jobs => {
      if (Object.hasOwn(jobs, job.id)) return { modified: false, value: false };
      jobs[job.id] = copy(job);
      return { modified: true, value: true };
    });
  }
  async put(job) {
    assertJob(job);
    return this.#write(jobs => {
      if (!Object.hasOwn(jobs, job.id)) throw new Error('Cannot replace an unknown job');
      jobs[job.id] = copy(job);
      return { modified: true };
    });
  }

  async close() {
    if (this.#closed) return;
    await this.#writeTail;
    this.#closed = true;
    this.#key.fill(0);
    await this.#lockHandle.close();
    await rm(this.#lockFile, { force: true });
  }
}
