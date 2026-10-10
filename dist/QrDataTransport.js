// node_modules/@bytecodealliance/preview2-shim/dist/browser/common.js
var MAX_U64 = (1n << 64n) - 1n;
function checkedU64(value, name) {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U64) {
    throw new TypeError(`${name} must be a valid u64`);
  }
  return value;
}
function checkedU64AsNumber(value, name) {
  checkedU64(value, name);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name} exceeds JavaScript's safe integer range`);
  }
  return Number(value);
}

// node_modules/@bytecodealliance/preview2-shim/dist/browser/io.js
var id = 0;
var symbolDispose = Symbol.dispose || /* @__PURE__ */ Symbol.for("dispose");
var checkedLength = (len, name = "length") => checkedU64AsNumber(len, name);
function closed() {
  throw { tag: "closed" };
}
var IoError = class extends Error {
  toDebugString() {
    return this.message;
  }
};
var InputStream = class _InputStream {
  id;
  handler;
  #open = true;
  #children = /* @__PURE__ */ new Set();
  static _create(handler) {
    const stream = new _InputStream();
    if (!handler) {
      console.trace("no handler");
    }
    stream.id = ++id;
    stream.handler = handler;
    return stream;
  }
  read(len) {
    checkedLength(len);
    if (!this.#open) {
      closed();
    }
    if (this.handler.read) {
      return this.handler.read.call(this, len);
    }
    return this.handler.blockingRead.call(this, len);
  }
  blockingRead(len) {
    checkedLength(len);
    if (!this.#open) {
      closed();
    }
    return this.handler.blockingRead.call(this, len);
  }
  skip(len) {
    checkedLength(len);
    if (!this.#open) {
      closed();
    }
    if (this.handler.skip) {
      return this.handler.skip.call(this, len);
    }
    if (this.handler.read) {
      const bytes = this.handler.read.call(this, len);
      return BigInt(bytes.byteLength);
    }
    return this.blockingSkip.call(this, len);
  }
  blockingSkip(len) {
    checkedLength(len);
    if (!this.#open) {
      closed();
    }
    if (this.handler.blockingSkip) {
      return this.handler.blockingSkip.call(this, len);
    }
    const bytes = this.handler.blockingRead.call(this, len);
    return BigInt(bytes.byteLength);
  }
  subscribe() {
    if (!this.#open) {
      return pollableCreate();
    }
    const pollable = this.handler.subscribe ? this.handler.subscribe.call(this) : pollableCreate();
    if (pollable instanceof Pollable) {
      this.#children.add(pollable);
      pollable._onDispose(() => this.#children.delete(pollable));
    }
    return pollable;
  }
  [symbolDispose]() {
    if (!this.#open) {
      return;
    }
    this.#open = false;
    for (const child of this.#children) {
      child._invalidate();
    }
    this.#children.clear();
    if (this.handler.drop) {
      this.handler.drop.call(this);
    }
  }
};
var inputStreamCreate = InputStream._create;
delete InputStream._create;
var OutputStream = class _OutputStream {
  id;
  open;
  handler;
  #permit = 0n;
  #children = /* @__PURE__ */ new Set();
  static _create(handler) {
    const stream = new _OutputStream();
    if (!handler) {
      console.trace("no handler");
    }
    stream.id = ++id;
    stream.open = true;
    stream.handler = handler;
    return stream;
  }
  checkWrite() {
    if (!this.open) {
      closed();
    }
    if (this.handler.checkWrite) {
      const permit = this.handler.checkWrite.call(this);
      checkedLength(permit, "write permit");
      this.#permit = permit;
      return permit;
    }
    this.#permit = 1000000n;
    return this.#permit;
  }
  write(buf) {
    if (!this.open) {
      closed();
    }
    if (BigInt(buf.byteLength) > this.#permit) {
      throw new Error("write exceeds the permit returned by checkWrite");
    }
    this.#permit -= BigInt(buf.byteLength);
    this.handler.write.call(this, buf);
  }
  blockingWriteAndFlush(buf) {
    if (!this.open) {
      closed();
    }
    if (buf.byteLength > 4096) {
      throw new RangeError("blockingWriteAndFlush accepts at most 4096 bytes");
    }
    if (this.handler.blockingWriteAndFlush) {
      return this.handler.blockingWriteAndFlush.call(this, buf);
    }
    this.handler.write.call(this, buf);
    if (this.handler.blockingFlush) {
      this.handler.blockingFlush.call(this);
    } else {
      this.handler.flush?.call(this);
    }
  }
  flush() {
    if (!this.open) {
      closed();
    }
    this.#permit = 0n;
    if (this.handler.flush) {
      this.handler.flush.call(this);
    }
  }
  blockingFlush() {
    if (!this.open) {
      closed();
    }
    if (this.handler.blockingFlush) {
      this.handler.blockingFlush.call(this);
    } else {
      this.handler.flush?.call(this);
    }
  }
  writeZeroes(len) {
    const length = checkedLength(len);
    if (len > this.#permit) {
      throw new Error("write exceeds the permit returned by checkWrite");
    }
    this.write.call(this, new Uint8Array(length));
  }
  blockingWriteZeroesAndFlush(len) {
    const length = checkedLength(len);
    if (length > 4096) {
      throw new RangeError("blockingWriteZeroesAndFlush accepts at most 4096 bytes");
    }
    this.blockingWriteAndFlush.call(this, new Uint8Array(length));
  }
  splice(src, len) {
    const spliceLen = Math.min(checkedLength(len), Number(this.checkWrite.call(this)));
    const bytes = src.read(BigInt(spliceLen));
    this.write.call(this, bytes);
    return BigInt(bytes.byteLength);
  }
  blockingSplice(src, len) {
    const spliceLen = Math.min(checkedLength(len), Number(this.checkWrite.call(this)));
    const bytes = src.blockingRead(BigInt(spliceLen));
    this.write.call(this, bytes);
    return BigInt(bytes.byteLength);
  }
  subscribe() {
    if (!this.open) {
      return pollableCreate();
    }
    const pollable = this.handler.subscribe ? this.handler.subscribe.call(this) : pollableCreate();
    if (pollable instanceof Pollable) {
      this.#children.add(pollable);
      pollable._onDispose(() => this.#children.delete(pollable));
    }
    return pollable;
  }
  [symbolDispose]() {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.#permit = 0n;
    for (const child of this.#children) {
      child._invalidate();
    }
    this.#children.clear();
    this.handler.drop?.call(this);
  }
};
var outputStreamCreate = OutputStream._create;
delete OutputStream._create;
var error = {
  Error: IoError
};
var streams = { InputStream, OutputStream };
var Pollable = class _Pollable {
  #source = { ready: () => true, wait: () => Promise.resolve() };
  #invalid = false;
  #disposed = false;
  #wait = null;
  #disposeCallbacks = [];
  #wakeUnusable;
  #unusable = new Promise((resolve) => this.#wakeUnusable = resolve);
  static _create(source) {
    const pollable = new _Pollable();
    if (source instanceof Promise) {
      let ready = false;
      const wait = source.then(() => {
        ready = true;
      }, () => {
        ready = true;
      });
      pollable.#source = { ready: () => ready, wait: () => wait };
    } else if (source) {
      pollable.#source = source;
    }
    return pollable;
  }
  ready() {
    this.#assertUsable();
    return this.#source.ready();
  }
  block() {
    this.#assertUsable();
    if (this.#source.ready()) {
      return Promise.resolve();
    }
    if (!this.#wait) {
      this.#wait = Promise.race([
        Promise.resolve(this.#source.wait()),
        this.#unusable.then(() => this.#assertUsable())
      ]).finally(() => {
        this.#wait = null;
      });
    }
    return this.#wait;
  }
  _onDispose(callback) {
    if (this.#disposed) {
      callback();
    } else {
      this.#disposeCallbacks.push(callback);
    }
  }
  _invalidate() {
    if (this.#invalid || this.#disposed) {
      return;
    }
    this.#invalid = true;
    this.#wakeUnusable();
  }
  #assertUsable() {
    if (this.#disposed) {
      throw new Error("pollable has been disposed");
    }
    if (this.#invalid) {
      throw new Error("pollable's parent resource has been disposed");
    }
  }
  [symbolDispose]() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#wakeUnusable();
    for (const callback of this.#disposeCallbacks.splice(0)) {
      callback();
    }
  }
};
var pollableCreate = Pollable._create;
delete Pollable._create;

// node_modules/@bytecodealliance/preview2-shim/dist/browser/config.js
var _cwd = "/";
function _getCwd() {
  return _cwd;
}

// node_modules/@bytecodealliance/preview2-shim/dist/browser/environment.js
var _env = [];
var _args = [];
var _cwd2 = "/";
var environment = {
  getEnvironment() {
    return _env;
  },
  getArguments() {
    return _args;
  },
  initialCwd() {
    return _cwd2;
  }
};

// node_modules/@bytecodealliance/preview2-shim/dist/browser/cli.js
var symbolDispose2 = Symbol.dispose ?? /* @__PURE__ */ Symbol.for("dispose");
var ComponentExit = class extends Error {
  exitError = true;
  code;
  constructor(code) {
    super(`Component exited ${code === 0 ? "successfully" : "with error"}`);
    this.code = code;
  }
};
var exit = {
  exit(status) {
    throw new ComponentExit(status.tag === "err" ? 1 : 0);
  },
  // @ts-expect-error - Available only wasi-cli v0.2.12
  exitWithCode(code) {
    throw new ComponentExit(code);
  }
};
var stdinStream = inputStreamCreate({
  blockingRead() {
    throw { tag: "closed" };
  },
  subscribe() {
    return pollableCreate();
  },
  [symbolDispose2]() {
  }
});
function consoleStream(writeLine) {
  const decoder = new TextDecoder();
  let pending = "";
  const emitCompleteLines = () => {
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      writeLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  };
  return {
    write(contents) {
      pending += decoder.decode(contents, { stream: true });
      emitCompleteLines();
    },
    flush() {
      pending += decoder.decode();
      if (pending) {
        writeLine(pending);
      }
      pending = "";
    },
    blockingFlush() {
      this.flush?.();
    },
    drop() {
      this.flush?.();
    }
  };
}
var stdoutStream = outputStreamCreate(consoleStream((line) => console.log(line)));
var stderrStream = outputStreamCreate(consoleStream((line) => console.error(line)));
var stdin = {
  getStdin() {
    return stdinStream;
  }
};
var stdout = {
  getStdout() {
    return stdoutStream;
  }
};
var stderr = {
  getStderr() {
    return stderrStream;
  }
};

// node_modules/@bytecodealliance/preview2-shim/dist/browser/clocks.js
var MAX_TIMEOUT_MS = 2147483647;
function timeout(durationNs) {
  let remainingMs = Number((durationNs + 999999n) / 1000000n);
  return new Promise((resolve) => {
    const next = () => {
      if (remainingMs <= 0) {
        resolve();
        return;
      }
      const delay = Math.min(remainingMs, MAX_TIMEOUT_MS);
      remainingMs -= delay;
      setTimeout(next, delay);
    };
    next();
  });
}
var monotonicClock = {
  resolution() {
    return BigInt(1e6);
  },
  now() {
    return BigInt(Math.floor(performance.now() * 1e6));
  },
  subscribeInstant(instant) {
    instant = checkedU64(instant, "instant");
    const now2 = monotonicClock.now();
    if (instant <= now2) {
      return pollableCreate();
    }
    return monotonicClock.subscribeDuration(instant - now2);
  },
  subscribeDuration(duration) {
    duration = checkedU64(duration, "duration");
    if (duration === 0n) {
      return pollableCreate();
    }
    return pollableCreate(timeout(duration));
  }
};
var wallClock = {
  now() {
    let now2 = Date.now();
    const seconds = BigInt(Math.floor(now2 / 1e3));
    const nanoseconds = now2 % 1e3 * 1e6;
    return { seconds, nanoseconds };
  },
  resolution() {
    return { seconds: 0n, nanoseconds: 1e6 };
  }
};

// node_modules/@bytecodealliance/preview2-shim/dist/browser/in-memory-filesystem.js
var rootEntries = /* @__PURE__ */ new WeakSet();
var timeZero = {
  seconds: 0n,
  nanoseconds: 0
};
function coerceToSafeIntegerNumber(obj) {
  let n;
  if (typeof obj === "number") {
    n = obj;
  } else if (typeof obj == "bigint") {
    n = Number(obj);
  } else {
    throw new TypeError(`unexpected non-numeric type: ${obj}`);
  }
  if (n > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`excessively large number: ${n}`);
  }
  return n;
}
var MAX_SYMLINK_DEPTH = 40;
function resolveEntry(root, path, followFinal, allowMissingFinal = false) {
  const directories = [root];
  const pending = path.split("/").reverse();
  let followed = 0;
  while (pending.length) {
    const parent = directories[directories.length - 1];
    if (!parent.dir) {
      throw "not-directory";
    }
    const name = pending.pop();
    if (name === "" || name === ".") {
      continue;
    }
    if (name === "..") {
      if (directories.length === 1) {
        throw "not-permitted";
      }
      directories.pop();
      continue;
    }
    const entry2 = parent.dir[name];
    const isFinal = pending.length === 0;
    if (!entry2) {
      if (isFinal && allowMissingFinal) {
        return { entry: void 0, parent, name };
      }
      throw "no-entry";
    }
    if (entry2.symlink !== void 0 && (!isFinal || followFinal)) {
      if (++followed > MAX_SYMLINK_DEPTH) {
        throw "loop";
      }
      if (entry2.symlink.startsWith("/")) {
        throw "not-permitted";
      }
      for (const segment of entry2.symlink.split("/").reverse()) {
        pending.push(segment);
      }
      continue;
    }
    if (isFinal) {
      return { entry: entry2, parent, name };
    }
    directories.push(entry2);
  }
  const entry = directories[directories.length - 1];
  return { entry, parent: entry, name: "" };
}
function lookupPath(root, path) {
  if (path === "." && rootEntries.has(root)) {
    return _getCwd();
  }
  return path;
}
function getChildEntry(parentEntry, subpath, followFinal) {
  return resolveEntry(parentEntry, lookupPath(parentEntry, subpath), !!followFinal).entry;
}
function getParentEntry(root, path) {
  const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
  const name = segments.pop();
  if (!name || name === "..") {
    throw "invalid";
  }
  const parent = resolveEntry(root, segments.join("/"), true).entry;
  if (!parent.dir) {
    throw "not-directory";
  }
  return [parent, name];
}
function getSource(fileEntry) {
  if (typeof fileEntry.source === "string") {
    fileEntry.source = new TextEncoder().encode(fileEntry.source);
  }
  return fileEntry.source;
}
function describeEntry(entry) {
  if (entry.symlink !== void 0) {
    return {
      type: "symbolic-link",
      size: BigInt(new TextEncoder().encode(entry.symlink).byteLength)
    };
  }
  if (entry.dir) {
    return { type: "directory", size: 0n };
  }
  return { type: "regular-file", size: BigInt(getSource(entry).byteLength) };
}
function containsEntry(root, target) {
  if (root === target) {
    return true;
  }
  return root.dir ? Object.values(root.dir).some((entry) => containsEntry(entry, target)) : false;
}
var fileWriteBuffers = /* @__PURE__ */ new WeakMap();
var nextEntryId = 0n;
var entryMetadata = /* @__PURE__ */ new WeakMap();
function metadata(entry) {
  let value = entryMetadata.get(entry);
  if (!value) {
    value = { id: ++nextEntryId, version: 0n, linkCount: 1n };
    entryMetadata.set(entry, value);
  }
  return value;
}
var fileLocks = /* @__PURE__ */ new WeakMap();
function lockState(entry) {
  let state = fileLocks.get(entry);
  if (!state) {
    state = { exclusiveHolder: null, sharedHolders: /* @__PURE__ */ new Set() };
    fileLocks.set(entry, state);
  }
  return state;
}
var touchListeners = /* @__PURE__ */ new Set();
function touch(entry) {
  metadata(entry).version++;
  for (const listener of touchListeners) {
    listener(entry);
  }
}
function getFileWriteBuffer(entry, source, requiredLength) {
  let buffer = fileWriteBuffers.get(entry);
  if (!buffer || buffer.buffer !== source.buffer || buffer.byteOffset !== source.byteOffset) {
    buffer = source;
  }
  if (requiredLength <= buffer.byteLength) {
    return buffer;
  }
  const newBuffer = new Uint8Array(Math.max(requiredLength, source.byteLength * 2));
  newBuffer.set(source);
  fileWriteBuffers.set(entry, newBuffer);
  return newBuffer;
}
var DirectoryEntryStream = class _DirectoryEntryStream {
  idx = 0;
  entries = [];
  static _create(entries) {
    const stream = new _DirectoryEntryStream();
    stream.entries = entries;
    return stream;
  }
  readDirectoryEntry() {
    if (this.idx === this.entries.length) {
      return void 0;
    }
    const [name, entry] = this.entries[this.idx];
    this.idx += 1;
    return {
      name,
      type: describeEntry(entry).type
    };
  }
};
var descriptorEntryStreamCreate = DirectoryEntryStream._create;
delete DirectoryEntryStream._create;
var Descriptor = class _Descriptor {
  #stream;
  #entry;
  #flags = {
    read: true,
    write: true,
    mutateDirectory: true
  };
  #advice = "normal";
  _getEntry(descriptor) {
    return descriptor.#entry;
  }
  static _create(entry, isStream) {
    const descriptor = new _Descriptor();
    if (isStream) {
      descriptor.#stream = entry;
    } else {
      descriptor.#entry = entry;
    }
    return descriptor;
  }
  readViaStream(_offset) {
    const source = getSource(this.#entry);
    let offset = Number(_offset);
    return inputStreamCreate({
      blockingRead(len) {
        if (offset === source.byteLength) {
          throw { tag: "closed" };
        }
        const bytes = source.slice(offset, offset + Number(len));
        offset += bytes.byteLength;
        return bytes;
      }
    });
  }
  writeViaStream(_offset) {
    const entry = this.#entry;
    let offset = coerceToSafeIntegerNumber(_offset);
    return outputStreamCreate({
      write(buf) {
        if (buf.byteLength === 0) {
          return;
        }
        const source = getSource(entry);
        const end = offset + buf.byteLength;
        if (!Number.isSafeInteger(end)) {
          throw new TypeError(`excessively large number: ${end}`);
        }
        const buffer = getFileWriteBuffer(entry, source, end);
        if (offset > source.byteLength) {
          buffer.fill(0, source.byteLength, offset);
        }
        buffer.set(buf, offset);
        entry.source = buffer.subarray(0, Math.max(source.byteLength, end));
        offset = end;
        touch(entry);
      }
    });
  }
  appendViaStream() {
    return this.writeViaStream(this.stat().size);
  }
  advise(_offset, _length, advice) {
    if (this.getType() === "directory") {
      throw "bad-descriptor";
    }
    this.#advice = advice;
  }
  syncData() {
  }
  getFlags() {
    return { ...this.#flags };
  }
  getType() {
    if (this.#stream) {
      return "fifo";
    }
    if (this.#entry.symlink !== void 0) {
      return "symbolic-link";
    }
    if (this.#entry.dir) {
      return "directory";
    }
    if (this.#entry.source) {
      return "regular-file";
    }
    return "unknown";
  }
  setSize(size) {
    if (this.getType() === "directory") {
      throw "is-directory";
    }
    const length = coerceToSafeIntegerNumber(size);
    const source = getSource(this.#entry);
    const resized = new Uint8Array(length);
    resized.set(source.subarray(0, length));
    this.#entry.source = resized;
    touch(this.#entry);
  }
  setTimes(dataAccessTimestamp, dataModificationTimestamp) {
    if (dataAccessTimestamp?.tag !== "no-change" || dataModificationTimestamp?.tag !== "no-change") {
      touch(this.#entry);
    }
  }
  read(length, offset) {
    const source = getSource(this.#entry);
    const off = coerceToSafeIntegerNumber(offset);
    const len = coerceToSafeIntegerNumber(length);
    const result = [
      source.slice(off, off + len),
      off + len >= source.byteLength
    ];
    return result;
  }
  write(buffer, offset) {
    if (this.getType() === "directory") {
      throw "is-directory";
    }
    const off = coerceToSafeIntegerNumber(offset);
    const source = getSource(this.#entry);
    const end = off + buffer.byteLength;
    if (!Number.isSafeInteger(end)) {
      throw "file-too-large";
    }
    const target = new Uint8Array(Math.max(source.byteLength, end));
    target.set(source);
    target.set(buffer, off);
    this.#entry.source = target;
    touch(this.#entry);
    return BigInt(buffer.byteLength);
  }
  readDirectory() {
    if (!this.#entry?.dir) {
      throw "bad-descriptor";
    }
    return descriptorEntryStreamCreate(Object.entries(this.#entry.dir).sort(([a], [b]) => a > b ? 1 : -1));
  }
  sync() {
  }
  createDirectoryAt(path) {
    try {
      getChildEntry(this.#entry, path, false);
      throw "exist";
    } catch (error2) {
      if (error2 !== "no-entry") {
        throw error2;
      }
    }
    const [parent, name] = getParentEntry(this.#entry, path);
    parent.dir[name] = { dir: {} };
    touch(parent);
  }
  stat() {
    const { type, size } = describeEntry(this.#entry);
    return {
      type,
      linkCount: metadata(this.#entry).linkCount,
      size,
      dataAccessTimestamp: timeZero,
      dataModificationTimestamp: timeZero,
      statusChangeTimestamp: timeZero
    };
  }
  statAt(pathFlags, path) {
    const entry = getChildEntry(this.#entry, path, pathFlags.symlinkFollow);
    const { type, size } = describeEntry(entry);
    return {
      type,
      linkCount: metadata(entry).linkCount,
      size,
      dataAccessTimestamp: timeZero,
      dataModificationTimestamp: timeZero,
      statusChangeTimestamp: timeZero
    };
  }
  setTimesAt(pathFlags, path, _atime, mtime) {
    const entry = getChildEntry(this.#entry, path, pathFlags.symlinkFollow);
    if (mtime?.tag !== "no-change") {
      fileWriteBuffers.delete(entry);
      touch(entry);
    }
  }
  linkAt(oldPathFlags, oldPath, newDescriptor, newPath) {
    const entry = getChildEntry(this.#entry, oldPath, oldPathFlags.symlinkFollow);
    if (entry.dir) {
      throw "not-permitted";
    }
    const [newParent, newName] = getParentEntry(descriptorGetEntry(unwrapDescriptor(newDescriptor)), newPath);
    if (newParent.dir[newName]) {
      throw "exist";
    }
    newParent.dir[newName] = entry;
    metadata(entry).linkCount++;
    touch(newParent);
  }
  openAt(pathFlags, path, openFlags, _flags) {
    const exclusiveCreate = !!(openFlags.create && openFlags.exclusive);
    const resolved = resolveEntry(this.#entry, lookupPath(this.#entry, path), !!pathFlags.symlinkFollow && !exclusiveCreate, !!openFlags.create);
    let childEntry = resolved.entry;
    if (childEntry && exclusiveCreate) {
      throw "exist";
    }
    if (!childEntry) {
      const { parent, name } = resolved;
      childEntry = parent.dir[name] = openFlags.directory ? { dir: {} } : { source: new Uint8Array() };
      touch(parent);
    }
    if (childEntry.symlink !== void 0) {
      throw "loop";
    }
    if (openFlags.directory && !childEntry.dir) {
      throw "not-directory";
    }
    if (openFlags.truncate) {
      if (childEntry.dir) {
        throw "is-directory";
      }
      childEntry.source = new Uint8Array();
      touch(childEntry);
    }
    return descriptorCreate(childEntry);
  }
  readlinkAt(path) {
    const entry = getChildEntry(this.#entry, path, false);
    if (entry.symlink === void 0) {
      throw "invalid";
    }
    if (entry.symlink.startsWith("/")) {
      throw "not-permitted";
    }
    return entry.symlink;
  }
  removeDirectoryAt(path) {
    const [parent, name] = getParentEntry(this.#entry, path);
    const entry = parent.dir?.[name];
    if (!entry) {
      throw "no-entry";
    }
    if (!entry.dir) {
      throw "not-directory";
    }
    if (Object.keys(entry.dir).length) {
      throw "not-empty";
    }
    delete parent.dir[name];
    metadata(entry).linkCount--;
    touch(parent);
  }
  renameAt(oldPath, newDescriptor, newPath) {
    const [oldParent, oldName] = getParentEntry(this.#entry, oldPath);
    const entry = oldParent.dir?.[oldName];
    if (!entry) {
      throw "no-entry";
    }
    const [newParent, newName] = getParentEntry(descriptorGetEntry(unwrapDescriptor(newDescriptor)), newPath);
    const replaced = newParent.dir[newName];
    if (oldParent === newParent && oldName === newName || replaced === entry) {
      return;
    }
    if (entry.dir && containsEntry(entry, newParent)) {
      throw "invalid";
    }
    if (replaced) {
      if (entry.dir && !replaced.dir) {
        throw "not-directory";
      }
      if (!entry.dir && replaced.dir) {
        throw "is-directory";
      }
      if (replaced.dir && Object.keys(replaced.dir).length > 0) {
        throw "not-empty";
      }
      metadata(replaced).linkCount--;
    }
    newParent.dir[newName] = entry;
    delete oldParent.dir[oldName];
    touch(oldParent);
    if (newParent !== oldParent) {
      touch(newParent);
    }
  }
  symlinkAt(oldPath, newPath) {
    if (oldPath.startsWith("/")) {
      throw "not-permitted";
    }
    const [parent, name] = getParentEntry(this.#entry, newPath);
    if (parent.dir[name]) {
      throw "exist";
    }
    parent.dir[name] = { symlink: oldPath };
    touch(parent);
  }
  unlinkFileAt(path) {
    const [parent, name] = getParentEntry(this.#entry, path);
    const entry = parent.dir?.[name];
    if (!entry) {
      throw "no-entry";
    }
    if (entry.dir) {
      throw "is-directory";
    }
    delete parent.dir[name];
    metadata(entry).linkCount--;
    touch(parent);
  }
  isSameObject(other) {
    return descriptorGetEntry(unwrapDescriptor(other)) === this.#entry;
  }
  metadataHash() {
    const value = metadata(this.#entry);
    return { upper: value.id, lower: value.version };
  }
  metadataHashAt(pathFlags, path) {
    const value = metadata(getChildEntry(this.#entry, path, pathFlags.symlinkFollow));
    return { upper: value.id, lower: value.version };
  }
  /**
   * Default advisory-locking implementation: a same-process reader/writer lock
   * keyed on the underlying entry. There's no real contention to wait out in a
   * single-threaded environment, so `lockShared`/`lockExclusive` don't block -
   * they throw `would-block` immediately when the lock isn't free, same as the
   * `tryLock*` variants report `false`.
   */
  tryLockShared() {
    const state = lockState(this.#entry);
    if (state.exclusiveHolder && state.exclusiveHolder !== this) {
      return false;
    }
    state.sharedHolders.add(this);
    return true;
  }
  tryLockExclusive() {
    const state = lockState(this.#entry);
    if (state.exclusiveHolder && state.exclusiveHolder !== this) {
      return false;
    }
    const otherReaders = state.sharedHolders.size - (state.sharedHolders.has(this) ? 1 : 0);
    if (otherReaders > 0) {
      return false;
    }
    state.sharedHolders.delete(this);
    state.exclusiveHolder = this;
    return true;
  }
  lockShared() {
    if (!this.tryLockShared()) {
      throw "would-block";
    }
  }
  lockExclusive() {
    if (!this.tryLockExclusive()) {
      throw "would-block";
    }
  }
  unlock() {
    const state = fileLocks.get(this.#entry);
    if (!state) {
      return;
    }
    state.sharedHolders.delete(this);
    if (state.exclusiveHolder === this) {
      state.exclusiveHolder = null;
    }
  }
};
var descriptorGetEntry = Descriptor.prototype._getEntry;
delete Descriptor.prototype._getEntry;
var descriptorCreate = Descriptor._create;
delete Descriptor._create;
var UNWRAP_DESCRIPTOR = /* @__PURE__ */ Symbol("browserFilesystemDescriptor.unwrap");
function unwrapDescriptor(descriptor) {
  let current = descriptor;
  for (; ; ) {
    const inner = current[UNWRAP_DESCRIPTOR];
    if (!inner || inner === current) {
      return current;
    }
    current = inner;
  }
}
var InMemoryFilesystemAdapter = class {
  getRoot(capability) {
    if (!capability.dir) {
      throw new TypeError("an in-memory preopen root must be a directory");
    }
    rootEntries.add(capability);
    return descriptorCreate(capability);
  }
};

// node_modules/@bytecodealliance/preview2-shim/dist/browser/filesystem.js
var DirectoryEntryStream2 = class _DirectoryEntryStream {
  #implementation;
  static _create(implementation) {
    const stream = new _DirectoryEntryStream();
    stream.#implementation = implementation;
    return stream;
  }
  readDirectoryEntry() {
    return this.#implementation.readDirectoryEntry();
  }
};
var directoryEntryStreamCreate = DirectoryEntryStream2._create;
delete DirectoryEntryStream2._create;
var Descriptor2 = class _Descriptor {
  #implementation;
  _getImplementation(descriptor) {
    return descriptor.#implementation;
  }
  static _create(implementation) {
    const descriptor = new _Descriptor();
    descriptor.#implementation = implementation;
    return descriptor;
  }
  readViaStream(offset) {
    return this.#implementation.readViaStream(offset);
  }
  writeViaStream(offset) {
    return this.#implementation.writeViaStream(offset);
  }
  appendViaStream() {
    return this.#implementation.appendViaStream();
  }
  advise(offset, length, advice) {
    return this.#implementation.advise(offset, length, advice);
  }
  syncData() {
    return this.#implementation.syncData();
  }
  getFlags() {
    return this.#implementation.getFlags();
  }
  getType() {
    return this.#implementation.getType();
  }
  setSize(size) {
    return this.#implementation.setSize(size);
  }
  setTimes(dataAccessTimestamp, dataModificationTimestamp) {
    return this.#implementation.setTimes(dataAccessTimestamp, dataModificationTimestamp);
  }
  read(length, offset) {
    return this.#implementation.read(length, offset);
  }
  write(buffer, offset) {
    return this.#implementation.write(buffer, offset);
  }
  readDirectory() {
    return directoryEntryStreamCreate(this.#implementation.readDirectory());
  }
  sync() {
    return this.#implementation.sync();
  }
  createDirectoryAt(path) {
    return this.#implementation.createDirectoryAt(path);
  }
  stat() {
    return this.#implementation.stat();
  }
  statAt(pathFlags, path) {
    return this.#implementation.statAt(pathFlags, path);
  }
  setTimesAt(pathFlags, path, dataAccessTimestamp, dataModificationTimestamp) {
    return this.#implementation.setTimesAt(pathFlags, path, dataAccessTimestamp, dataModificationTimestamp);
  }
  linkAt(oldPathFlags, oldPath, newDescriptor, newPath) {
    return this.#implementation.linkAt(oldPathFlags, oldPath, descriptorGetImplementation(newDescriptor), newPath);
  }
  openAt(pathFlags, path, openFlags, flags) {
    return descriptorCreate2(this.#implementation.openAt(pathFlags, path, openFlags, flags));
  }
  readlinkAt(path) {
    return this.#implementation.readlinkAt(path);
  }
  removeDirectoryAt(path) {
    return this.#implementation.removeDirectoryAt(path);
  }
  renameAt(oldPath, newDescriptor, newPath) {
    return this.#implementation.renameAt(oldPath, descriptorGetImplementation(newDescriptor), newPath);
  }
  symlinkAt(oldPath, newPath) {
    return this.#implementation.symlinkAt(oldPath, newPath);
  }
  unlinkFileAt(path) {
    return this.#implementation.unlinkFileAt(path);
  }
  isSameObject(other) {
    return this.#implementation.isSameObject(descriptorGetImplementation(other));
  }
  metadataHash() {
    return this.#implementation.metadataHash();
  }
  metadataHashAt(pathFlags, path) {
    return this.#implementation.metadataHashAt(pathFlags, path);
  }
  lockShared() {
    return this.#implementation.lockShared?.();
  }
  lockExclusive() {
    return this.#implementation.lockExclusive?.();
  }
  tryLockShared() {
    return this.#implementation.tryLockShared?.() ?? false;
  }
  tryLockExclusive() {
    return this.#implementation.tryLockExclusive?.() ?? false;
  }
  unlock() {
    return this.#implementation.unlock?.();
  }
};
var descriptorGetImplementation = Descriptor2.prototype._getImplementation;
delete Descriptor2.prototype._getImplementation;
var descriptorCreate2 = Descriptor2._create;
delete Descriptor2._create;
var defaultAdapter = new InMemoryFilesystemAdapter();
var _preopens = [];
var preopens = {
  getDirectories() {
    return _preopens;
  }
};
var types = {
  Descriptor: Descriptor2,
  DirectoryEntryStream: DirectoryEntryStream2,
  filesystemErrorCode: (err) => {
    let message;
    if ("payload" in err) {
      message = err.payload;
    } else if ("message" in err) {
      message = err.message;
    }
    return convertFsError(message);
  }
};
function convertFsError(e) {
  switch (e.code) {
    case "EACCES":
      return "access";
    case "EAGAIN":
    case "EWOULDBLOCK":
      return "would-block";
    case "EALREADY":
      return "already";
    case "EBADF":
      return "bad-descriptor";
    case "EBUSY":
      return "busy";
    case "EDEADLK":
      return "deadlock";
    case "EDQUOT":
      return "quota";
    case "EEXIST":
      return "exist";
    case "EFBIG":
      return "file-too-large";
    case "EILSEQ":
      return "illegal-byte-sequence";
    case "EINPROGRESS":
      return "in-progress";
    case "EINTR":
      return "interrupted";
    case "EINVAL":
      return "invalid";
    case "EIO":
      return "io";
    case "EISDIR":
      return "is-directory";
    case "ELOOP":
      return "loop";
    case "EMLINK":
      return "too-many-links";
    case "EMSGSIZE":
      return "message-size";
    case "ENAMETOOLONG":
      return "name-too-long";
    case "ENODEV":
      return "no-device";
    case "ENOENT":
      return "no-entry";
    case "ENOLCK":
      return "no-lock";
    case "ENOMEM":
      return "insufficient-memory";
    case "ENOSPC":
      return "insufficient-space";
    case "ENOTDIR":
    case "ERR_FS_EISDIR":
      return "not-directory";
    case "ENOTEMPTY":
      return "not-empty";
    case "ENOTRECOVERABLE":
      return "not-recoverable";
    case "ENOTSUP":
      return "unsupported";
    case "ENOTTY":
      return "no-tty";
    // windows gives this error for badly structured `//` reads
    // this seems like a slightly better error than unknown given
    // that it's a common footgun
    case -4094:
    case "ENXIO":
      return "no-such-device";
    case "EOVERFLOW":
      return "overflow";
    case "EPERM":
      return "not-permitted";
    case "EPIPE":
      return "pipe";
    case "EROFS":
      return "read-only";
    case "ESPIPE":
      return "invalid-seek";
    case "ETXTBSY":
      return "text-file-busy";
    case "EXDEV":
      return "cross-device";
    case "UNKNOWN":
      switch (e.errno) {
        case -4094:
          return "no-such-device";
        default:
          throw e;
      }
    default:
      throw e;
  }
}

// node_modules/@bytecodealliance/preview2-shim/dist/browser/random.js
var MAX_BYTES = 65536;
var insecureRandomValue1;
var insecureRandomValue2;
var random = {
  getRandomBytes(len) {
    const byteLength = checkedU64AsNumber(len, "random byte length");
    const bytes = new Uint8Array(byteLength);
    if (byteLength > MAX_BYTES) {
      for (let generated = 0; generated < byteLength; generated += MAX_BYTES) {
        crypto.getRandomValues(bytes.subarray(generated, generated + MAX_BYTES));
      }
    } else {
      crypto.getRandomValues(bytes);
    }
    return bytes;
  },
  getRandomU64() {
    return crypto.getRandomValues(new BigUint64Array(1))[0];
  },
  // @ts-expect-error Not defined in WIT
  insecureRandom() {
    if (insecureRandomValue1 === void 0 || insecureRandomValue2 === void 0) {
      insecureRandomValue1 = random.getRandomU64();
      insecureRandomValue2 = random.getRandomU64();
    }
    return [insecureRandomValue1, insecureRandomValue2];
  }
};

// src/wasm/protocol.js
var { getEnvironment } = environment;
if (getEnvironment === void 0) {
  const err = new Error("unexpectedly undefined local import 'getEnvironment', was 'getEnvironment' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { exit: exit2 } = exit;
if (exit2 === void 0) {
  const err = new Error("unexpectedly undefined local import 'exit', was 'exit' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { getStderr } = stderr;
if (getStderr === void 0) {
  const err = new Error("unexpectedly undefined local import 'getStderr', was 'getStderr' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { getStdin } = stdin;
if (getStdin === void 0) {
  const err = new Error("unexpectedly undefined local import 'getStdin', was 'getStdin' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { getStdout } = stdout;
if (getStdout === void 0) {
  const err = new Error("unexpectedly undefined local import 'getStdout', was 'getStdout' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { now } = monotonicClock;
if (now === void 0) {
  const err = new Error("unexpectedly undefined local import 'now', was 'now' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { now: now$1 } = wallClock;
if (now$1 === void 0) {
  const err = new Error("unexpectedly undefined local import 'now$1', was 'now' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { getDirectories } = preopens;
if (getDirectories === void 0) {
  const err = new Error("unexpectedly undefined local import 'getDirectories', was 'getDirectories' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var {
  Descriptor: Descriptor3,
  filesystemErrorCode
} = types;
if (Descriptor3 === void 0) {
  const err = new Error("unexpectedly undefined local import 'Descriptor', was 'Descriptor' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
if (filesystemErrorCode === void 0) {
  const err = new Error("unexpectedly undefined local import 'filesystemErrorCode', was 'filesystemErrorCode' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { Error: Error$1 } = error;
if (Error$1 === void 0) {
  const err = new Error("unexpectedly undefined local import 'Error$1', was 'Error' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var {
  InputStream: InputStream2,
  OutputStream: OutputStream2
} = streams;
if (InputStream2 === void 0) {
  const err = new Error("unexpectedly undefined local import 'InputStream', was 'InputStream' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
if (OutputStream2 === void 0) {
  const err = new Error("unexpectedly undefined local import 'OutputStream', was 'OutputStream' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var { getRandomBytes } = random;
if (getRandomBytes === void 0) {
  const err = new Error("unexpectedly undefined local import 'getRandomBytes', was 'getRandomBytes' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}
var dv = new DataView(new ArrayBuffer());
var dataView = (mem) => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);
function toUint64(val) {
  const converted = BigInt(val);
  return BigInt.asUintN(64, converted);
}
function toUint16(val) {
  val >>>= 0;
  val %= 2 ** 16;
  return val;
}
function toUint32(val) {
  return val >>> 0;
}
function toUint8(val) {
  val >>>= 0;
  val %= 2 ** 8;
  return val;
}
function _isValidNumericPrimitive(ty, v) {
  if (v === void 0 || v === null) {
    return false;
  }
  switch (ty) {
    case "bool":
      return v === 0 || v === 1;
      break;
    case "u8":
      return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255;
      break;
    case "s8":
      return typeof v === "number" && Number.isInteger(v) && v >= -128 && v <= 127;
      break;
    case "u16":
      return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 65535;
      break;
    case "s16":
      return typeof v === "number" && Number.isInteger(v) && v >= -32768 && v <= 32767;
    case "u32":
      return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4294967295;
    case "s32":
      return typeof v === "number" && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
    case "u64":
      return typeof v === "bigint" && v >= 0 && v <= 18446744073709551615n;
    case "s64":
      return typeof v === "bigint" && v >= -9223372036854775808n && v <= 9223372036854775807n;
      break;
    case "f32":
    case "f64":
      return typeof v === "number";
    default:
      return false;
  }
  return true;
}
function _requireValidNumericPrimitive(ty, v) {
  if (v === void 0 || v === null || !_isValidNumericPrimitive(ty, v)) {
    throw new TypeError(`invalid ${ty} value [${v}]`);
  }
  return true;
}
var isLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function _utf16AllocateAndEncode(str, realloc, memory) {
  const len = str.length;
  const ptr = realloc(0, 0, 2, len * 2);
  const out = new Uint16Array(memory.buffer, ptr, len);
  let i = 0;
  if (isLE) {
    while (i < len) {
      out[i] = str.charCodeAt(i++);
    }
  } else {
    while (i < len) {
      const ch = str.charCodeAt(i);
      out[i++] = (ch & 255) << 8 | ch >>> 8;
    }
  }
  return { ptr, len, codepoints: [...str].length };
}
var TEXT_DECODER_UTF8 = new TextDecoder();
var TEXT_ENCODER_UTF8 = new TextEncoder();
function _utf8AllocateAndEncode(s, realloc, memory) {
  if (typeof s !== "string") {
    throw new TypeError("expected a string, received [" + typeof s + "]");
  }
  if (s.length === 0) {
    return { ptr: 1, len: 0 };
  }
  let len = 0;
  let codepoints = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    codepoints++;
    if (ch < 128) {
      len += 1;
    } else if (ch < 2048) {
      len += 2;
    } else if (ch >= 55296 && ch <= 56319 && i + 1 < s.length && (s.charCodeAt(i + 1) & 64512) === 56320) {
      len += 4;
      i++;
    } else {
      len += 3;
    }
  }
  const ptr = realloc(0, 0, 1, len);
  const { read, written } = TEXT_ENCODER_UTF8.encodeInto(
    s,
    new Uint8Array(memory.buffer, ptr, len)
  );
  if (read !== s.length || written !== len) {
    throw new Error("failed to encode whole string");
  }
  const res = { ptr, len, codepoints };
  return res;
}
var T_FLAG = 1 << 30;
function rscTableCreateOwn(table, rep2) {
  const free = table[0] & ~T_FLAG;
  table._createdReps.add(rep2);
  if (free === 0) {
    table.push(0);
    table.push(rep2 | T_FLAG);
    return (table.length >> 1) - 1;
  }
  table[0] = table[free << 1];
  table[free << 1] = 0;
  table[(free << 1) + 1] = rep2 | T_FLAG;
  return free;
}
var RESOURCE_SCOPE_TASKS = /* @__PURE__ */ new Map();
var WebAssemblyRuntimeError = WebAssembly.RuntimeError;
function rscTableRemove(table, handle) {
  const scope = table[handle << 1];
  const val = table[(handle << 1) + 1];
  const own = (val & T_FLAG) !== 0;
  const rep2 = val & ~T_FLAG;
  if (val === 0 || (scope & T_FLAG) !== 0) {
    throw new WebAssemblyRuntimeError(`unknown handle index ${(handle << 1) + 1}`);
  }
  if (own && scope !== 0) {
    throw new WebAssemblyRuntimeError("cannot remove owned resource while borrowed");
  }
  const borrowTask = own ? void 0 : RESOURCE_SCOPE_TASKS.get(scope);
  table[handle << 1] = table[0] | T_FLAG;
  table[0] = handle | T_FLAG;
  borrowTask?.removeBorrowedHandle();
  return { rep: rep2, scope, own };
}
var RESOURCE_SCOPE_ID = 0;
var curResourceBorrows = [];
var ASYNC_TASKS_BY_COMPONENT_IDX = /* @__PURE__ */ new Map();
var ASYNC_CURRENT_COMPONENT_IDXS = [];
function getCurrentTask(componentIdx2, taskID) {
  let usedGlobal = false;
  if (componentIdx2 === void 0 || componentIdx2 === null) {
    throw new Error("missing component idx");
  }
  const taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx2);
  if (taskMetas === void 0 || taskMetas.length === 0) {
    return void 0;
  }
  if (taskID) {
    return taskMetas.find((meta) => meta.task.id() === taskID);
  }
  const taskMeta = taskMetas[taskMetas.length - 1];
  if (!taskMeta || !taskMeta.task) {
    return void 0;
  }
  return taskMeta;
}
var ASYNC_CURRENT_TASK_IDS = [];
var _debugLog = (...args) => {
  if (!globalThis?.process?.env?.JCO_DEBUG) {
    return;
  }
  console.debug(...args);
};
function clearCurrentTask(componentIdx2, taskID) {
  _debugLog("[clearCurrentTask()] args", { componentIdx: componentIdx2, taskID });
  if (componentIdx2 === void 0 || componentIdx2 === null) {
    throw new Error("missing/invalid component instance index while ending current task");
  }
  const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx2);
  if (!tasks || !Array.isArray(tasks)) {
    throw new Error("missing/invalid tasks for component instance while ending task");
  }
  if (tasks.length == 0) {
    throw new Error(`no current tasks for component instance [${componentIdx2}] while ending task`);
  }
  if (taskID !== void 0) {
    const last = tasks[tasks.length - 1];
    if (last.id !== taskID) {
      return;
    }
  }
  ASYNC_CURRENT_TASK_IDS.pop();
  ASYNC_CURRENT_COMPONENT_IDXS.pop();
  const taskMeta = tasks.pop();
  return taskMeta.task;
}
var ASYNC_STATE = /* @__PURE__ */ new Map();
function promiseWithResolvers() {
  if (Promise.withResolvers) {
    return Promise.withResolvers();
  } else {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
}
var Waitable = class {
  #componentIdx;
  #pendingEventFn = null;
  #promise;
  #resolve;
  #reject;
  #waitableSet = null;
  #hasSyncWaiter = false;
  #idx = null;
  // to component-global waitables
  target;
  constructor(args) {
    const { componentIdx: componentIdx2, target } = args;
    this.#componentIdx = componentIdx2;
    this.target = args.target;
    this.#resetPromise();
  }
  componentIdx() {
    return this.#componentIdx;
  }
  isInSet() {
    return this.#waitableSet !== null;
  }
  idx() {
    return this.#idx;
  }
  setIdx(idx) {
    if (idx === 0) {
      throw new Error("waitable idx cannot be zero");
    }
    this.#idx = idx;
  }
  setTarget(tgt) {
    this.target = tgt;
  }
  #resetPromise() {
    const { promise, resolve, reject } = promiseWithResolvers();
    this.#promise = promise;
    this.#resolve = resolve;
    this.#reject = reject;
  }
  resolve() {
    this.#resolve();
  }
  reject(err) {
    this.#reject(err);
  }
  promise() {
    return this.#promise;
  }
  hasPendingEvent() {
    return this.#pendingEventFn !== null;
  }
  setPendingEvent(fn) {
    _debugLog("[Waitable#setPendingEvent()] args", {
      waitable: this,
      inSet: this.#waitableSet
    });
    this.#pendingEventFn = fn;
  }
  getPendingEvent() {
    _debugLog("[Waitable#getPendingEvent()] args", {
      waitable: this,
      inSet: this.#waitableSet,
      hasPendingEvent: this.#pendingEventFn !== null
    });
    if (this.#pendingEventFn === null) {
      return null;
    }
    const eventFn = this.#pendingEventFn;
    this.#pendingEventFn = null;
    const e = eventFn();
    this.#resetPromise();
    return e;
  }
  join(waitableSet) {
    _debugLog("[Waitable#join()] args", {
      waitable: this,
      waitableSet,
      isRemoval: waitableSet === null
    });
    if (this.#waitableSet === void 0) {
      throw new TypeError("waitable set must be not be undefined");
    }
    if (this.#waitableSet) {
      this.#waitableSet.removeWaitable(this);
    }
    this.#waitableSet = waitableSet;
    if (waitableSet) {
      this.#waitableSet.addWaitable(this);
    }
  }
  drop() {
    _debugLog("[Waitable#drop()] args", {
      componentIdx: this.#componentIdx,
      waitable: this
    });
    if (this.hasPendingEvent()) {
      throw new Error("waitables with pending events cannot be dropped");
    }
    this.join(null);
  }
  async waitForPendingEvent(args) {
    const { cstate } = args;
    if (!cstate) {
      throw new TypeError("missing component state");
    }
    if (this.#waitableSet !== null || this.#hasSyncWaiter) {
      throw new Error("waitable is already in a set/has a sync waiter");
    }
    this.#hasSyncWaiter = true;
    await cstate.waitUntil({
      cancellable: false,
      readyFn: () => this.hasPendingEvent()
    });
    this.#hasSyncWaiter = false;
  }
};
var INSTANCE_FLAGS = /* @__PURE__ */ new Map();
var STORE_TRAP = { error: null };
var STORE_ASYNC_STATE = { deadlockCheck: null, pendingHostOperations: 0 };
function _checkForDeadlock() {
  if (STORE_ASYNC_STATE.deadlockCheck !== null || STORE_TRAP.error !== null) {
    return;
  }
  STORE_ASYNC_STATE.deadlockCheck = setTimeout(() => {
    STORE_ASYNC_STATE.deadlockCheck = null;
    if (STORE_TRAP.error !== null || STORE_ASYNC_STATE.pendingHostOperations > 0) {
      return;
    }
    const suspendedTasks = /* @__PURE__ */ new Set();
    for (const state of ASYNC_STATE.values()) {
      if (state.hasPendingSchedulerWork()) {
        state.runTickLoop();
        return;
      }
      for (const meta of state.suspendedTaskMetas()) {
        suspendedTasks.add(meta.task);
      }
    }
    const unresolvedRoots = /* @__PURE__ */ new Set();
    for (const task of suspendedTasks) {
      const root = task.getRootTask();
      if (!root.isResolvedState()) {
        unresolvedRoots.add(root);
      }
    }
    if (unresolvedRoots.size === 0) {
      return;
    }
    const err = new WebAssemblyRuntimeError("wasm trap: deadlock detected: event loop cannot make further progress");
    err.deadlockDetail = {
      pendingHostOperations: STORE_ASYNC_STATE.pendingHostOperations,
      suspendedTasks: [...suspendedTasks].map((task) => ({
        taskID: task.id(),
        componentIdx: task.componentIdx(),
        state: task.taskState(),
        rootTaskID: task.getRootTask().id()
      })),
      unresolvedRootTaskIDs: [...unresolvedRoots].map((root) => root.id())
    };
    STORE_TRAP.error = err;
    for (const root of unresolvedRoots) {
      root.setErrored(err);
      root.reject(err);
    }
    for (const task of suspendedTasks) {
      if (!task.isResolvedState() && unresolvedRoots.has(task.getRootTask())) {
        task.setErrored(err);
        task.reject(err);
      }
    }
    for (const state of ASYNC_STATE.values()) {
      state.runTickLoop();
    }
  }, 0);
}
var CORE_TRAP_MESSAGES = /* @__PURE__ */ new Map([
  ["unreachable", "wasm trap: wasm `unreachable` instruction executed"],
  ["memory access out of bounds", "wasm trap: out of bounds memory access"],
  ["divide by zero", "wasm trap: integer divide by zero"],
  ["remainder by zero", "wasm trap: integer divide by zero"],
  ["divide result unrepresentable", "wasm trap: integer overflow"],
  ["float unrepresentable in integer range", "wasm trap: invalid conversion to integer"],
  ["table index is out of bounds", "wasm trap: undefined element: out of bounds table access"],
  ["function signature mismatch", "wasm trap: indirect call type mismatch"],
  ["call stack exhausted", "wasm trap: call stack exhausted"]
]);
function _normalizeCoreTrap(err) {
  if (!(err instanceof WebAssemblyRuntimeError)) {
    return err;
  }
  const message = CORE_TRAP_MESSAGES.get(err.message);
  if (message !== void 0) {
    err.message = message;
  }
  return err;
}
var RepTable = class _RepTable {
  // Sentinel marking a freed slot; the freelist link for a freed slot
  // lives in the odd cell. This keeps get()/contains()/remove() on freed
  // reps well-defined (previously they returned/corrupted freelist links).
  static FREE = /* @__PURE__ */ Symbol("RepTable.free");
  #data = [0, null];
  #size = 0;
  #target;
  constructor(args) {
    this.target = args?.target;
  }
  data() {
    return this.#data;
  }
  insert(val) {
    _debugLog("[RepTable#insert()] args", { val, target: this.target });
    const freeIdx = this.#data[0];
    if (freeIdx === 0) {
      this.#data.push(val);
      this.#data.push(null);
      const rep2 = (this.#data.length >> 1) - 1;
      _debugLog("[RepTable#insert()] inserted", { val, target: this.target, rep: rep2 });
      this.#size += 1;
      return rep2;
    }
    const placementIdx = freeIdx << 1;
    if (this.#data[placementIdx] !== _RepTable.FREE) {
      throw new Error("corrupt rep table freelist: head does not point at a freed slot");
    }
    this.#data[0] = this.#data[placementIdx + 1];
    this.#data[placementIdx] = val;
    this.#data[placementIdx + 1] = null;
    _debugLog("[RepTable#insert()] inserted", { val, target: this.target, rep: freeIdx });
    this.#size += 1;
    return freeIdx;
  }
  get(rep2) {
    _debugLog("[RepTable#get()] args", { rep: rep2, target: this.target });
    if (rep2 === 0) {
      throw new Error("invalid resource rep during get, (cannot be 0)");
    }
    const baseIdx = rep2 << 1;
    const val = this.#data[baseIdx];
    if (val === _RepTable.FREE) {
      return void 0;
    }
    return val;
  }
  contains(rep2) {
    _debugLog("[RepTable#contains()] args", { rep: rep2, target: this.target });
    if (rep2 === 0) {
      throw new Error("invalid resource rep during contains, (cannot be 0)");
    }
    const baseIdx = rep2 << 1;
    const val = this.#data[baseIdx];
    return val !== _RepTable.FREE && !!val;
  }
  remove(rep2) {
    _debugLog("[RepTable#remove()] args", { rep: rep2, target: this.target });
    if (rep2 === 0) {
      throw new Error("invalid resource rep during remove, (cannot be 0)");
    }
    if (this.#data.length === 2) {
      throw new Error("invalid");
    }
    const baseIdx = rep2 << 1;
    if (baseIdx >= this.#data.length) {
      throw new Error(`invalid rep [${rep2}] during remove, out of range`);
    }
    const val = this.#data[baseIdx];
    if (val === _RepTable.FREE) {
      throw new Error(`double removal of rep [${rep2}] (already freed)`);
    }
    this.#data[baseIdx] = _RepTable.FREE;
    this.#data[baseIdx + 1] = this.#data[0];
    this.#data[0] = rep2;
    this.#size -= 1;
    return val;
  }
  size() {
    return this.#size;
  }
  clear() {
    _debugLog("[RepTable#clear()] args", { rep, target: this.target });
    this.#data = [0, null];
  }
};
var ComponentAsyncState = class _ComponentAsyncState {
  static EVENT_HANDLER_EVENTS = ["backpressure-change"];
  static TickResult = {
    // no suspended tasks remain
    DONE: "done",
    // a suspended task was resumed (more may be ready)
    RESUMED: "resumed",
    // suspended tasks remain but none were ready
    IDLE: "idle"
  };
  #componentIdx;
  #callingAsyncImport = false;
  #syncImportWait = promiseWithResolvers();
  #lockHolderTaskID = null;
  #lockWaiters = [];
  #lockHandoffScheduled = false;
  #pendingTaskStarts = 0;
  #parkedTasks = /* @__PURE__ */ new Map();
  #suspendedTasksByTaskID = /* @__PURE__ */ new Map();
  #suspendedTaskIDs = [];
  #errored = null;
  #trapped = false;
  #backpressure = 0;
  #backpressureWaiters = 0n;
  #handlerMap = /* @__PURE__ */ new Map();
  #nextHandlerID = 0n;
  #tickLoop = null;
  #tickLoopInterval = null;
  #onExclusiveReleaseHandlers = [];
  #mayLeave = true;
  handles;
  subtasks;
  constructor(args) {
    this.#componentIdx = args.componentIdx;
    this.handles = new RepTable({ target: `component [${this.#componentIdx}] handles (waitable objects)` });
    this.subtasks = new RepTable({ target: `component [${this.#componentIdx}] subtasks` });
  }
  componentIdx() {
    return this.#componentIdx;
  }
  get mayLeave() {
    const flags = INSTANCE_FLAGS.get(this.#componentIdx);
    return flags === void 0 ? this.#mayLeave : flags.value === 1;
  }
  set mayLeave(value) {
    if (typeof value !== "boolean") {
      throw new TypeError("mayLeave must be a boolean");
    }
    this.#mayLeave = value;
    const flags = INSTANCE_FLAGS.get(this.#componentIdx);
    if (flags !== void 0) {
      flags.value = value ? 1 : 0;
    }
  }
  errored() {
    return this.#errored !== null;
  }
  setErrored(err) {
    _debugLog("[ComponentAsyncState#setErrored()] component errored", { err, componentIdx: this.#componentIdx });
    if (this.#errored) {
      return;
    }
    if (!err) {
      err = new Error("error elswehere (see other component instance error)");
      err.componentIdx = this.#componentIdx;
    }
    this.#errored = err;
  }
  markTrapped(err) {
    if (!(err instanceof WebAssemblyRuntimeError)) {
      return false;
    }
    err = _normalizeCoreTrap(err);
    this.#trapped = true;
    _debugLog("[ComponentAsyncState#markTrapped()] component trapped", { err, componentIdx: this.#componentIdx });
    if (STORE_TRAP.error === null) {
      STORE_TRAP.error = err;
    }
    return true;
  }
  throwIfTrapped() {
    if (this.#trapped) {
      throw new WebAssemblyRuntimeError("wasm trap: cannot enter component instance");
    }
  }
  callingSyncImport(val) {
    if (val === void 0) {
      return this.#callingAsyncImport;
    }
    if (typeof val !== "boolean") {
      throw new TypeError("invalid setting for async import");
    }
    const prev = this.#callingAsyncImport;
    this.#callingAsyncImport = val;
    if (prev === true && this.#callingAsyncImport === false) {
      this.#notifySyncImportEnd();
    }
  }
  #notifySyncImportEnd() {
    const existing = this.#syncImportWait;
    this.#syncImportWait = promiseWithResolvers();
    existing.resolve();
  }
  async waitForSyncImportCallEnd() {
    await this.#syncImportWait.promise;
  }
  setBackpressure(v) {
    this.#backpressure = v;
    return this.#backpressure;
  }
  getBackpressure() {
    return this.#backpressure;
  }
  incrementBackpressure() {
    const current = this.#backpressure;
    if (current < 0 || current > 2 ** 16) {
      throw new Error(`invalid current backpressure value [${current}]`);
    }
    const newValue = this.getBackpressure() + 1;
    if (newValue >= 2 ** 16) {
      throw new Error(`invalid new backpressure value [${newValue}], overflow`);
    }
    return this.setBackpressure(newValue);
  }
  decrementBackpressure() {
    const current = this.#backpressure;
    if (current < 0 || current > 2 ** 16) {
      throw new Error(`invalid current backpressure value [${current}]`);
    }
    const newValue = Math.max(0, current - 1);
    if (newValue < 0) {
      throw new Error(`invalid new backpressure value [${newValue}], underflow`);
    }
    return this.setBackpressure(newValue);
  }
  hasBackpressure() {
    return this.#backpressure > 0;
  }
  waitForBackpressure() {
    let backpressureCleared = false;
    const cstate = this;
    cstate.addBackpressureWaiter();
    const handlerID = this.registerHandler({
      event: "backpressure-change",
      fn: (bp) => {
        if (bp === 0) {
          cstate.removeHandler(handlerID);
          backpressureCleared = true;
        }
      }
    });
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (backpressureCleared) {
          return;
        }
        clearInterval(interval);
        cstate.removeBackpressureWaiter();
        resolve(null);
      }, 0);
    });
  }
  registerHandler(args) {
    const { event, fn } = args;
    if (!event) {
      throw new Error("missing handler event");
    }
    if (!fn) {
      throw new Error("missing handler fn");
    }
    if (!_ComponentAsyncState.EVENT_HANDLER_EVENTS.includes(event)) {
      throw new Error(`unrecognized event handler [${event}]`);
    }
    const handlerID = this.#nextHandlerID++;
    let handlers = this.#handlerMap.get(event);
    if (!handlers) {
      handlers = [];
      this.#handlerMap.set(event, handlers);
    }
    handlers.push({ id: handlerID, fn, event });
    return handlerID;
  }
  removeHandler(args) {
    const { event, handlerID } = args;
    const registeredHandlers = this.#handlerMap.get(event);
    if (!registeredHandlers) {
      return;
    }
    const found = registeredHandlers.find((h) => h.id === handlerID);
    if (!found) {
      return;
    }
    this.#handlerMap.set(event, this.#handlerMap.get(event).filter((h) => h.id !== handlerID));
  }
  getBackpressureWaiters() {
    return this.#backpressureWaiters;
  }
  addBackpressureWaiter() {
    this.#backpressureWaiters++;
  }
  removeBackpressureWaiter() {
    this.#backpressureWaiters--;
    if (this.#backpressureWaiters < 0) {
      throw new Error("unexepctedly negative number of backpressure waiters");
    }
  }
  // The per-slice mutual-exclusion lock for guest execution in this
  // component instance. Guest slices (callback invocations and
  // sync-lifted bodies) must be atomic per component even across the
  // JSPI suspensions jco introduces for host imports: wit-bindgen's
  // executors publish per-task state in single linear-memory cells
  // (the wasip3-task pointer, context-local storage discipline) that
  // an interleaved slice of the same component corrupts
  //
  // The lock is *owned*: acquisition records the holder task and
  // release is a no-op for anyone else, so a task exiting can no
  // longer drop a hold it does not own (blind acquire/release-any
  // was the previous discipline). Contended acquisition queues
  // FIFO; release hands the lock to the next waiter directly.
  isExclusivelyLocked() {
    return this.#lockHolderTaskID !== null;
  }
  exclusivelyLockedBy(taskID) {
    return this.#lockHolderTaskID === taskID;
  }
  exclusiveLock(taskID) {
    _debugLog("[ComponentAsyncState#exclusiveLock()]", {
      holder: this.#lockHolderTaskID,
      requester: taskID,
      componentIdx: this.#componentIdx
    });
    if (taskID === void 0 || taskID === null) {
      throw new Error("exclusive lock requires the acquiring task id");
    }
    if (this.#lockHolderTaskID !== null) {
      throw new Error(`component [${this.#componentIdx}] exclusive lock held by task [${this.#lockHolderTaskID}], requested by [${taskID}]`);
    }
    this.#lockHolderTaskID = taskID;
  }
  // Awaitable acquisition: takes the lock immediately when free,
  // otherwise queues FIFO behind the current holder and earlier
  // waiters. The resolved promise implies ownership.
  acquireExclusiveLock(taskID) {
    if (taskID === void 0 || taskID === null) {
      throw new Error("exclusive lock requires the acquiring task id");
    }
    if (this.#lockHolderTaskID === null) {
      this.#lockHolderTaskID = taskID;
      _debugLog("[ComponentAsyncState#acquireExclusiveLock()] acquired", {
        holder: taskID,
        componentIdx: this.#componentIdx
      });
      return;
    }
    if (this.#lockHolderTaskID === taskID) {
      throw new Error(`task [${taskID}] already holds the lock for component [${this.#componentIdx}]`);
    }
    _debugLog("[ComponentAsyncState#acquireExclusiveLock()] waiting", {
      holder: this.#lockHolderTaskID,
      requester: taskID,
      componentIdx: this.#componentIdx,
      queued: this.#lockWaiters.length
    });
    return new Promise((resolve) => {
      this.#lockWaiters.push({ taskID, resolve });
    });
  }
  exclusiveRelease(taskID) {
    _debugLog("[ComponentAsyncState#exclusiveRelease()] args", {
      holder: this.#lockHolderTaskID,
      releaser: taskID,
      componentIdx: this.#componentIdx
    });
    if (this.#lockHolderTaskID !== taskID) {
      _debugLog("[ComponentAsyncState#exclusiveRelease()] ignoring foreign release", {
        holder: this.#lockHolderTaskID,
        releaser: taskID,
        componentIdx: this.#componentIdx
      });
      return false;
    }
    this.#lockHolderTaskID = null;
    this.#onExclusiveReleaseHandlers = this.#onExclusiveReleaseHandlers.filter((v) => !!v);
    for (const [idx, f] of this.#onExclusiveReleaseHandlers.entries()) {
      try {
        this.#onExclusiveReleaseHandlers[idx] = null;
        f();
      } catch (err) {
        _debugLog("error while executing handler for next exclusive release", err);
        throw err;
      }
    }
    this.#scheduleLockHandoff();
    return true;
  }
  #scheduleLockHandoff() {
    if (this.#lockHandoffScheduled || this.#lockWaiters.length === 0) {
      return;
    }
    this.#lockHandoffScheduled = true;
    queueMicrotask(() => {
      this.#lockHandoffScheduled = false;
      if (this.#lockHolderTaskID !== null) {
        this.#scheduleLockHandoff();
        return;
      }
      const next = this.#lockWaiters.shift();
      if (!next) {
        return;
      }
      this.#lockHolderTaskID = next.taskID;
      next.resolve();
    });
  }
  onNextExclusiveRelease(fn) {
    _debugLog("[ComponentAsyncState#()onNextExclusiveRelease] registering");
    this.#onExclusiveReleaseHandlers.push(fn);
  }
  async waitForExclusiveRelease() {
    while (this.isExclusivelyLocked()) {
      await new Promise((resolve) => this.onNextExclusiveRelease(resolve));
    }
  }
  #getSuspendedTaskMeta(taskID) {
    return this.#suspendedTasksByTaskID.get(taskID);
  }
  #removeSuspendedTaskMeta(taskID) {
    _debugLog("[ComponentAsyncState#removeSuspendedTaskMeta()] removing suspended task", {
      taskID,
      componentIdx: this.#componentIdx
    });
    const idx = this.#suspendedTaskIDs.findIndex((t) => t === taskID);
    const meta = this.#suspendedTasksByTaskID.get(taskID);
    this.#suspendedTaskIDs[idx] = null;
    this.#suspendedTasksByTaskID.delete(taskID);
    return meta;
  }
  #addSuspendedTaskMeta(meta) {
    if (!meta) {
      throw new Error("missing task meta");
    }
    const taskID = meta.taskID;
    this.#suspendedTasksByTaskID.set(taskID, meta);
    this.#suspendedTaskIDs.push(taskID);
    if (this.#suspendedTasksByTaskID.size < this.#suspendedTaskIDs.length - 10) {
      this.#suspendedTaskIDs = this.#suspendedTaskIDs.filter((t) => t !== null);
    }
  }
  // TODO(threads): readyFn is normally on the thread
  suspendTask(args) {
    const { task, readyFn, cancellable, onResume } = args;
    const taskID = task.id();
    const componentIdx2 = task.componentIdx();
    _debugLog("[ComponentAsyncState#suspendTask()]", {
      taskID,
      componentIdx: this.#componentIdx,
      taskEntryFnName: task.entryFnName(),
      subtask: task.getParentSubtask()
    });
    if (componentIdx2 !== this.#componentIdx) {
      throw new Error("assert: task component idx should match async state");
    }
    if (this.#getSuspendedTaskMeta(taskID)) {
      throw new Error(`task [${taskID}] already suspended`);
    }
    let promise;
    let resume;
    if (onResume) {
      resume = () => onResume(!task.isCancelled());
    } else {
      const resolvers = promiseWithResolvers();
      promise = resolvers.promise;
      resume = () => resolvers.resolve(!task.isCancelled());
    }
    this.#addSuspendedTaskMeta({
      task,
      taskID,
      cancellable,
      readyFn,
      resume: () => {
        _debugLog("[ComponentAsyncState] resuming suspended task", {
          taskID,
          componentIdx: this.#componentIdx
        });
        resume();
      }
    });
    task.notifyProgress();
    this.runTickLoop();
    _checkForDeadlock();
    return promise;
  }
  resumeTaskByID(taskID) {
    const meta = this.#removeSuspendedTaskMeta(taskID);
    if (!meta) {
      return false;
    }
    if (meta.taskID !== taskID) {
      throw new Error("task ID does not match");
    }
    meta.resume();
    return true;
  }
  suspendedTaskReady(taskID) {
    const meta = this.#getSuspendedTaskMeta(taskID);
    if (!meta) {
      return false;
    }
    if (!meta.readyFn) {
      throw new Error(`suspended task [${taskID}] is missing a readiness function`);
    }
    return meta.task.isRejected() || meta.readyFn();
  }
  suspendedTaskCancellable(taskID) {
    return !!this.#getSuspendedTaskMeta(taskID)?.cancellable;
  }
  isTaskSuspended(taskID) {
    return this.#suspendedTasksByTaskID.has(taskID);
  }
  suspendedTaskMetas() {
    return this.#suspendedTasksByTaskID.values();
  }
  addPendingTaskStart() {
    this.#pendingTaskStarts++;
  }
  removePendingTaskStart() {
    this.#pendingTaskStarts--;
  }
  hasPendingSchedulerWork() {
    if (this.#pendingTaskStarts > 0) {
      return true;
    }
    if (this.#lockHandoffScheduled) {
      return true;
    }
    for (const meta of this.#suspendedTasksByTaskID.values()) {
      if (meta.task.isRejected() || meta.readyFn()) {
        return true;
      }
    }
    return false;
  }
  async runTickLoop() {
    if (this.#tickLoop !== null) {
      return;
    }
    this.#tickLoop = 1;
    setTimeout(async () => {
      let result = this.tick();
      while (result !== _ComponentAsyncState.TickResult.DONE) {
        if (result === _ComponentAsyncState.TickResult.IDLE) {
          _checkForDeadlock();
        }
        const delay = result === _ComponentAsyncState.TickResult.RESUMED ? 0 : 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
        result = this.tick();
      }
      this.#tickLoop = null;
    }, 10);
  }
  tick() {
    const resumableTasks = this.#suspendedTaskIDs.filter((t) => t !== null);
    for (const taskID of resumableTasks) {
      const meta = this.#suspendedTasksByTaskID.get(taskID);
      if (!meta || !meta.readyFn) {
        throw new Error(`missing/invalid task despite ID [${taskID}] being present`);
      }
      if (meta.task.isRejected()) {
        _debugLog("[ComponentAsyncState#tick()] detected task rejection, leaving early", { meta });
        this.resumeTaskByID(taskID);
        return _ComponentAsyncState.TickResult.RESUMED;
      }
      const isReady = meta.readyFn();
      if (!isReady) {
        continue;
      }
      _debugLog("[ComponentAsyncState#tick()] resuming task via tick", {
        taskID,
        componentIdx: this.#componentIdx
      });
      this.resumeTaskByID(taskID);
      return _ComponentAsyncState.TickResult.RESUMED;
    }
    const idle = this.#suspendedTaskIDs.filter((t) => t !== null).length > 0;
    return idle ? _ComponentAsyncState.TickResult.IDLE : _ComponentAsyncState.TickResult.DONE;
  }
  createWaitable(args) {
    return new Waitable({ target: args?.target });
  }
};
function getOrCreateAsyncState(componentIdx2, init) {
  if (!ASYNC_STATE.has(componentIdx2)) {
    const newState = new ComponentAsyncState({ componentIdx: componentIdx2 });
    ASYNC_STATE.set(componentIdx2, newState);
  }
  return ASYNC_STATE.get(componentIdx2);
}
var GLOBAL_COMPONENT_MEMORY_MAP = /* @__PURE__ */ new Map();
function lookupMemoriesForComponent(args) {
  const { componentIdx: componentIdx2 } = args ?? {};
  if (args.componentIdx === void 0) {
    throw new TypeError("missing component idx");
  }
  const metas = GLOBAL_COMPONENT_MEMORY_MAP.get(componentIdx2);
  if (!metas) {
    return [];
  }
  if (args.memoryIdx === void 0) {
    return Object.values(metas);
  }
  const meta = metas[args.memoryIdx];
  return meta?.memory;
}
var AsyncSubtask = class _AsyncSubtask {
  static _ID = 0n;
  static State = {
    STARTING: 0,
    STARTED: 1,
    RETURNED: 2,
    CANCELLED_BEFORE_STARTED: 3,
    CANCELLED_BEFORE_RETURNED: 4
  };
  #id;
  #state = _AsyncSubtask.State.STARTING;
  #componentIdx;
  #parentTask;
  #childTask = null;
  #dropped = false;
  #cancelRequested = false;
  #memoryIdx = null;
  #lenders = null;
  #waitable = null;
  #callbackFn = null;
  #callbackFnName = null;
  #postReturnFn = null;
  #onProgressFn = null;
  #pendingEventFn = null;
  #callMetadata = {};
  #resolved = false;
  #onResolveHandlers = [];
  #onStartHandlers = [];
  #result = null;
  #resultSet = false;
  fnName;
  target;
  isAsync;
  isManualAsync;
  // One execution slice awaited by the conditional cancel trampoline.
  cancelProgress = null;
  constructor(args) {
    if (typeof args.componentIdx !== "number") {
      throw new Error("invalid componentIdx for subtask creation");
    }
    this.#componentIdx = args.componentIdx;
    this.#id = ++_AsyncSubtask._ID;
    this.fnName = args.fnName;
    if (!args.parentTask) {
      throw new Error("missing parent task during subtask creation");
    }
    this.#parentTask = args.parentTask;
    if (args.childTask) {
      this.#childTask = args.childTask;
    }
    if (args.memoryIdx) {
      this.#memoryIdx = args.memoryIdx;
    }
    if (!args.waitable) {
      throw new Error("missing/invalid waitable");
    }
    this.#waitable = args.waitable;
    if (args.callMetadata) {
      this.#callMetadata = args.callMetadata;
    }
    this.#lenders = [];
    this.target = args.target;
    this.isAsync = args.isAsync;
    this.isManualAsync = args.isManualAsync;
  }
  id() {
    return this.#id;
  }
  parentTaskID() {
    return this.#parentTask?.id();
  }
  childTaskID() {
    return this.#childTask?.id();
  }
  state() {
    return this.#state;
  }
  waitable() {
    return this.#waitable;
  }
  waitableRep() {
    return this.#waitable.idx();
  }
  join() {
    return this.#waitable.join(...arguments);
  }
  getPendingEvent() {
    return this.#waitable.getPendingEvent(...arguments);
  }
  hasPendingEvent() {
    return this.#waitable.hasPendingEvent(...arguments);
  }
  setPendingEvent() {
    return this.#waitable.setPendingEvent(...arguments);
  }
  setTarget(tgt) {
    this.target = tgt;
  }
  getResult() {
    if (!this.#resultSet) {
      throw new Error("subtask result has not been set");
    }
    return this.#result;
  }
  setResult(v) {
    if (this.#resultSet) {
      throw new Error("subtask result has already been set");
    }
    this.#result = v;
    this.#resultSet = true;
  }
  componentIdx() {
    return this.#componentIdx;
  }
  setChildTask(t) {
    if (!t) {
      throw new Error("cannot set missing/invalid child task on subtask");
    }
    if (this.#childTask) {
      throw new Error("child task is already set on subtask");
    }
    if (this.#parentTask === t) {
      throw new Error("parent cannot be child");
    }
    this.#childTask = t;
  }
  getChildTask(t) {
    return this.#childTask;
  }
  getParentTask() {
    return this.#parentTask;
  }
  setCallbackFn(f, name) {
    if (!f) {
      return;
    }
    if (this.#callbackFn) {
      throw new Error("callback fn can only be set once");
    }
    this.#callbackFn = f;
    this.#callbackFnName = name;
  }
  getCallbackFnName() {
    if (!this.#callbackFn) {
      return void 0;
    }
    return this.#callbackFn.name;
  }
  setPostReturnFn(f) {
    if (!f) {
      return;
    }
    if (this.#postReturnFn) {
      throw new Error("postReturn fn can only be set once");
    }
    this.#postReturnFn = f;
  }
  setOnProgressFn(f) {
    if (this.#onProgressFn) {
      throw new Error("on progress fn can only be set once");
    }
    this.#onProgressFn = f;
  }
  isNotStarted() {
    return this.#state == _AsyncSubtask.State.STARTING;
  }
  cancellationRequested() {
    return this.#cancelRequested;
  }
  // Request cooperative cancellation of this subtask, on behalf of the
  // supertask (i.e. `canon subtask.cancel`).
  //
  // If the callee is another guest task, the request is delivered to it and
  // the callee confirms via `task.cancel` (or still resolves via `task.return`).
  //
  // If the callee is a host function there is (currently) no host-side
  // cancellation hook, so the pending call is treated as immediately
  // cancelled -- consistent with hosts being expected to resolve
  // cancellation promptly -- and any later host resolution is discarded
  // (see `AsyncTask#onResolve`).
  requestCancellation() {
    _debugLog("[AsyncSubtask#requestCancellation()] args", {
      componentIdx: this.#componentIdx,
      subtaskID: this.#id,
      state: this.#state,
      childTaskID: this.childTaskID(),
      fnName: this.fnName
    });
    if (this.#cancelRequested) {
      throw new Error("cancellation has already been requested for this subtask");
    }
    this.#cancelRequested = true;
    if (this.#resolved) {
      return;
    }
    if (this.#childTask) {
      this.#childTask.requestCancellation();
      return;
    }
    this.onResolve(null);
  }
  registerOnStartHandler(f) {
    this.#onStartHandlers.push(f);
  }
  onStart(args) {
    _debugLog("[AsyncSubtask#onStart()] args", {
      componentIdx: this.#componentIdx,
      subtaskID: this.#id,
      parentTaskID: this.parentTaskID(),
      fnName: this.fnName,
      args
    });
    if (this.#onProgressFn) {
      this.#onProgressFn();
    }
    this.#parentTask.notifyProgress();
    this.#state = _AsyncSubtask.State.STARTED;
    let result;
    if (this.#callMetadata.startFn) {
      result = this.#callMetadata.startFn.apply(null, args?.startFnParams ?? []);
    }
    return result;
  }
  registerOnResolveHandler(f) {
    this.#onResolveHandlers.push(f);
  }
  reject(subtaskErr) {
    if (this.#resolved) {
      return;
    }
    if (this.#onProgressFn) {
      this.#onProgressFn();
    }
    if (this.#state === _AsyncSubtask.State.STARTING) {
      this.#state = _AsyncSubtask.State.CANCELLED_BEFORE_STARTED;
    } else if (this.#state === _AsyncSubtask.State.STARTED) {
      this.#state = _AsyncSubtask.State.CANCELLED_BEFORE_RETURNED;
    } else {
      throw new Error("cannot reject a completed subtask");
    }
    this.#resolved = true;
    this.#parentTask.removeSubtask(this);
    this.#parentTask.reject(subtaskErr);
  }
  onResolve(subtaskValue) {
    _debugLog("[AsyncSubtask#onResolve()] args", {
      componentIdx: this.#componentIdx,
      subtaskID: this.#id,
      isAsync: this.isAsync,
      childTaskID: this.childTaskID(),
      parentTaskID: this.parentTaskID(),
      parentTaskFnName: this.#parentTask?.entryFnName(),
      fnName: this.fnName
    });
    if (this.#resolved) {
      throw new Error("subtask has already been resolved");
    }
    if (this.#onProgressFn) {
      this.#onProgressFn();
    }
    if (subtaskValue === null && this.#cancelRequested) {
      if (this.#state === _AsyncSubtask.State.STARTING) {
        this.#state = _AsyncSubtask.State.CANCELLED_BEFORE_STARTED;
      } else {
        if (this.#state !== _AsyncSubtask.State.STARTED) {
          throw new Error("resolved subtask must have been started before cancellation");
        }
        this.#state = _AsyncSubtask.State.CANCELLED_BEFORE_RETURNED;
      }
    } else {
      if (this.#state !== _AsyncSubtask.State.STARTED) {
        throw new Error("resolved subtask must have been started before completion");
      }
      this.#state = _AsyncSubtask.State.RETURNED;
    }
    this.setResult(subtaskValue);
    for (const f of this.#onResolveHandlers) {
      try {
        f(subtaskValue);
      } catch (err) {
        console.error("error during subtask resolve handler", err);
        throw err;
      }
    }
    const callMetadata = this.getCallMetadata();
    const memory = callMetadata.memory ?? this.#parentTask?.getReturnMemory() ?? lookupMemoriesForComponent({ componentIdx: this.#parentTask?.componentIdx() })[0];
    const returned = this.#state === _AsyncSubtask.State.RETURNED;
    if (returned && callMetadata && !callMetadata.returnFn && (this.isAsync || callMetadata.funcTypeIsAsync) && callMetadata.resultPtr && memory) {
      const { resultPtr, realloc } = callMetadata;
      const lowers = callMetadata.lowers;
      if (lowers && lowers.length > 0) {
        lowers[0]({
          componentIdx: this.#componentIdx,
          memory,
          realloc,
          vals: [subtaskValue],
          storagePtr: resultPtr,
          stringEncoding: callMetadata.stringEncoding
        });
      }
    }
    this.#resolved = true;
    this.#parentTask.removeSubtask(this);
    if (!this.isAsync) {
      this.deliverResolve();
      const rep2 = this.waitableRep();
      if (rep2) {
        try {
          const removed = this.#getComponentState().handles.remove(rep2);
          if (removed !== this) {
            throw new Error("unexpectedly received non-self Subtask from handle removal");
          }
          this.drop();
        } catch (err) {
          _debugLog("[AsyncSubtask#onResolve()] failed to remove subtask after sync subtask completion", err);
        }
      }
    }
  }
  getStateNumber() {
    return this.#state;
  }
  isReturned() {
    return this.#state === _AsyncSubtask.State.RETURNED;
  }
  getCallMetadata() {
    return this.#callMetadata;
  }
  isResolved() {
    if (this.#state === _AsyncSubtask.State.STARTING || this.#state === _AsyncSubtask.State.STARTED) {
      return false;
    }
    if (this.#state === _AsyncSubtask.State.RETURNED || this.#state === _AsyncSubtask.State.CANCELLED_BEFORE_STARTED || this.#state === _AsyncSubtask.State.CANCELLED_BEFORE_RETURNED) {
      return true;
    }
    throw new Error("unrecognized internal Subtask state [" + this.#state + "]");
  }
  addLender(handle) {
    _debugLog("[AsyncSubtask#addLender()] args", { handle });
    if (!Number.isNumber(handle)) {
      throw new Error("missing/invalid lender handle [" + handle + "]");
    }
    if (this.#lenders.length === 0 || this.isResolved()) {
      throw new Error("subtask has no lendors or has already been resolved");
    }
    handle.lends++;
    this.#lenders.push(handle);
  }
  deliverResolve() {
    _debugLog("[AsyncSubtask#deliverResolve()] args", {
      lenders: this.#lenders,
      parentTaskID: this.parentTaskID(),
      subtaskID: this.#id,
      childTaskID: this.childTaskID(),
      resolved: this.isResolved(),
      resolveDelivered: this.resolveDelivered()
    });
    const cannotDeliverResolve = this.resolveDelivered() || !this.isResolved();
    if (cannotDeliverResolve) {
      throw new Error("subtask cannot deliver resolution twice, and the subtask must be resolved");
    }
    for (const lender of this.#lenders) {
      lender.lends--;
    }
    this.#lenders = null;
  }
  resolveDelivered() {
    _debugLog("[AsyncSubtask#resolveDelivered()] args", {});
    if (this.#lenders === null && !this.isResolved()) {
      throw new Error("invalid subtask state, lenders missing and subtask has not been resolved");
    }
    return this.#lenders === null;
  }
  drop() {
    _debugLog("[AsyncSubtask#drop()] args", {
      componentIdx: this.#componentIdx,
      parentTaskID: this.#parentTask?.id(),
      parentTaskFnName: this.#parentTask?.entryFnName(),
      childTaskID: this.#childTask?.id(),
      childTaskFnName: this.#childTask?.entryFnName(),
      subtaskFnName: this.fnName
    });
    if (!this.#waitable) {
      throw new Error("missing/invalid inner waitable");
    }
    if (!this.resolveDelivered()) {
      throw new Error("cannot drop a subtask which has not yet resolved");
    }
    if (this.#waitable) {
      this.#waitable.drop();
    }
    this.#dropped = true;
  }
  #getComponentState() {
    const state = getOrCreateAsyncState(this.#componentIdx);
    if (!state) {
      throw new Error("invalid/missing async state for component [" + componentIdx + "]");
    }
    return state;
  }
  getWaitableHandleIdx() {
    _debugLog("[AsyncSubtask#getWaitableHandleIdx()] args", {});
    if (!this.#waitable) {
      throw new Error("missing/invalid waitable");
    }
    return this.waitableRep();
  }
};
var FutureValue = class _FutureValue {
  #start;
  #settled;
  #hideThen = 0;
  #thenFn;
  constructor(start) {
    if (typeof start !== "function") {
      throw new TypeError("future start operation must be a function");
    }
    this.#start = start;
    this.#thenFn = this.#then.bind(this);
  }
  get then() {
    return this.#hideThen === 0 ? this.#thenFn : void 0;
  }
  #read() {
    if (!this.#settled) {
      this.#settled = Promise.resolve().then(this.#start);
    }
    return this.#settled;
  }
  resolveAsValue(resolve) {
    this.#hideThen++;
    try {
      resolve(this);
    } finally {
      this.#hideThen--;
    }
  }
  #deliver(resolve, value) {
    if (value instanceof _FutureValue) {
      value.resolveAsValue(resolve);
      return;
    }
    resolve(value);
  }
  #then(resolve, reject) {
    return this.#read().then(
      (box) => this.#deliver(resolve, box.value),
      reject
    );
  }
};
var ASYNC_DETERMINISM = "random";
var _coinFlip = () => {
  return Math.random() > 0.5;
};
var ASYNC_EVENT_CODE = {
  NONE: 0,
  SUBTASK: 1,
  STREAM_READ: 2,
  STREAM_WRITE: 3,
  FUTURE_READ: 4,
  FUTURE_WRITE: 5,
  TASK_CANCELLED: 6
};
var CURRENT_TASK_META = {};
function _withGlobalCurrentTaskMeta(args) {
  _debugLog("[_withGlobalCurrentTaskMeta()] args", args);
  if (!args) {
    throw new TypeError("args missing");
  }
  if (args.taskID === void 0) {
    throw new TypeError("missing task ID");
  }
  if (args.componentIdx === void 0) {
    throw new TypeError("missing component idx");
  }
  if (!args.fn) {
    throw new TypeError("missing fn");
  }
  const { taskID, componentIdx: componentIdx2, fn } = args;
  const previous = CURRENT_TASK_META[componentIdx2] ?? null;
  const previousCurrent = CURRENT_TASK_META.current ?? null;
  try {
    CURRENT_TASK_META.current = CURRENT_TASK_META[componentIdx2] = { taskID, componentIdx: componentIdx2 };
    return fn();
  } catch (err) {
    _debugLog("error while executing sync callee/callback", {
      ...args,
      err
    });
    throw err;
  } finally {
    CURRENT_TASK_META[componentIdx2] = previous;
    CURRENT_TASK_META.current = previousCurrent;
  }
}
async function _withGlobalCurrentTaskMetaAsync(args) {
  _debugLog("[_withGlobalCurrentTaskMetaAsync()] args", args);
  if (!args) {
    throw new TypeError("args missing");
  }
  if (args.taskID === void 0) {
    throw new TypeError("missing task ID");
  }
  if (args.componentIdx === void 0) {
    throw new TypeError("missing component idx");
  }
  if (!args.fn) {
    throw new TypeError("missing fn");
  }
  const { taskID, componentIdx: componentIdx2, fn } = args;
  try {
    CURRENT_TASK_META.current = CURRENT_TASK_META[componentIdx2] = { taskID, componentIdx: componentIdx2 };
    return await fn();
  } catch (err) {
    _debugLog("error while executing async callee/callback", {
      ...args,
      err
    });
    throw err;
  } finally {
    CURRENT_TASK_META[componentIdx2] = null;
    if (CURRENT_TASK_META.current?.taskID === taskID) {
      CURRENT_TASK_META.current = null;
    }
  }
}
var AsyncTask = class _AsyncTask {
  static _ID = 0n;
  static State = {
    INITIAL: "initial",
    CANCELLED: "cancelled",
    CANCEL_PENDING: "cancel-pending",
    CANCEL_DELIVERED: "cancel-delivered",
    RESOLVED: "resolved"
  };
  static BlockResult = {
    CANCELLED: "block.cancelled",
    NOT_CANCELLED: "block.not-cancelled"
  };
  #id;
  #componentIdx;
  #state;
  #isAsync;
  #isManualAsync;
  #callingWasmExport = true;
  #lockFreeEntry = false;
  #preserveFutureResult;
  #entryFnName = null;
  #onResolveHandlers = [];
  #progressWaiters = [];
  #completionPromise = null;
  #completionValue;
  #completionReady = false;
  #settleCompletionPromise;
  #rejected = false;
  #exitPromise = null;
  #onExitHandlers = [];
  #memoryIdx = null;
  #memory = null;
  #callbackFn = null;
  #callbackFnName = null;
  #postReturnFn = null;
  #getCalleeParamsFn = null;
  #calleeIsAsync = null;
  #stringEncoding = null;
  #parentSubtask = null;
  #errHandling;
  #backpressurePromise;
  #backpressureWaiters = 0n;
  #returnLowerFns = null;
  #resourceScopeId;
  #resourceBorrowCount = 0;
  #resourceLenders = [];
  #resourceScopeExited = false;
  #subtasks = [];
  #entered = false;
  #exited = false;
  #errored = null;
  cancelled = false;
  cancelRequested = false;
  alwaysTaskReturn = false;
  returnCalls = 0;
  storage = [0, 0];
  tmpRetI64HighBits = 0 | 0;
  constructor(opts) {
    this.#id = ++_AsyncTask._ID;
    this.#resourceScopeId = ++RESOURCE_SCOPE_ID;
    RESOURCE_SCOPE_TASKS.set(this.#resourceScopeId, this);
    if (opts?.componentIdx === void 0) {
      throw new TypeError("missing component id during task creation");
    }
    this.#componentIdx = opts.componentIdx;
    this.#state = _AsyncTask.State.INITIAL;
    this.#isAsync = opts?.isAsync ?? false;
    this.#isManualAsync = opts?.isManualAsync ?? false;
    this.#preserveFutureResult = opts?.preserveFutureResult ?? false;
    this.#entryFnName = opts.entryFnName;
    this.#callingWasmExport = opts?.callingWasmExport !== false;
    const {
      promise: completionPromise,
      resolve: resolveCompletionPromise,
      reject: rejectCompletionPromise
    } = promiseWithResolvers();
    this.#completionPromise = completionPromise;
    completionPromise.catch(() => {
    });
    let completionSettled = false;
    const settleCompletionPromise = () => {
      if (completionSettled || !this.#completionReady) {
        return;
      }
      completionSettled = true;
      if (this.#errored !== null) {
        rejectCompletionPromise(this.#errored);
      } else if (this.#rejected) {
        rejectCompletionPromise(this.#completionValue);
      } else if (this.#preserveFutureResult && this.#completionValue instanceof FutureValue) {
        this.#completionValue.resolveAsValue(resolveCompletionPromise);
      } else {
        resolveCompletionPromise(this.#completionValue);
      }
    };
    this.#settleCompletionPromise = settleCompletionPromise;
    this.#onResolveHandlers.push((results) => {
      if (this.#parentSubtask !== null) {
        return;
      }
      if (!this.#isAsync && !this.#isManualAsync) {
        return;
      }
      this.#completionValue = results;
      this.#completionReady = true;
    });
    const {
      promise: exitPromise,
      resolve: resolveExitPromise,
      reject: rejectExitPromise
    } = promiseWithResolvers();
    this.#exitPromise = exitPromise;
    this.#onExitHandlers.push(() => {
      if (this.#parentSubtask === null && (this.#isAsync || this.#isManualAsync)) {
        settleCompletionPromise();
      }
      resolveExitPromise();
    });
    if (opts.callbackFn) {
      this.#callbackFn = opts.callbackFn;
    }
    if (opts.callbackFnName) {
      this.#callbackFnName = opts.callbackFnName;
    }
    if (opts.getCalleeParamsFn) {
      this.#getCalleeParamsFn = opts.getCalleeParamsFn;
    }
    if (opts.stringEncoding) {
      this.#stringEncoding = opts.stringEncoding;
    }
    if (opts.parentSubtask) {
      this.#parentSubtask = opts.parentSubtask;
    }
    if (opts.errHandling) {
      this.#errHandling = opts.errHandling;
    }
  }
  taskState() {
    return this.#state;
  }
  id() {
    return this.#id;
  }
  componentIdx() {
    return this.#componentIdx;
  }
  entryFnName() {
    return this.#entryFnName;
  }
  resourceScopeId() {
    return this.#resourceScopeId;
  }
  addBorrowedHandle() {
    if (this.#resourceScopeExited) {
      throw new Error("cannot add a borrow to an exited resource scope");
    }
    this.#resourceBorrowCount++;
  }
  removeBorrowedHandle() {
    if (this.#resourceBorrowCount === 0) {
      throw new Error("resource borrow count underflow");
    }
    this.#resourceBorrowCount--;
  }
  addResourceLender(table, handle) {
    if (this.#resourceScopeExited) {
      throw new Error("cannot add a lender to an exited resource scope");
    }
    this.#resourceLenders.push({ table, handle });
  }
  validateResourceBorrowScope() {
    if (this.#resourceScopeExited) {
      return;
    }
    if (this.#resourceBorrowCount !== 0) {
      throw new WebAssemblyRuntimeError("borrow handles still remain at the end of the call");
    }
    for (const { table, handle } of this.#resourceLenders) {
      const idx = handle << 1;
      const lendCount = table[idx];
      if (!Number.isInteger(lendCount) || lendCount <= 0 || lendCount >= 2 ** 30) {
        throw new Error("invalid resource lender state at scope exit");
      }
      table[idx] = lendCount - 1;
    }
    this.#resourceLenders = [];
    this.#resourceScopeExited = true;
    RESOURCE_SCOPE_TASKS.delete(this.#resourceScopeId);
  }
  completionPromise() {
    return this.#completionPromise;
  }
  settleCompletion() {
    this.#settleCompletionPromise();
  }
  exitPromise() {
    return this.#exitPromise;
  }
  waitForProgress() {
    const { promise, resolve } = promiseWithResolvers();
    this.#progressWaiters.push(resolve);
    return promise;
  }
  notifyProgress() {
    const waiters = this.#progressWaiters;
    this.#progressWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
  isAsync() {
    return this.#isAsync;
  }
  isManualAsync() {
    return this.#isManualAsync;
  }
  isSync() {
    return !this.isAsync();
  }
  getErrHandling() {
    return this.#errHandling;
  }
  hasCallback() {
    return this.#callbackFn !== null;
  }
  getReturnMemoryIdx() {
    return this.#memoryIdx;
  }
  setReturnMemoryIdx(idx) {
    if (idx === null) {
      return;
    }
    this.#memoryIdx = idx;
  }
  getReturnMemory() {
    return this.#memory;
  }
  setReturnMemory(m) {
    if (m === null) {
      return;
    }
    this.#memory = m;
  }
  setReturnLowerFns(fns) {
    this.#returnLowerFns = fns;
  }
  getReturnLowerFns() {
    return this.#returnLowerFns;
  }
  setCalleeIsAsync(value) {
    if (typeof value !== "boolean") {
      throw new TypeError("callee async state must be a boolean");
    }
    this.#calleeIsAsync = value;
  }
  setParentSubtask(subtask) {
    if (!subtask || !(subtask instanceof AsyncSubtask)) {
      return;
    }
    if (this.#parentSubtask) {
      throw new Error("parent subtask can only be set once");
    }
    this.#parentSubtask = subtask;
  }
  getParentSubtask() {
    return this.#parentSubtask;
  }
  // TODO(threads): this is very inefficient, we can pass along a root task,
  // and ideally do not need this once thread support is in place
  getRootTask() {
    let currentSubtask = this.getParentSubtask();
    let task = this;
    while (currentSubtask) {
      task = currentSubtask.getParentTask();
      currentSubtask = task.getParentSubtask();
    }
    return task;
  }
  setPostReturnFn(f) {
    if (!f) {
      return;
    }
    if (this.#postReturnFn) {
      throw new Error("postReturn fn can only be set once");
    }
    this.#postReturnFn = f;
  }
  setCallbackFn(f, name) {
    if (!f) {
      return;
    }
    if (this.#callbackFn) {
      throw new Error("callback fn can only be set once");
    }
    this.#callbackFn = f;
    this.#callbackFnName = name;
  }
  getCallbackFnName() {
    if (!this.#callbackFnName) {
      return void 0;
    }
    return this.#callbackFnName;
  }
  runCallbackFn(...args) {
    if (!this.#callbackFn) {
      throw new Error("no callback function has been set for task");
    }
    if (this.#callbackFn._jcoMaySuspend === false) {
      return _withGlobalCurrentTaskMeta({
        taskID: this.#id,
        componentIdx: this.#componentIdx,
        fn: () => this.#callbackFn.apply(null, args)
      });
    }
    return _withGlobalCurrentTaskMetaAsync({
      taskID: this.#id,
      componentIdx: this.#componentIdx,
      fn: () => {
        return this.#callbackFn.apply(null, args);
      }
    });
  }
  getCalleeParams() {
    if (!this.#getCalleeParamsFn) {
      throw new Error("missing/invalid getCalleeParamsFn");
    }
    return this.#getCalleeParamsFn();
  }
  // Legacy manually-async exports are sync-typed in the component
  // but use JSPI precisely so their guest stack may suspend.
  mayBlock() {
    return this.isAsync() || this.isManualAsync() || this.isResolvedState();
  }
  mayEnter(task) {
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (cstate.hasBackpressure()) {
      _debugLog("[AsyncTask#mayEnter()] disallowed due to backpressure", { taskID: this.#id });
      return false;
    }
    if (!cstate.callingSyncImport()) {
      _debugLog("[AsyncTask#mayEnter()] disallowed due to sync import call", { taskID: this.#id });
      return false;
    }
    const callingSyncExportWithSyncPending = cstate.callingSyncExport && !task.isAsync;
    if (!callingSyncExportWithSyncPending) {
      _debugLog("[AsyncTask#mayEnter()] disallowed due to sync export w/ sync pending", { taskID: this.#id });
      return false;
    }
    return true;
  }
  enterSync() {
    if (this.needsExclusiveLock()) {
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      if (!cstate.isExclusivelyLocked()) {
        cstate.exclusiveLock(this.#id);
      } else {
        this.#lockFreeEntry = true;
        _debugLog("[AsyncTask#enterSync()] entering without exclusive lock", {
          taskID: this.#id,
          componentIdx: this.#componentIdx
        });
      }
    }
    return true;
  }
  tryEnter() {
    if (this.#entered) {
      throw new Error(`task with ID [${this.#id}] should not be entered twice`);
    }
    if (this.deliverPendingCancel({ cancellable: true })) {
      this.cancel();
      return false;
    }
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (this.isSync()) {
      this.#entered = true;
      return true;
    }
    if (cstate.hasBackpressure()) {
      return null;
    }
    if (this.needsExclusiveLock()) {
      if (cstate.isExclusivelyLocked()) {
        return null;
      }
      cstate.exclusiveLock(this.#id);
    }
    if (this.deliverPendingCancel({ cancellable: true })) {
      cstate.exclusiveRelease(this.#id);
      this.cancel();
      return false;
    }
    this.#entered = true;
    return true;
  }
  async enter(opts) {
    _debugLog("[AsyncTask#enter()] args", {
      taskID: this.#id,
      componentIdx: this.#componentIdx,
      subtaskID: this.getParentSubtask()?.id(),
      args: opts,
      entryFnName: this.#entryFnName
    });
    if (this.#entered) {
      throw new Error(`task with ID [${this.#id}] should not be entered twice`);
    }
    if (this.deliverPendingCancel({ cancellable: true })) {
      this.cancel();
      return false;
    }
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (opts?.isHost) {
      this.#entered = true;
      const parentTask = this.#parentSubtask?.getParentTask();
      if (parentTask?.taskState() === _AsyncTask.State.CANCEL_DELIVERED || parentTask && !parentTask.hasCallback()) {
        parentTask.notifyProgress();
      }
      return this.#entered;
    }
    if (this.isSync()) {
      this.#entered = true;
      if (this.#isManualAsync) {
        if (this.needsExclusiveLock()) {
          await cstate.acquireExclusiveLock(this.#id);
        }
      }
      return this.#entered;
    }
    if (cstate.hasBackpressure()) {
      cstate.addBackpressureWaiter();
      const result = await this.waitUntil({
        readyFn: () => {
          return !cstate.hasBackpressure();
        },
        cancellable: true
      });
      cstate.removeBackpressureWaiter();
      if (!result || this.isCancelled()) {
        if (!this.isResolvedState()) {
          this.cancel();
        }
        return false;
      }
    }
    if (this.needsExclusiveLock()) {
      await cstate.acquireExclusiveLock(this.#id);
    }
    if (this.isResolvedState() || this.isCancelled()) {
      cstate.exclusiveRelease(this.#id);
      return false;
    }
    if (this.deliverPendingCancel({ cancellable: true })) {
      cstate.exclusiveRelease(this.#id);
      this.cancel();
      return false;
    }
    this.#entered = true;
    return this.#entered;
  }
  isRunningState() {
    return this.#state !== _AsyncTask.State.RESOLVED;
  }
  isResolvedState() {
    return this.#state === _AsyncTask.State.RESOLVED;
  }
  isResolved() {
    return this.#state === _AsyncTask.State.RESOLVED;
  }
  isExited() {
    return this.#exited;
  }
  async waitUntil(opts) {
    const { readyFn, cancellable } = opts;
    _debugLog("[AsyncTask#waitUntil()] args", { taskID: this.#id, args: { cancellable } });
    const keepGoing = await this.suspendUntil({
      readyFn,
      cancellable
    });
    return keepGoing;
  }
  async yieldUntil(opts) {
    const { readyFn, cancellable } = opts;
    _debugLog("[AsyncTask#yieldUntil()]", {
      taskID: this.#id,
      args: {
        cancellable
      },
      componentIdx: this.#componentIdx
    });
    const keepGoing = await this.immediateSuspend({ readyFn, cancellable });
    if (keepGoing) {
      return {
        code: ASYNC_EVENT_CODE.NONE,
        payload0: 0,
        payload1: 0
      };
    }
    return {
      code: ASYNC_EVENT_CODE.TASK_CANCELLED,
      payload0: 0,
      payload1: 0
    };
  }
  async suspendUntil(opts) {
    const { cancellable, readyFn } = opts;
    _debugLog("[AsyncTask#suspendUntil()] args", {
      taskID: this.#id,
      args: {
        cancellable
      },
      componentIdx: this.#componentIdx
    });
    const pendingCancelled = this.deliverPendingCancel({ cancellable });
    if (pendingCancelled) {
      return false;
    }
    const completed = await this.immediateSuspendUntil({ readyFn, cancellable });
    return completed;
  }
  suspendUntilCallback(opts, onResume) {
    const { cancellable, readyFn } = opts;
    if (this.deliverPendingCancel({ cancellable })) {
      onResume(false);
      return;
    }
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    cstate.suspendTask({
      task: this,
      cancellable,
      readyFn: () => {
        if (cancellable && this.#state === _AsyncTask.State.CANCEL_PENDING) {
          return true;
        }
        return readyFn();
      },
      onResume: (keepGoing) => {
        if (keepGoing && this.deliverPendingCancel({ cancellable })) {
          keepGoing = false;
        }
        onResume(keepGoing);
      }
    });
  }
  // TODO(threads): equivalent to thread.suspend_until()
  async immediateSuspendUntil(opts) {
    const { cancellable, readyFn } = opts;
    _debugLog("[AsyncTask#immediateSuspendUntil()] args", {
      args: {
        cancellable,
        readyFn
      },
      taskID: this.#id,
      componentIdx: this.#componentIdx
    });
    const ready = readyFn();
    if (ready && ASYNC_DETERMINISM === "random") {
      const coinFlip = _coinFlip();
      if (coinFlip) {
        return true;
      }
    }
    const keepGoing = await this.immediateSuspend({ cancellable, readyFn });
    return keepGoing;
  }
  async immediateSuspend(opts) {
    const { cancellable, readyFn } = opts;
    _debugLog("[AsyncTask#immediateSuspend()] args", { cancellable, readyFn });
    const pendingCancelled = this.deliverPendingCancel({ cancellable });
    if (pendingCancelled) {
      return false;
    }
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    const keepGoing = await cstate.suspendTask({
      task: this,
      cancellable,
      readyFn: () => {
        if (cancellable && this.#state === _AsyncTask.State.CANCEL_PENDING) {
          return true;
        }
        return readyFn();
      }
    });
    if (keepGoing && this.deliverPendingCancel({ cancellable })) {
      return false;
    }
    return keepGoing;
  }
  deliverPendingCancel(opts) {
    const { cancellable } = opts;
    _debugLog("[AsyncTask#deliverPendingCancel()]", {
      args: { cancellable },
      taskID: this.#id,
      componentIdx: this.#componentIdx
    });
    if (cancellable && this.#state === _AsyncTask.State.CANCEL_PENDING) {
      this.#state = _AsyncTask.State.CANCEL_DELIVERED;
      return true;
    }
    return false;
  }
  isCancelled() {
    return this.cancelled;
  }
  cancellationRequested() {
    return this.cancelRequested;
  }
  // Request cooperative cancellation of this task, called on behalf of a
  // supertask performing `subtask.cancel` on the subtask this task backs.
  //
  // The request is delivered at this task's next cancellable wait
  // (see suspendUntil/immediateSuspend), at which point the task is
  // expected to acknowledge via `task.cancel` or still resolve via
  // `task.return`.
  requestCancellation() {
    _debugLog("[AsyncTask#requestCancellation()] args", {
      taskID: this.#id,
      componentIdx: this.#componentIdx,
      state: this.#state
    });
    if (this.isResolvedState() || this.cancelRequested) {
      return;
    }
    this.cancelRequested = true;
    if (this.#state === _AsyncTask.State.INITIAL) {
      this.#state = _AsyncTask.State.CANCEL_PENDING;
    }
    getOrCreateAsyncState(this.#componentIdx).runTickLoop();
  }
  cancel(args) {
    _debugLog("[AsyncTask#cancel()] args", {});
    if (this.taskState() !== _AsyncTask.State.CANCEL_DELIVERED) {
      throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] invalid task state [${this.taskState()}] for cancellation`);
    }
    this.validateResourceBorrowScope();
    this.cancelled = true;
    this.onResolve(args?.error ?? null);
    this.#state = _AsyncTask.State.RESOLVED;
    if (!this.#entered) {
      this.notifyProgress();
    }
  }
  onResolve(taskValue) {
    const handlers = this.#onResolveHandlers;
    this.#onResolveHandlers = [];
    for (const f of handlers) {
      try {
        f(taskValue);
      } catch (err) {
        _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
        throw err;
      }
    }
    if (this.#rejected) {
      this.#parentSubtask?.reject(taskValue);
      return;
    }
    const parentSubtaskPending = this.#parentSubtask && !this.#parentSubtask.isResolved();
    const taskReturned = !this.isCancelled();
    if (parentSubtaskPending && taskReturned) {
      const meta = this.#parentSubtask.getCallMetadata();
      if (meta.returnFn && !meta.returnFnCalled) {
        _debugLog("[AsyncTask#onResolve()] running returnFn", {
          componentIdx: this.#componentIdx,
          taskID: this.#id,
          subtaskID: this.#parentSubtask.id()
        });
        const callerTask = this.#parentSubtask.getParentTask();
        _withGlobalCurrentTaskMeta({
          taskID: callerTask.id(),
          componentIdx: callerTask.componentIdx(),
          fn: () => meta.returnFn.apply(null, [taskValue, meta.resultPtr])
        });
        meta.returnFnCalled = true;
      }
    }
    if (this.#postReturnFn && taskReturned) {
      _debugLog("[AsyncTask#onResolve()] running post return ", {
        componentIdx: this.#componentIdx,
        taskID: this.#id
      });
      try {
        _withGlobalCurrentTaskMeta({
          taskID: this.#id,
          componentIdx: this.#componentIdx,
          fn: () => this.#postReturnFn(taskValue)
        });
      } catch (err) {
        _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
        throw err;
      }
    }
    if (parentSubtaskPending) {
      this.#parentSubtask.onResolve(taskValue);
    }
  }
  registerOnResolveHandler(f) {
    this.#onResolveHandlers.push(f);
  }
  isRejected() {
    return this.#rejected;
  }
  isErrored() {
    return this.#errored;
  }
  setErrored(err) {
    if (this.#errored === null) {
      this.#errored = err;
    }
  }
  reject(taskErr) {
    _debugLog("[AsyncTask#reject()] args", {
      componentIdx: this.#componentIdx,
      taskID: this.#id,
      parentSubtask: this.#parentSubtask,
      parentSubtaskID: this.#parentSubtask?.id(),
      entryFnName: this.entryFnName(),
      callbackFnName: this.#callbackFnName,
      errMsg: taskErr.message
    });
    this.setErrored(taskErr);
    if (this.#rejected) {
      return;
    }
    if (this.isResolvedState()) {
      this.#rejected = true;
      this.#errored = taskErr;
      const parentTask = this.#parentSubtask?.getParentTask();
      if (parentTask) {
        parentTask.reject(taskErr);
      }
      return;
    }
    this.#rejected = true;
    this.cancelRequested = true;
    this.#state = _AsyncTask.State.CANCEL_PENDING;
    const cancelled = this.deliverPendingCancel({ cancellable: true });
    this.cancel({ error: taskErr });
  }
  resolve(results) {
    _debugLog("[AsyncTask#resolve()] args", {
      componentIdx: this.#componentIdx,
      taskID: this.#id,
      entryFnName: this.entryFnName(),
      callbackFnName: this.#callbackFnName
    });
    if (this.#state === _AsyncTask.State.RESOLVED) {
      throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}]  is already resolved (did you forget to wait for an import?)`);
    }
    this.validateResourceBorrowScope();
    this.#state = _AsyncTask.State.RESOLVED;
    switch (results.length) {
      case 0:
        this.onResolve(void 0);
        break;
      case 1:
        this.onResolve(results[0]);
        break;
      default:
        _debugLog("[AsyncTask#resolve()] unexpected number of results", {
          componentIdx: this.#componentIdx,
          results,
          taskID: this.#id,
          subtaskID: this.#parentSubtask?.id(),
          entryFnName: this.#entryFnName,
          callbackFnName: this.#callbackFnName
        });
        throw new Error("unexpected number of results");
    }
  }
  exit(args) {
    _debugLog("[AsyncTask#exit()]", {
      componentIdx: this.#componentIdx,
      taskID: this.#id
    });
    if (this.#exited) {
      throw new Error("task has already exited");
    }
    if (this.#state !== _AsyncTask.State.RESOLVED) {
      throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] exited without resolution`);
    }
    this.validateResourceBorrowScope();
    const state = getOrCreateAsyncState(this.#componentIdx);
    if (!state) {
      throw new Error("missing async state for component [" + this.#componentIdx + "]");
    }
    if (this.#componentIdx !== -1 && !args?.skipExclusiveLockCheck && !this.#lockFreeEntry) {
      if (this.needsExclusiveLock() && !state.exclusivelyLockedBy(this.#id)) {
        throw new Error(`task [${this.#id}] exit: component [${this.#componentIdx}] should have been exclusively locked by it`);
      }
    }
    state.exclusiveRelease(this.#id);
    this.notifyProgress();
    for (const f of this.#onExitHandlers) {
      try {
        f();
      } catch (err) {
        console.error("error during task exit handler", err);
        throw err;
      }
    }
    this.#exited = true;
    clearCurrentTask(this.#componentIdx, this.id());
  }
  needsExclusiveLock() {
    if (this.#componentIdx === -1) {
      return false;
    }
    if (!this.#callingWasmExport) {
      return false;
    }
    return !this.#isAsync || this.hasCallback() || this.#calleeIsAsync === false;
  }
  createSubtask(args) {
    _debugLog("[AsyncTask#createSubtask()] args", args);
    const { componentIdx: componentIdx2, childTask, callMetadata, fnName, isAsync, isManualAsync } = args;
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (!cstate) {
      throw new Error(`invalid/missing async state for component idx [${componentIdx2}]`);
    }
    const waitable = new Waitable({
      componentIdx: this.#componentIdx,
      target: `subtask (internal ID [${this.#id}])`
    });
    const newSubtask = new AsyncSubtask({
      componentIdx: componentIdx2,
      childTask,
      parentTask: this,
      callMetadata,
      isAsync,
      isManualAsync,
      fnName,
      waitable
    });
    this.#subtasks.push(newSubtask);
    newSubtask.setTarget(`subtask (internal ID [${newSubtask.id()}], waitable [${waitable.idx()}], component [${componentIdx2}])`);
    waitable.setIdx(cstate.handles.insert(newSubtask));
    waitable.setTarget(`waitable for subtask (waitable id [${waitable.idx()}], subtask internal ID [${newSubtask.id()}])`);
    return newSubtask;
  }
  getLatestSubtask() {
    return this.#subtasks.at(-1);
  }
  getSubtaskByWaitableRep(rep2) {
    if (rep2 === void 0) {
      throw new TypeError("missing rep");
    }
    return this.#subtasks.find((s) => s.waitableRep() === rep2);
  }
  currentSubtask() {
    _debugLog("[AsyncTask#currentSubtask()]");
    if (this.#subtasks.length === 0) {
      return void 0;
    }
    return this.#subtasks.at(-1);
  }
  removeSubtask(subtask) {
    if (this.#subtasks.length === 0) {
      throw new Error("cannot end current subtask: no current subtask");
    }
    this.#subtasks = this.#subtasks.filter((t) => t !== subtask);
    return subtask;
  }
};
function createNewCurrentTask(args) {
  _debugLog("[createNewCurrentTask()] args", args);
  const {
    componentIdx: componentIdx2,
    isAsync,
    isManualAsync,
    preserveFutureResult,
    entryFnName,
    parentSubtaskID,
    callbackFnName,
    getCallbackFn,
    getParamsFn,
    stringEncoding,
    errHandling,
    getCalleeParamsFn,
    resultPtr,
    callingWasmExport
  } = args;
  if (componentIdx2 === void 0 || componentIdx2 === null) {
    throw new Error("missing/invalid component instance index while starting task");
  }
  let taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx2);
  const callbackFn = getCallbackFn ? getCallbackFn() : null;
  const newTask = new AsyncTask({
    componentIdx: componentIdx2,
    isAsync,
    isManualAsync,
    preserveFutureResult,
    entryFnName,
    callbackFn,
    callbackFnName,
    stringEncoding,
    getCalleeParamsFn,
    resultPtr,
    errHandling,
    callingWasmExport
  });
  const newTaskID = newTask.id();
  const newTaskMeta = { id: newTaskID, componentIdx: componentIdx2, task: newTask };
  ASYNC_CURRENT_TASK_IDS.push(newTaskID);
  ASYNC_CURRENT_COMPONENT_IDXS.push(componentIdx2);
  if (!taskMetas) {
    taskMetas = [newTaskMeta];
    ASYNC_TASKS_BY_COMPONENT_IDX.set(componentIdx2, [newTaskMeta]);
  } else {
    taskMetas.push(newTaskMeta);
  }
  return [newTask, newTaskID];
}
function _checkMayLeave(componentIdx2) {
  if (INSTANCE_FLAGS.get(componentIdx2)?.value !== 1) {
    throw new WebAssemblyRuntimeError("cannot leave component instance");
  }
}
function _getGlobalCurrentTaskMeta(componentIdx2) {
  const v = componentIdx2 === void 0 || componentIdx2 === null ? CURRENT_TASK_META.current : CURRENT_TASK_META[componentIdx2];
  if (v === void 0 || v === null) {
    return void 0;
  }
  return { ...v };
}
function _setGlobalCurrentTaskMeta(args) {
  if (!args) {
    throw new TypeError("args missing");
  }
  if (args.taskID === void 0) {
    throw new TypeError("missing task ID");
  }
  if (args.componentIdx === void 0) {
    throw new TypeError("missing component idx");
  }
  const { taskID, componentIdx: componentIdx2 } = args;
  return CURRENT_TASK_META.current = CURRENT_TASK_META[componentIdx2] = { taskID, componentIdx: componentIdx2 };
}
async function _clearCurrentTask(args) {
  _debugLog("[_clearCurrentTask()] args", args);
  if (!args) {
    throw new TypeError("args missing");
  }
  if (args.taskID === void 0) {
    throw new TypeError("missing task ID");
  }
  if (args.componentIdx === void 0) {
    throw new TypeError("missing component idx");
  }
  const { taskID, componentIdx: componentIdx2 } = args;
  const meta = CURRENT_TASK_META[componentIdx2];
  if (!meta) {
    throw new Error(`missing current task meta for component idx [${componentIdx2}]`);
  }
  if (meta.taskID !== taskID) {
    throw new Error(`task ID [${meta.taskID}] != requested ID [${taskID}]`);
  }
  if (meta.componentIdx !== componentIdx2) {
    throw new Error(`component idx [${meta.componentIdx}] != requested idx [${componentIdx2}]`);
  }
  CURRENT_TASK_META[componentIdx2] = null;
  if (CURRENT_TASK_META.current?.taskID === taskID) {
    CURRENT_TASK_META.current = null;
  }
}
function _lowerImportBackwardsCompat(args) {
  const params = [...arguments].slice(1);
  _debugLog("[_lowerImportBackwardsCompat()] args", { args, params });
  const {
    functionIdx,
    componentIdx: componentIdx2,
    isAsync,
    isManualAsync,
    paramLiftFns,
    resultLowerFns,
    hasResultPointer,
    funcTypeIsAsync,
    metadata: metadata2,
    memoryIdx,
    getMemoryFn,
    getReallocFn,
    importFn,
    stringEncoding
  } = args;
  _checkMayLeave(componentIdx2);
  let meta = _getGlobalCurrentTaskMeta(componentIdx2);
  let createdTask;
  if (!meta) {
    if (funcTypeIsAsync || isAsync && !isManualAsync) {
      throw new Error("p3 async wasm exports cannot use backwards compat auto-task init");
    }
    const [newTask, newTaskID] = createNewCurrentTask({
      componentIdx: componentIdx2,
      isAsync,
      isManualAsync,
      callingWasmExport: false
    });
    createdTask = newTask;
    createdTask.registerOnResolveHandler(() => {
      _clearCurrentTask({
        taskID: task.id(),
        componentIdx: task.componentIdx()
      });
    });
    _setGlobalCurrentTaskMeta({
      componentIdx: componentIdx2,
      taskID: newTaskID
    });
    meta = _getGlobalCurrentTaskMeta(componentIdx2);
  }
  const { taskID } = meta;
  const taskMeta = getCurrentTask(componentIdx2, taskID);
  if (!taskMeta) {
    throw new Error("invalid/missing async task meta");
  }
  const task = taskMeta.task;
  if (!task) {
    throw new Error("invalid/missing async task");
  }
  const cstate = getOrCreateAsyncState(componentIdx2);
  if (!task.mayBlock() && funcTypeIsAsync && !isAsync) {
    throw new Error("non async exports cannot synchronously call async functions");
  }
  const memory = getMemoryFn();
  const resultPtr = hasResultPointer ? params[params.length - 1] : void 0;
  const subtask = task.createSubtask({
    componentIdx: componentIdx2,
    parentTask: task,
    fnName: importFn.fnName,
    isAsync,
    isManualAsync,
    callMetadata: {
      memoryIdx,
      memory,
      realloc: getReallocFn?.(),
      getReallocFn,
      resultPtr,
      lowers: resultLowerFns,
      funcTypeIsAsync,
      stringEncoding
    }
  });
  task.setReturnMemoryIdx(memoryIdx);
  task.setReturnMemory(getMemoryFn());
  subtask.onStart();
  if (!isManualAsync && !isAsync && !funcTypeIsAsync) {
    if (createdTask) {
      createdTask.enterSync();
    }
    const res = importFn(...params);
    if (!funcTypeIsAsync && !subtask.isReturned()) {
      throw new Error("post-execution subtasks must either be async or returned");
    }
    const syncRes = subtask.getResult();
    if (createdTask) {
      createdTask.resolve([syncRes]);
    }
    return syncRes;
  }
  if (!isManualAsync && !isAsync && funcTypeIsAsync) {
    const { promise, resolve, reject } = promiseWithResolvers();
    queueMicrotask(async () => {
      try {
        await importFn(...params);
        if (!subtask.isResolved()) {
          await task.suspendUntil({ readyFn: () => subtask.isResolved() });
        }
        resolve(subtask.getResult());
      } catch (err) {
        reject(err);
      }
    });
    return promise;
  }
  const subtaskState = subtask.getStateNumber();
  if (subtaskState < 0 || subtaskState >= 2 ** 4) {
    throw new Error("invalid subtask state, out of valid range");
  }
  subtask.setOnProgressFn(() => {
    subtask.setPendingEvent(() => {
      if (subtask.isResolved()) {
        subtask.deliverResolve();
      }
      const event = {
        code: ASYNC_EVENT_CODE.SUBTASK,
        payload0: subtask.waitableRep(),
        payload1: subtask.getStateNumber()
      };
      return event;
    });
  });
  const requiresManualAsyncResult = !isAsync && !funcTypeIsAsync && isManualAsync;
  let manualAsyncResult;
  if (requiresManualAsyncResult) {
    manualAsyncResult = promiseWithResolvers();
  }
  queueMicrotask(async () => {
    try {
      _debugLog("[_lowerImportBackwardsCompat()] calling lowered import", { importFn, params });
      if (createdTask) {
        await createdTask.enter();
      }
      const asyncRes = await importFn(...params);
      if (requiresManualAsyncResult) {
        manualAsyncResult.resolve(subtask.getResult());
      }
      if (createdTask) {
        createdTask.resolve([asyncRes]);
      }
    } catch (err) {
      _debugLog("[_lowerImportBackwardsCompat()] import fn error:", err);
      if (requiresManualAsyncResult) {
        manualAsyncResult.reject(err);
        return;
      }
      task.setErrored(err);
      task.reject(err);
    }
  });
  if (requiresManualAsyncResult) {
    return manualAsyncResult.promise;
  }
  _debugLog("[_lowerImportBackwardsCompat()] async-lowered import return", {
    fnName: importFn.fnName,
    componentIdx: componentIdx2,
    subtaskID: subtask.id(),
    waitableRep: subtask.waitableRep(),
    subtaskState,
    packedResult: Number(subtask.waitableRep()) << 4 | subtaskState
  });
  return Number(subtask.waitableRep()) << 4 | subtaskState;
}
var CURRENT_TASK_MAY_BLOCK = globalThis.WebAssembly ? new globalThis.WebAssembly.Global({ value: "i32", mutable: true }, 0) : false;
function _liftFlatU8(ctx) {
  _debugLog("[_liftFlatU8()] args", { ctx });
  let val;
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) {
      throw new Error("expected at least a single i32 argument");
    }
    val = ctx.params[0];
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  if (ctx.storageLen !== void 0 && ctx.storageLen < 1) {
    throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u8 requires 1 byte)`);
  }
  val = new DataView(ctx.memory.buffer).getUint8(ctx.storagePtr, true);
  ctx.storagePtr += 1;
  if (ctx.storageLen !== void 0) {
    ctx.storageLen -= 1;
  }
  return [val, ctx];
}
function _liftFlatU16(ctx) {
  _debugLog("[_liftFlatU16()] args", { ctx });
  let val;
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) {
      throw new Error("expected at least a single i32 argument");
    }
    val = ctx.params[0];
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  if (ctx.storageLen !== void 0 && ctx.storageLen < 2) {
    throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u16 requires 2 bytes)`);
  }
  val = new DataView(ctx.memory.buffer).getUint16(ctx.storagePtr, true);
  ctx.storagePtr += 2;
  if (ctx.storageLen !== void 0) {
    ctx.storageLen -= 2;
  }
  const rem = ctx.storagePtr % 2;
  if (rem !== 0) {
    ctx.storagePtr += 2 - rem;
  }
  return [val, ctx];
}
function _liftFlatU32(ctx) {
  _debugLog("[_liftFlatU32()] args", { ctx });
  let val;
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) {
      throw new Error("expected at least a single i34 argument");
    }
    val = ctx.params[0] >>> 0;
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  if (ctx.storageLen !== void 0 && ctx.storageLen < 4) {
    throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u32 requires 4 bytes)`);
  }
  val = new DataView(ctx.memory.buffer).getUint32(ctx.storagePtr, true);
  ctx.storagePtr += 4;
  if (ctx.storageLen !== void 0) {
    ctx.storageLen -= 4;
  }
  return [val, ctx];
}
function _liftFlatU64(ctx) {
  _debugLog("[_liftFlatU64()] args", { ctx });
  let val;
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) {
      throw new Error("expected at least one single i64 argument");
    }
    if (typeof ctx.params[0] !== "bigint") {
      throw new Error("expected bigint");
    }
    val = BigInt.asUintN(64, ctx.params[0]);
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  if (ctx.storageLen !== void 0 && ctx.storageLen < 8) {
    throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u64 requires 8 bytes)`);
  }
  val = new DataView(ctx.memory.buffer).getBigUint64(ctx.storagePtr, true);
  ctx.storagePtr += 8;
  if (ctx.storageLen !== void 0) {
    ctx.storageLen -= 8;
  }
  return [val, ctx];
}
var _liftFlatVariantScratch = new DataView(new ArrayBuffer(8));
function _liftFlatVariant(meta) {
  const {
    caseMetas,
    variantSize32,
    variantAlign32,
    variantPayloadOffset32,
    variantFlatCount,
    variantPayloadFlatTypes,
    isEnum
  } = meta;
  return function _liftFlatVariantInner(ctx) {
    _debugLog("[_liftFlatVariant()] args", { ctx });
    const origUseParams = ctx.useDirectParams;
    let caseIdx;
    let liftRes;
    const originalPtr = ctx.storagePtr;
    const numCases = caseMetas.length;
    if (caseMetas.length < 256) {
      liftRes = _liftFlatU8(ctx);
    } else if (numCases >= 256 && numCases < 65536) {
      liftRes = _liftFlatU16(ctx);
    } else if (numCases >= 65536 && numCases < 4294967296) {
      liftRes = _liftFlatU32(ctx);
    } else {
      throw new Error(`unsupported number of variant cases [${numCases}]`);
    }
    caseIdx = liftRes[0];
    ctx = liftRes[1];
    const [
      tag,
      liftFn,
      caseSize32,
      caseAlign32,
      caseFlatCount,
      caseFlatTypes
    ] = caseMetas[caseIdx];
    if (variantPayloadOffset32 === void 0) {
      throw new Error("unexpectedly missing payload offset");
    }
    if (originalPtr !== void 0) {
      ctx.storagePtr = originalPtr + variantPayloadOffset32;
    }
    let val;
    if (liftFn === null) {
      val = { tag };
      if (originalPtr !== void 0) {
        ctx.storagePtr = originalPtr + variantSize32;
      }
    } else {
      if (ctx.useDirectParams) {
        if (!variantPayloadFlatTypes || !caseFlatTypes) {
          throw new Error("missing variant flat type metadata during direct-param lift");
        }
        const scratch = _liftFlatVariantScratch;
        for (let i = 0; i < caseFlatTypes.length; i++) {
          const have = variantPayloadFlatTypes[i];
          const want = caseFlatTypes[i];
          if (have === want) {
            continue;
          }
          const val2 = ctx.params[i];
          if (have === "i64" && want === "i32") {
            ctx.params[i] = Number(BigInt.asIntN(32, val2));
          } else if (have === "i64" && want === "f32") {
            scratch.setInt32(0, Number(BigInt.asIntN(32, val2)), true);
            ctx.params[i] = scratch.getFloat32(0, true);
          } else if (have === "i64" && want === "f64") {
            scratch.setBigInt64(0, val2, true);
            ctx.params[i] = scratch.getFloat64(0, true);
          } else if (have === "i32" && want === "f32") {
            scratch.setInt32(0, val2, true);
            ctx.params[i] = scratch.getFloat32(0, true);
          } else {
            throw new Error(`invalid variant payload coercion [${have}] -> [${want}]`);
          }
        }
      }
      const [newVal, newCtx] = liftFn(ctx);
      val = { tag, val: newVal };
      ctx = newCtx;
    }
    if (origUseParams) {
      if (variantFlatCount === void 0 || variantFlatCount === null) {
        _debugLog("[_liftFlatVariant()] variant with unknown flat count", { ctx, meta });
        throw new Error("cannot lift variant with unknown flat count");
      }
      if (caseFlatCount === void 0 || caseFlatCount === null) {
        _debugLog("[_liftFlatVariant()] case with unknown flat count", { ctx, meta, case: meta.caseMetas[caseIdx] });
        throw new Error("cannot lift case with unknown flat count");
      }
      const remainingPayloadParams = variantFlatCount - caseFlatCount - (isEnum ? 0 : 1);
      if (remainingPayloadParams < 0) {
        throw new Error(`invalid variant flat count metadata`);
      }
      if (ctx.params.length < remainingPayloadParams) {
        throw new Error(`expected at least [${remainingPayloadParams}] remaining variant payload params, but got [${ctx.params.length}]`);
      }
      ctx.params = ctx.params.slice(remainingPayloadParams);
    }
    if (ctx.storagePtr !== void 0) {
      const rem = ctx.storagePtr % variantAlign32;
      if (rem !== 0) {
        ctx.storagePtr += variantAlign32 - rem;
      }
    }
    return [val, ctx];
  };
}
function _liftFlatList(meta) {
  const { elemLiftFn, elemSize32, elemAlign32, knownLen, typedArray } = meta;
  const listValue = typedArray === void 0 ? (values) => values : (values) => new typedArray(values);
  const readValuesAndReset = (ctx, originalPtr, originalLen, dataPtr, len) => {
    if (dataPtr % elemAlign32 !== 0) {
      throw new TypeError(`list pointer [${dataPtr}] is not aligned to ${elemAlign32}`);
    }
    ctx.storagePtr = dataPtr;
    const val = [];
    for (var i = 0; i < len; i++) {
      const elemPtr = dataPtr + i * elemSize32;
      ctx.storagePtr = elemPtr;
      const [res, nextCtx] = elemLiftFn(ctx);
      val.push(res);
      ctx = nextCtx;
      ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + elemSize32);
    }
    if (originalPtr !== null) {
      ctx.storagePtr = originalPtr;
    }
    if (originalLen !== null) {
      ctx.storageLen = originalLen;
    }
    return [listValue(val), ctx];
  };
  return function _liftFlatListInner(ctx) {
    _debugLog("[_liftFlatList()] args", { ctx });
    let liftResults;
    if (knownLen !== void 0) {
      if (ctx.useDirectParams) {
        _debugLog("memory unexpectedly missing while lifting unknown length list", { ctx });
        liftResults = [listValue(ctx.params.slice(0, knownLen)), ctx];
        ctx.params = ctx.params.slice(knownLen);
      } else {
        if (ctx.memory === null) {
          _debugLog("memory unexpectedly missing while lifting known length list", { knownLen, ctx });
          throw new Error(`memory missing while lifting known length (${knownLen}) list`);
        }
        const originalLen = ctx.storageLen;
        const originalPtr = ctx.storagePtr;
        ctx.storageLen = knownLen * elemSize32;
        liftResults = readValuesAndReset(ctx, null, originalLen, ctx.storagePtr, knownLen);
      }
    } else {
      if (ctx.useDirectParams) {
        const dataPtr = ctx.params[0];
        const len = ctx.params[1];
        ctx.params = ctx.params.slice(2);
        ctx.useDirectParams = false;
        const originalPtr = ctx.storagePtr;
        const originalLen = ctx.storageLen;
        ctx.storageLen = len * elemSize32;
        liftResults = readValuesAndReset(ctx, originalPtr, originalLen, dataPtr, len);
        ctx.useDirectParams = true;
      } else {
        const originalLen = ctx.storageLen;
        ctx.storageLen = 8;
        const dataPtrLiftRes = _liftFlatU32(ctx);
        const dataPtr = dataPtrLiftRes[0];
        ctx = dataPtrLiftRes[1];
        const lenLiftRes = _liftFlatU32(ctx);
        const len = lenLiftRes[0];
        ctx = lenLiftRes[1];
        const originalPtr = ctx.storagePtr;
        ctx.storagePtr = dataPtr;
        ctx.storageLen = len * elemSize32;
        liftResults = readValuesAndReset(ctx, originalPtr, originalLen, dataPtr, len);
      }
    }
    return liftResults;
  };
}
function _liftFlatResult(meta) {
  const f = _liftFlatVariant(meta);
  return function _liftFlatResultInner(ctx) {
    _debugLog("[_liftFlatResult()] args", { ctx });
    const res = f(ctx);
    if (!("val" in res[0])) {
      res[0].val = void 0;
    }
    return res;
  };
}
function _liftFlatBorrow(componentTableIdx, size, memory, vals, storagePtr, storageLen) {
  _debugLog("[_liftFlatBorrow()] args", { size, memory, vals, storagePtr, storageLen });
  throw new Error("flat lift for borrowed resources is not supported!");
}
function _lowerFlatU8(ctx) {
  _debugLog("[_lowerFlatU8()] args", ctx);
  if (ctx.vals.length !== 1) {
    throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
  }
  _requireValidNumericPrimitive.bind("u8", ctx.vals[0]);
  if (!ctx.memory) {
    throw new Error("missing memory for lower");
  }
  new DataView(ctx.memory.buffer).setUint8(ctx.storagePtr, ctx.vals[0]);
  ctx.storagePtr += 1;
}
function _lowerFlatU16(ctx) {
  _debugLog("[_lowerFlatU16()] args", { ctx });
  if (!ctx.memory) {
    throw new Error("missing memory for lower");
  }
  if (ctx.vals.length !== 1) {
    throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
  }
  const rem = ctx.storagePtr % 2;
  if (rem !== 0) {
    ctx.storagePtr += 2 - rem;
  }
  _requireValidNumericPrimitive.bind("u16", ctx.vals[0]);
  new DataView(ctx.memory.buffer).setUint16(ctx.storagePtr, ctx.vals[0], true);
  ctx.storagePtr += 2;
}
function _lowerFlatU32(ctx) {
  _debugLog("[_lowerFlatU32()] args", { ctx });
  if (ctx.vals.length !== 1) {
    throw new Error(`expected single value to lower, got [${ctx.vals.length}]`);
  }
  const rem = ctx.storagePtr % 4;
  if (rem !== 0) {
    ctx.storagePtr += 4 - rem;
  }
  _requireValidNumericPrimitive.bind("u32", ctx.vals[0]);
  new DataView(ctx.memory.buffer).setUint32(ctx.storagePtr, ctx.vals[0], true);
  ctx.storagePtr += 4;
}
function _lowerFlatU64(ctx) {
  _debugLog("[_lowerFlatU64()] args", { ctx });
  if (ctx.vals.length !== 1) {
    throw new Error("unexpected number of vals");
  }
  const rem = ctx.storagePtr % 8;
  if (rem !== 0) {
    ctx.storagePtr += 8 - rem;
  }
  _requireValidNumericPrimitive.bind("u64", ctx.vals[0]);
  new DataView(ctx.memory.buffer).setBigUint64(ctx.storagePtr, ctx.vals[0], true);
  ctx.storagePtr += 8;
}
function _lowerFlatStringUTF8(ctx) {
  _debugLog("[_lowerFlatStringUTF8()] args", ctx);
  if (!ctx.realloc) {
    throw new Error("missing realloc during flat string lower");
  }
  const { ptr, len } = _utf8AllocateAndEncode(ctx.vals[0], ctx.realloc, ctx.memory);
  const view = new DataView(ctx.memory.buffer);
  view.setUint32(ctx.storagePtr, ptr, true);
  view.setUint32(ctx.storagePtr + 4, len, true);
  ctx.storagePtr += 8;
}
function _lowerFlatStringUTF16(ctx) {
  _debugLog("[_lowerFlatStringUTF16()] args", { ctx });
  if (!ctx.realloc) {
    throw new Error("missing realloc during flat string lower");
  }
  const { ptr, len } = _utf16AllocateAndEncode(ctx.vals[0], ctx.realloc, ctx.memory);
  const view = new DataView(ctx.memory.buffer);
  view.setUint32(ctx.storagePtr, ptr, true);
  view.setUint32(ctx.storagePtr + 4, len, true);
  ctx.storagePtr += 8;
}
function _lowerFlatStringAny(ctx) {
  switch (ctx.stringEncoding) {
    case "utf8":
      return _lowerFlatStringUTF8(ctx);
    case "utf16":
      return _lowerFlatStringUTF16(ctx);
    default:
      throw new Error(`missing/unrecognized/unsupported string encoding [${ctx.stringEncoding}]`);
  }
}
function _lowerFlatRecord(meta) {
  const { fieldMetas, size32: recordSize32, align32: recordAlign32 } = meta;
  return function _lowerFlatRecordInner(ctx) {
    _debugLog("[_lowerFlatRecord()] args", { ctx });
    const originalPtr = ctx.storagePtr;
    const r = ctx.vals[0];
    for (const [tag, lowerFn, size32, align32] of fieldMetas) {
      const rem2 = ctx.storagePtr % align32;
      if (rem2 !== 0) {
        ctx.storagePtr += align32 - rem2;
      }
      const fieldPtr = ctx.storagePtr;
      ctx.vals = [r[tag]];
      lowerFn(ctx);
      ctx.storagePtr = Math.max(ctx.storagePtr, fieldPtr + size32);
    }
    ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + recordSize32);
    const rem = ctx.storagePtr % recordAlign32;
    if (rem !== 0) {
      ctx.storagePtr += recordAlign32 - rem;
    }
  };
}
function _lowerFlatVariant(meta) {
  const { variantSize32, variantAlign32, variantPayloadOffset32, caseMetas } = meta;
  let caseLookup = {};
  for (const [idx, meta2] of caseMetas.entries()) {
    let tag = meta2[0];
    caseLookup[tag] = { discriminant: idx, meta: meta2 };
  }
  return function _lowerFlatVariantInner(ctx) {
    _debugLog("[_lowerFlatVariant()] args", { ctx });
    const { tag, val } = ctx.vals[0];
    const variantCase = caseLookup[tag];
    if (!variantCase) {
      throw new Error(`missing tag [${tag}] (valid tags: ${Object.keys(caseLookup)})`);
    }
    const [_tag, lowerFn, caseSize32, caseAlign32, caseFlatCount] = variantCase.meta;
    const originalPtr = ctx.storagePtr;
    ctx.vals = [variantCase.discriminant];
    let discLowerRes;
    if (caseMetas.length < 256) {
      discLowerRes = _lowerFlatU8(ctx);
    } else if (caseMetas.length >= 256 && caseMetas.length < 65536) {
      discLowerRes = _lowerFlatU16(ctx);
    } else if (caseMetas.length >= 65536 && caseMetas.length < 4294967296) {
      discLowerRes = _lowerFlatU32(ctx);
    } else {
      throw new Error(`unsupported number of cases [${caseMetas.length}]`);
    }
    const payloadOffsetPtr = originalPtr + variantPayloadOffset32;
    ctx.storagePtr = payloadOffsetPtr;
    ctx.vals = [val];
    if (lowerFn) {
      lowerFn(ctx);
    }
    ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + variantSize32);
    const rem = ctx.storagePtr % variantAlign32;
    if (rem !== 0) {
      ctx.storagePtr += variantAlign32 - rem;
    }
  };
}
function _lowerFlatList(meta) {
  const {
    elemLowerFn,
    knownLen,
    size32,
    align32,
    elemSize32,
    elemAlign32
  } = meta;
  if (!elemLowerFn) {
    throw new TypeError("missing/invalid element lower fn for list");
  }
  return function _lowerFlatListInner(ctx) {
    _debugLog("[_lowerFlatList()] args", { ctx });
    if (ctx.useDirectParams) {
      if (ctx.params.length < 2) {
        throw new Error("insufficient params left to lower list");
      }
      const storagePtr = ctx.params[0];
      const elemCount = ctx.params[1];
      ctx.params = ctx.params.slice(2);
      const list = ctx.vals[0];
      if (!list) {
        throw new Error("missing direct param value");
      }
      const lowerCtx = {
        storagePtr,
        memory: ctx.memory,
        stringEncoding: ctx.stringEncoding
      };
      for (let idx = 0; idx < list.length; idx++) {
        const elemPtr = storagePtr + idx * elemSize32;
        lowerCtx.storagePtr = elemPtr;
        lowerCtx.vals = list.slice(idx, idx + 1);
        elemLowerFn(lowerCtx);
        lowerCtx.storagePtr = Math.max(lowerCtx.storagePtr, elemPtr + elemSize32);
      }
      ctx.storagePtr = lowerCtx.storagePtr;
      return;
    }
    const elems = ctx.vals[0];
    if (knownLen === void 0) {
      if (!ctx.realloc) {
        throw new Error("missing realloc during flat string lower");
      }
      const dataPtr = ctx.realloc(0, 0, elemAlign32, elemSize32 * elems.length);
      ctx.vals[0] = dataPtr;
      _lowerFlatU32(ctx);
      ctx.vals[0] = elems.length;
      _lowerFlatU32(ctx);
      const origPtr = ctx.storagePtr;
      ctx.storagePtr = dataPtr;
      for (const [idx, elem] of elems.entries()) {
        const elemPtr = dataPtr + idx * elemSize32;
        ctx.storagePtr = elemPtr;
        ctx.vals = [elem];
        elemLowerFn(ctx);
        ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + elemSize32);
      }
      ctx.storagePtr = origPtr;
    } else {
      if (elems.length !== knownLen) {
        throw new TypeError(`invalid list input of length [${elems.length}], must be length [${knownLen}]`);
      }
      const originalPtr = ctx.storagePtr;
      for (const [idx, elem] of elems.entries()) {
        const elemPtr = originalPtr + idx * elemSize32;
        ctx.storagePtr = elemPtr;
        ctx.vals = [elem];
        elemLowerFn(ctx);
        ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + elemSize32);
      }
    }
    const totalSizeBytes = elems.length * size32;
    if (ctx.storageLen !== void 0 && totalSizeBytes > ctx.storageLen) {
      throw new Error("not enough storage remaining for list flat lower");
    }
  };
}
function _lowerFlatTuple(meta) {
  const { elemLowerMetas, size32: tupleSize32, align32: tupleAlign32 } = meta;
  return function _lowerFlatTupleInner(ctx) {
    _debugLog("[_lowerFlatTuple()] args", { ctx });
    const originalPtr = ctx.storagePtr;
    const tuple = ctx.vals[0];
    for (const [idx, [lowerFn, size32, align32]] of elemLowerMetas.entries()) {
      const rem2 = ctx.storagePtr % align32;
      if (rem2 !== 0) {
        ctx.storagePtr += align32 - rem2;
      }
      const elemPtr = ctx.storagePtr;
      ctx.vals = [tuple[idx]];
      lowerFn(ctx);
      ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + size32);
    }
    ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + tupleSize32);
    const rem = ctx.storagePtr % tupleAlign32;
    if (rem !== 0) {
      ctx.storagePtr += tupleAlign32 - rem;
    }
  };
}
function _lowerFlatEnum(meta) {
  const f = _lowerFlatVariant(meta);
  return function _lowerFlatEnumInner(ctx) {
    _debugLog("[_lowerFlatEnum()] args", { ctx });
    const v = ctx.vals[0];
    const isNotEnumObject = typeof v !== "object" || Object.keys(v).length !== 2 || !("tag" in v);
    if (isNotEnumObject) {
      ctx.vals[0] = { tag: v };
    }
    f(ctx);
  };
}
function _lowerFlatOption(meta) {
  const { payloadMaybeNull } = meta;
  const f = _lowerFlatVariant(meta);
  return function _lowerFlatOptionInner(ctx) {
    _debugLog("[_lowerFlatOption()] args", { ctx });
    const v = ctx.vals[0];
    if (v === null || v === void 0) {
      ctx.vals[0] = { tag: "none" };
    } else if (payloadMaybeNull) {
      const isNotOptionObject = typeof v !== "object" || Object.keys(v).length !== 2 || !("tag" in v) || !(v.tag === "some" || v.tag === "none") || !("val" in v);
      if (isNotOptionObject) {
        ctx.vals[0] = { tag: "some", val: v };
      }
    } else {
      ctx.vals[0] = { tag: "some", val: v };
    }
    f(ctx);
  };
}
function _lowerFlatResult(meta) {
  const f = _lowerFlatVariant(meta);
  return function _lowerFlatResultInner(ctx) {
    _debugLog("[_lowerFlatResult()] args", { ctx });
    const v = ctx.vals[0];
    const isNotResultObject = typeof v !== "object" || Object.keys(v).length !== 2 || !("tag" in v) || !("ok" === v.tag || "err" === v.tag) || !("val" in v);
    if (isNotResultObject) {
      ctx.vals[0] = { tag: "ok", val: v };
    }
    f(ctx);
  };
}
function _lowerFlatOwn(meta) {
  const { lowerFn, componentIdx: componentIdx2, tableIdx } = meta;
  return function _lowerFlatOwnInner(ctx) {
    _debugLog("[_lowerFlatOwn()] args", { ctx });
    const { createFn } = ctx;
    if (ctx.componentIdx !== componentIdx2) {
      throw new Error(`component index mismatch (expected [${componentIdx2}], lift called from [${ctx.componentIdx}])`);
    }
    const obj = ctx.vals[0];
    if (obj === void 0 || obj === null) {
      throw new Error("missing resource");
    }
    const handle = ctx.lowerResource ? ctx.lowerResource(obj, tableIdx) : lowerFn(obj);
    ctx.vals[0] = handle;
    _lowerFlatU32(ctx);
  };
}
function _trackHostOperation(operation) {
  const result = operation();
  if (result === null || typeof result !== "object" && typeof result !== "function" || typeof result.then !== "function") {
    return result;
  }
  STORE_ASYNC_STATE.pendingHostOperations++;
  return Promise.resolve(result).finally(() => {
    STORE_ASYNC_STATE.pendingHostOperations--;
    if (STORE_ASYNC_STATE.pendingHostOperations < 0) {
      throw new Error("negative pending host operation count");
    }
    for (const state of ASYNC_STATE.values()) {
      state.runTickLoop();
    }
    _checkForDeadlock();
  });
}
function _guardMayLeave(componentIdx2, fn) {
  return function(...args) {
    _checkMayLeave(componentIdx2);
    return fn.apply(this, args);
  };
}
var base64Compile = (str) => WebAssembly.compile(
  typeof Buffer !== "undefined" ? Buffer.from(str, "base64") : Uint8Array.from(atob(str), (b) => b.charCodeAt(0))
);
function clampGuest(i, min, max) {
  if (i < min || i > max) {
    throw new TypeError(`must be between ${min} and ${max}`);
  }
  return i;
}
var isNode = typeof process !== "undefined" && process.versions && process.versions.node;
var _fs;
async function fetchCompile(url) {
  if (isNode) {
    _fs = _fs || await import("node:fs/promises");
    return WebAssembly.compile(await _fs.readFile(url));
  }
  return fetch(url).then(WebAssembly.compileStreaming);
}
var symbolCabiDispose = /* @__PURE__ */ Symbol.for("cabiDispose");
var symbolRscHandle = /* @__PURE__ */ Symbol("handle");
var symbolRscRep = /* @__PURE__ */ Symbol.for("cabiRep");
var symbolDispose3 = Symbol.dispose || /* @__PURE__ */ Symbol.for("dispose");
var HANDLE_TABLES = [];
var ComponentError = class extends Error {
  constructor(value) {
    const enumerable = typeof value !== "string";
    super(enumerable ? `${String(value)} (see error.payload)` : value);
    Object.defineProperty(this, "payload", { value, enumerable });
  }
};
var hasOwnProperty = Object.prototype.hasOwnProperty;
function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, "payload")) return e.payload;
  if (e instanceof Error) throw e;
  return e;
}
function throwInvalidBool() {
  throw new TypeError("invalid variant discriminant for bool");
}
var instantiateCore = WebAssembly.instantiate;
function _suspendingImport(componentIdx2, fn, syncOnly = false, switchesTask = false) {
  return function(...args) {
    _checkMayLeave(componentIdx2);
    const saved = CURRENT_TASK_META[componentIdx2] ?? null;
    const savedTask = saved ? getCurrentTask(saved.componentIdx, saved.taskID)?.task : null;
    const mayBlock = savedTask ? savedTask?.mayBlock() ?? CURRENT_TASK_MAY_BLOCK.value !== 0 : false;
    if (!saved && !mayBlock) {
      throw new WebAssemblyRuntimeError("cannot block a synchronous task before returning");
    }
    if (syncOnly || !mayBlock) {
      let result;
      try {
        result = fn.apply(null, args);
      } catch (err) {
        CURRENT_TASK_META[componentIdx2] = saved;
        if (!switchesTask) {
          CURRENT_TASK_META.current = saved;
        }
        throw err;
      }
      CURRENT_TASK_META[componentIdx2] = saved;
      if (!switchesTask) {
        CURRENT_TASK_META.current = saved;
      }
      if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") {
        Promise.resolve(result).catch(() => {
        });
        throw new WebAssemblyRuntimeError("cannot block a synchronous task before returning");
      }
      return result;
    }
    return (async () => {
      try {
        return await fn.apply(null, args);
      } finally {
        CURRENT_TASK_META[componentIdx2] = saved;
        if (!switchesTask) {
          CURRENT_TASK_META.current = saved;
        }
      }
    })();
  };
}
var exports0;
var exports1;
var _trampoline0 = function() {
  _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.3", function="now"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "now",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => now())
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.3", function="now"][Instruction::Return]', {
    funcName: "now",
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([toUint64(ret)]);
  task.exit();
  return toUint64(ret);
};
_trampoline0.fnName = "wasi:clocks/monotonic-clock@0.2.3#now";
var handleTable1 = [T_FLAG, 0];
handleTable1._createdReps = /* @__PURE__ */ new Set();
handleTable1._componentIdx = 0;
var captureTable1 = /* @__PURE__ */ new Map();
var captureCnt1 = 0;
HANDLE_TABLES[1] = handleTable1;
var _trampoline5 = function() {
  _debugLog('[iface="wasi:cli/stderr@0.2.3", function="get-stderr"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "getStderr",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => getStderr())
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  if (!(ret instanceof OutputStream2)) {
    throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
  }
  var handle0 = ret[symbolRscHandle];
  if (!handle0) {
    const rep2 = ret[symbolRscRep] || ++captureCnt1;
    captureTable1.set(rep2, ret);
    handle0 = rscTableCreateOwn(handleTable1, rep2);
  }
  _debugLog('[iface="wasi:cli/stderr@0.2.3", function="get-stderr"][Instruction::Return]', {
    funcName: "get-stderr",
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
};
_trampoline5.fnName = "wasi:cli/stderr@0.2.3#getStderr";
var handleTable2 = [T_FLAG, 0];
handleTable2._createdReps = /* @__PURE__ */ new Set();
handleTable2._componentIdx = 0;
var captureTable2 = /* @__PURE__ */ new Map();
var captureCnt2 = 0;
HANDLE_TABLES[2] = handleTable2;
var _trampoline6 = function() {
  _debugLog('[iface="wasi:cli/stdin@0.2.3", function="get-stdin"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "getStdin",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => getStdin())
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  if (!(ret instanceof InputStream2)) {
    throw new TypeError('Resource error: Not a valid "InputStream" resource.');
  }
  var handle0 = ret[symbolRscHandle];
  if (!handle0) {
    const rep2 = ret[symbolRscRep] || ++captureCnt2;
    captureTable2.set(rep2, ret);
    handle0 = rscTableCreateOwn(handleTable2, rep2);
  }
  _debugLog('[iface="wasi:cli/stdin@0.2.3", function="get-stdin"][Instruction::Return]', {
    funcName: "get-stdin",
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
};
_trampoline6.fnName = "wasi:cli/stdin@0.2.3#getStdin";
var _trampoline7 = function() {
  _debugLog('[iface="wasi:cli/stdout@0.2.3", function="get-stdout"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "getStdout",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => getStdout())
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  if (!(ret instanceof OutputStream2)) {
    throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
  }
  var handle0 = ret[symbolRscHandle];
  if (!handle0) {
    const rep2 = ret[symbolRscRep] || ++captureCnt1;
    captureTable1.set(rep2, ret);
    handle0 = rscTableCreateOwn(handleTable1, rep2);
  }
  _debugLog('[iface="wasi:cli/stdout@0.2.3", function="get-stdout"][Instruction::Return]', {
    funcName: "get-stdout",
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
};
_trampoline7.fnName = "wasi:cli/stdout@0.2.3#getStdout";
var _trampoline8 = function(arg0) {
  let variant0;
  switch (arg0) {
    case 0: {
      variant0 = {
        tag: "ok",
        val: void 0
      };
      break;
    }
    case 1: {
      variant0 = {
        tag: "err",
        val: void 0
      };
      break;
    }
    default: {
      throw new TypeError("invalid variant discriminant for expected");
    }
  }
  _debugLog('[iface="wasi:cli/exit@0.2.3", function="exit"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "exit",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => exit2(variant0))
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  _debugLog('[iface="wasi:cli/exit@0.2.3", function="exit"][Instruction::Return]', {
    funcName: "exit",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline8.fnName = "wasi:cli/exit@0.2.3#exit";
var exports2;
var memory0;
var realloc0;
var realloc0Async;
var _trampoline9 = function(arg0) {
  _debugLog('[iface="wasi:cli/environment@0.2.3", function="get-environment"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "getEnvironment",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => getEnvironment())
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  var vec3 = ret;
  var len3 = vec3.length;
  var result3 = realloc0(0, 0, 4, len3 * 16);
  for (let i = 0; i < vec3.length; i++) {
    const e = vec3[i];
    const base = result3 + i * 16;
    var [tuple0_0, tuple0_1] = e;
    var encodeRes = _utf8AllocateAndEncode(tuple0_0, realloc0, memory0);
    var ptr1 = encodeRes.ptr;
    var len1 = encodeRes.len;
    dataView(memory0).setUint32(base + 4, len1, true);
    dataView(memory0).setUint32(base + 0, ptr1, true);
    var encodeRes = _utf8AllocateAndEncode(tuple0_1, realloc0, memory0);
    var ptr2 = encodeRes.ptr;
    var len2 = encodeRes.len;
    dataView(memory0).setUint32(base + 12, len2, true);
    dataView(memory0).setUint32(base + 8, ptr2, true);
  }
  dataView(memory0).setUint32(arg0 + 4, len3, true);
  dataView(memory0).setUint32(arg0 + 0, result3, true);
  _debugLog('[iface="wasi:cli/environment@0.2.3", function="get-environment"][Instruction::Return]', {
    funcName: "get-environment",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline9.fnName = "wasi:cli/environment@0.2.3#getEnvironment";
var _trampoline10 = function(arg0) {
  _debugLog('[iface="wasi:clocks/wall-clock@0.2.3", function="now"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "now$1",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => now$1())
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  var { seconds: v0_0, nanoseconds: v0_1 } = ret;
  dataView(memory0).setBigInt64(arg0 + 0, toUint64(v0_0), true);
  dataView(memory0).setInt32(arg0 + 8, toUint32(v0_1), true);
  _debugLog('[iface="wasi:clocks/wall-clock@0.2.3", function="now"][Instruction::Return]', {
    funcName: "now",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline10.fnName = "wasi:clocks/wall-clock@0.2.3#now$1";
var handleTable0 = [T_FLAG, 0];
handleTable0._createdReps = /* @__PURE__ */ new Set();
handleTable0._componentIdx = 0;
var captureTable0 = /* @__PURE__ */ new Map();
var captureCnt0 = 0;
HANDLE_TABLES[0] = handleTable0;
var _trampoline11 = function(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable0[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable0.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Error$1.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="filesystem-error-code"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "filesystemErrorCode",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => filesystemErrorCode(rsc0))
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant4 = ret;
  if (variant4 === null || variant4 === void 0) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant4;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var val3 = e;
    let enum3;
    switch (val3) {
      case "access": {
        enum3 = 0;
        break;
      }
      case "would-block": {
        enum3 = 1;
        break;
      }
      case "already": {
        enum3 = 2;
        break;
      }
      case "bad-descriptor": {
        enum3 = 3;
        break;
      }
      case "busy": {
        enum3 = 4;
        break;
      }
      case "deadlock": {
        enum3 = 5;
        break;
      }
      case "quota": {
        enum3 = 6;
        break;
      }
      case "exist": {
        enum3 = 7;
        break;
      }
      case "file-too-large": {
        enum3 = 8;
        break;
      }
      case "illegal-byte-sequence": {
        enum3 = 9;
        break;
      }
      case "in-progress": {
        enum3 = 10;
        break;
      }
      case "interrupted": {
        enum3 = 11;
        break;
      }
      case "invalid": {
        enum3 = 12;
        break;
      }
      case "io": {
        enum3 = 13;
        break;
      }
      case "is-directory": {
        enum3 = 14;
        break;
      }
      case "loop": {
        enum3 = 15;
        break;
      }
      case "too-many-links": {
        enum3 = 16;
        break;
      }
      case "message-size": {
        enum3 = 17;
        break;
      }
      case "name-too-long": {
        enum3 = 18;
        break;
      }
      case "no-device": {
        enum3 = 19;
        break;
      }
      case "no-entry": {
        enum3 = 20;
        break;
      }
      case "no-lock": {
        enum3 = 21;
        break;
      }
      case "insufficient-memory": {
        enum3 = 22;
        break;
      }
      case "insufficient-space": {
        enum3 = 23;
        break;
      }
      case "not-directory": {
        enum3 = 24;
        break;
      }
      case "not-empty": {
        enum3 = 25;
        break;
      }
      case "not-recoverable": {
        enum3 = 26;
        break;
      }
      case "unsupported": {
        enum3 = 27;
        break;
      }
      case "no-tty": {
        enum3 = 28;
        break;
      }
      case "no-such-device": {
        enum3 = 29;
        break;
      }
      case "overflow": {
        enum3 = 30;
        break;
      }
      case "not-permitted": {
        enum3 = 31;
        break;
      }
      case "pipe": {
        enum3 = 32;
        break;
      }
      case "read-only": {
        enum3 = 33;
        break;
      }
      case "invalid-seek": {
        enum3 = 34;
        break;
      }
      case "text-file-busy": {
        enum3 = 35;
        break;
      }
      case "cross-device": {
        enum3 = 36;
        break;
      }
      default: {
        if (e instanceof Error) {
          console.error(e);
        }
        throw new TypeError(`"${val3}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg1 + 1, enum3, true);
  }
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="filesystem-error-code"][Instruction::Return]', {
    funcName: "filesystem-error-code",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline11.fnName = "wasi:filesystem/types@0.2.3#filesystemErrorCode";
var handleTable3 = [T_FLAG, 0];
handleTable3._createdReps = /* @__PURE__ */ new Set();
handleTable3._componentIdx = 0;
var captureTable3 = /* @__PURE__ */ new Map();
var captureCnt3 = 0;
HANDLE_TABLES[3] = handleTable3;
var _trampoline12 = function(arg0, arg1, arg2) {
  var handle1 = arg0;
  var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable3.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor3.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.write-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "writeViaStream",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "result-catch-handler",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    const hostRet3 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.writeViaStream(BigInt.asUintN(64, BigInt(arg1))))
    });
    ret = hostRet3 !== null && typeof hostRet3 === "object" && (hostRet3.tag === "ok" || hostRet3.tag === "err") ? hostRet3 : { tag: "ok", val: hostRet3 };
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) {
      throw e;
    }
    ret = { tag: "err", val: getErrorPayload(e) };
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant6 = ret;
  switch (variant6.tag) {
    case "ok": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg2 + 0, 0, true);
      if (!(e instanceof OutputStream2)) {
        throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
      }
      var handle4 = e[symbolRscHandle];
      if (!handle4) {
        const rep3 = e[symbolRscRep] || ++captureCnt1;
        captureTable1.set(rep3, e);
        handle4 = rscTableCreateOwn(handleTable1, rep3);
      }
      dataView(memory0).setInt32(arg2 + 4, handle4, true);
      break;
    }
    case "err": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg2 + 0, 1, true);
      var val5 = e;
      let enum5;
      switch (val5) {
        case "access": {
          enum5 = 0;
          break;
        }
        case "would-block": {
          enum5 = 1;
          break;
        }
        case "already": {
          enum5 = 2;
          break;
        }
        case "bad-descriptor": {
          enum5 = 3;
          break;
        }
        case "busy": {
          enum5 = 4;
          break;
        }
        case "deadlock": {
          enum5 = 5;
          break;
        }
        case "quota": {
          enum5 = 6;
          break;
        }
        case "exist": {
          enum5 = 7;
          break;
        }
        case "file-too-large": {
          enum5 = 8;
          break;
        }
        case "illegal-byte-sequence": {
          enum5 = 9;
          break;
        }
        case "in-progress": {
          enum5 = 10;
          break;
        }
        case "interrupted": {
          enum5 = 11;
          break;
        }
        case "invalid": {
          enum5 = 12;
          break;
        }
        case "io": {
          enum5 = 13;
          break;
        }
        case "is-directory": {
          enum5 = 14;
          break;
        }
        case "loop": {
          enum5 = 15;
          break;
        }
        case "too-many-links": {
          enum5 = 16;
          break;
        }
        case "message-size": {
          enum5 = 17;
          break;
        }
        case "name-too-long": {
          enum5 = 18;
          break;
        }
        case "no-device": {
          enum5 = 19;
          break;
        }
        case "no-entry": {
          enum5 = 20;
          break;
        }
        case "no-lock": {
          enum5 = 21;
          break;
        }
        case "insufficient-memory": {
          enum5 = 22;
          break;
        }
        case "insufficient-space": {
          enum5 = 23;
          break;
        }
        case "not-directory": {
          enum5 = 24;
          break;
        }
        case "not-empty": {
          enum5 = 25;
          break;
        }
        case "not-recoverable": {
          enum5 = 26;
          break;
        }
        case "unsupported": {
          enum5 = 27;
          break;
        }
        case "no-tty": {
          enum5 = 28;
          break;
        }
        case "no-such-device": {
          enum5 = 29;
          break;
        }
        case "overflow": {
          enum5 = 30;
          break;
        }
        case "not-permitted": {
          enum5 = 31;
          break;
        }
        case "pipe": {
          enum5 = 32;
          break;
        }
        case "read-only": {
          enum5 = 33;
          break;
        }
        case "invalid-seek": {
          enum5 = 34;
          break;
        }
        case "text-file-busy": {
          enum5 = 35;
          break;
        }
        case "cross-device": {
          enum5 = 36;
          break;
        }
        default: {
          if (e instanceof Error) {
            console.error(e);
          }
          throw new TypeError(`"${val5}" is not one of the cases of error-code`);
        }
      }
      dataView(memory0).setInt8(arg2 + 4, enum5, true);
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6 });
      throw new TypeError("invalid variant specified for result");
    }
  }
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.write-via-stream"][Instruction::Return]', {
    funcName: "[method]descriptor.write-via-stream",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline12.fnName = "wasi:filesystem/types@0.2.3#writeViaStream";
var _trampoline13 = function(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable3.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor3.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.append-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "appendViaStream",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "result-catch-handler",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    const hostRet3 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.appendViaStream())
    });
    ret = hostRet3 !== null && typeof hostRet3 === "object" && (hostRet3.tag === "ok" || hostRet3.tag === "err") ? hostRet3 : { tag: "ok", val: hostRet3 };
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) {
      throw e;
    }
    ret = { tag: "err", val: getErrorPayload(e) };
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant6 = ret;
  switch (variant6.tag) {
    case "ok": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg1 + 0, 0, true);
      if (!(e instanceof OutputStream2)) {
        throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
      }
      var handle4 = e[symbolRscHandle];
      if (!handle4) {
        const rep3 = e[symbolRscRep] || ++captureCnt1;
        captureTable1.set(rep3, e);
        handle4 = rscTableCreateOwn(handleTable1, rep3);
      }
      dataView(memory0).setInt32(arg1 + 4, handle4, true);
      break;
    }
    case "err": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      var val5 = e;
      let enum5;
      switch (val5) {
        case "access": {
          enum5 = 0;
          break;
        }
        case "would-block": {
          enum5 = 1;
          break;
        }
        case "already": {
          enum5 = 2;
          break;
        }
        case "bad-descriptor": {
          enum5 = 3;
          break;
        }
        case "busy": {
          enum5 = 4;
          break;
        }
        case "deadlock": {
          enum5 = 5;
          break;
        }
        case "quota": {
          enum5 = 6;
          break;
        }
        case "exist": {
          enum5 = 7;
          break;
        }
        case "file-too-large": {
          enum5 = 8;
          break;
        }
        case "illegal-byte-sequence": {
          enum5 = 9;
          break;
        }
        case "in-progress": {
          enum5 = 10;
          break;
        }
        case "interrupted": {
          enum5 = 11;
          break;
        }
        case "invalid": {
          enum5 = 12;
          break;
        }
        case "io": {
          enum5 = 13;
          break;
        }
        case "is-directory": {
          enum5 = 14;
          break;
        }
        case "loop": {
          enum5 = 15;
          break;
        }
        case "too-many-links": {
          enum5 = 16;
          break;
        }
        case "message-size": {
          enum5 = 17;
          break;
        }
        case "name-too-long": {
          enum5 = 18;
          break;
        }
        case "no-device": {
          enum5 = 19;
          break;
        }
        case "no-entry": {
          enum5 = 20;
          break;
        }
        case "no-lock": {
          enum5 = 21;
          break;
        }
        case "insufficient-memory": {
          enum5 = 22;
          break;
        }
        case "insufficient-space": {
          enum5 = 23;
          break;
        }
        case "not-directory": {
          enum5 = 24;
          break;
        }
        case "not-empty": {
          enum5 = 25;
          break;
        }
        case "not-recoverable": {
          enum5 = 26;
          break;
        }
        case "unsupported": {
          enum5 = 27;
          break;
        }
        case "no-tty": {
          enum5 = 28;
          break;
        }
        case "no-such-device": {
          enum5 = 29;
          break;
        }
        case "overflow": {
          enum5 = 30;
          break;
        }
        case "not-permitted": {
          enum5 = 31;
          break;
        }
        case "pipe": {
          enum5 = 32;
          break;
        }
        case "read-only": {
          enum5 = 33;
          break;
        }
        case "invalid-seek": {
          enum5 = 34;
          break;
        }
        case "text-file-busy": {
          enum5 = 35;
          break;
        }
        case "cross-device": {
          enum5 = 36;
          break;
        }
        default: {
          if (e instanceof Error) {
            console.error(e);
          }
          throw new TypeError(`"${val5}" is not one of the cases of error-code`);
        }
      }
      dataView(memory0).setInt8(arg1 + 4, enum5, true);
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6 });
      throw new TypeError("invalid variant specified for result");
    }
  }
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.append-via-stream"][Instruction::Return]', {
    funcName: "[method]descriptor.append-via-stream",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline13.fnName = "wasi:filesystem/types@0.2.3#appendViaStream";
var _trampoline14 = function(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable3.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor3.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.get-type"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "getType",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "result-catch-handler",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    const hostRet3 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.getType())
    });
    ret = hostRet3 !== null && typeof hostRet3 === "object" && (hostRet3.tag === "ok" || hostRet3.tag === "err") ? hostRet3 : { tag: "ok", val: hostRet3 };
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) {
      throw e;
    }
    ret = { tag: "err", val: getErrorPayload(e) };
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant6 = ret;
  switch (variant6.tag) {
    case "ok": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg1 + 0, 0, true);
      var val4 = e;
      let enum4;
      switch (val4) {
        case "unknown": {
          enum4 = 0;
          break;
        }
        case "block-device": {
          enum4 = 1;
          break;
        }
        case "character-device": {
          enum4 = 2;
          break;
        }
        case "directory": {
          enum4 = 3;
          break;
        }
        case "fifo": {
          enum4 = 4;
          break;
        }
        case "symbolic-link": {
          enum4 = 5;
          break;
        }
        case "regular-file": {
          enum4 = 6;
          break;
        }
        case "socket": {
          enum4 = 7;
          break;
        }
        default: {
          if (e instanceof Error) {
            console.error(e);
          }
          throw new TypeError(`"${val4}" is not one of the cases of descriptor-type`);
        }
      }
      dataView(memory0).setInt8(arg1 + 1, enum4, true);
      break;
    }
    case "err": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      var val5 = e;
      let enum5;
      switch (val5) {
        case "access": {
          enum5 = 0;
          break;
        }
        case "would-block": {
          enum5 = 1;
          break;
        }
        case "already": {
          enum5 = 2;
          break;
        }
        case "bad-descriptor": {
          enum5 = 3;
          break;
        }
        case "busy": {
          enum5 = 4;
          break;
        }
        case "deadlock": {
          enum5 = 5;
          break;
        }
        case "quota": {
          enum5 = 6;
          break;
        }
        case "exist": {
          enum5 = 7;
          break;
        }
        case "file-too-large": {
          enum5 = 8;
          break;
        }
        case "illegal-byte-sequence": {
          enum5 = 9;
          break;
        }
        case "in-progress": {
          enum5 = 10;
          break;
        }
        case "interrupted": {
          enum5 = 11;
          break;
        }
        case "invalid": {
          enum5 = 12;
          break;
        }
        case "io": {
          enum5 = 13;
          break;
        }
        case "is-directory": {
          enum5 = 14;
          break;
        }
        case "loop": {
          enum5 = 15;
          break;
        }
        case "too-many-links": {
          enum5 = 16;
          break;
        }
        case "message-size": {
          enum5 = 17;
          break;
        }
        case "name-too-long": {
          enum5 = 18;
          break;
        }
        case "no-device": {
          enum5 = 19;
          break;
        }
        case "no-entry": {
          enum5 = 20;
          break;
        }
        case "no-lock": {
          enum5 = 21;
          break;
        }
        case "insufficient-memory": {
          enum5 = 22;
          break;
        }
        case "insufficient-space": {
          enum5 = 23;
          break;
        }
        case "not-directory": {
          enum5 = 24;
          break;
        }
        case "not-empty": {
          enum5 = 25;
          break;
        }
        case "not-recoverable": {
          enum5 = 26;
          break;
        }
        case "unsupported": {
          enum5 = 27;
          break;
        }
        case "no-tty": {
          enum5 = 28;
          break;
        }
        case "no-such-device": {
          enum5 = 29;
          break;
        }
        case "overflow": {
          enum5 = 30;
          break;
        }
        case "not-permitted": {
          enum5 = 31;
          break;
        }
        case "pipe": {
          enum5 = 32;
          break;
        }
        case "read-only": {
          enum5 = 33;
          break;
        }
        case "invalid-seek": {
          enum5 = 34;
          break;
        }
        case "text-file-busy": {
          enum5 = 35;
          break;
        }
        case "cross-device": {
          enum5 = 36;
          break;
        }
        default: {
          if (e instanceof Error) {
            console.error(e);
          }
          throw new TypeError(`"${val5}" is not one of the cases of error-code`);
        }
      }
      dataView(memory0).setInt8(arg1 + 1, enum5, true);
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6 });
      throw new TypeError("invalid variant specified for result");
    }
  }
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.get-type"][Instruction::Return]', {
    funcName: "[method]descriptor.get-type",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline14.fnName = "wasi:filesystem/types@0.2.3#getType";
var _trampoline15 = function(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable3.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor3.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.stat"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "stat",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "result-catch-handler",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    const hostRet3 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.stat())
    });
    ret = hostRet3 !== null && typeof hostRet3 === "object" && (hostRet3.tag === "ok" || hostRet3.tag === "err") ? hostRet3 : { tag: "ok", val: hostRet3 };
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) {
      throw e;
    }
    ret = { tag: "err", val: getErrorPayload(e) };
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant13 = ret;
  switch (variant13.tag) {
    case "ok": {
      const e = variant13.val;
      dataView(memory0).setInt8(arg1 + 0, 0, true);
      var { type: v4_0, linkCount: v4_1, size: v4_2, dataAccessTimestamp: v4_3, dataModificationTimestamp: v4_4, statusChangeTimestamp: v4_5 } = e;
      var val5 = v4_0;
      let enum5;
      switch (val5) {
        case "unknown": {
          enum5 = 0;
          break;
        }
        case "block-device": {
          enum5 = 1;
          break;
        }
        case "character-device": {
          enum5 = 2;
          break;
        }
        case "directory": {
          enum5 = 3;
          break;
        }
        case "fifo": {
          enum5 = 4;
          break;
        }
        case "symbolic-link": {
          enum5 = 5;
          break;
        }
        case "regular-file": {
          enum5 = 6;
          break;
        }
        case "socket": {
          enum5 = 7;
          break;
        }
        default: {
          if (v4_0 instanceof Error) {
            console.error(v4_0);
          }
          throw new TypeError(`"${val5}" is not one of the cases of descriptor-type`);
        }
      }
      dataView(memory0).setInt8(arg1 + 8, enum5, true);
      dataView(memory0).setBigInt64(arg1 + 16, toUint64(v4_1), true);
      dataView(memory0).setBigInt64(arg1 + 24, toUint64(v4_2), true);
      var variant7 = v4_3;
      if (variant7 === null || variant7 === void 0) {
        dataView(memory0).setInt8(arg1 + 32, 0, true);
      } else {
        const e2 = variant7;
        dataView(memory0).setInt8(arg1 + 32, 1, true);
        var { seconds: v6_0, nanoseconds: v6_1 } = e2;
        dataView(memory0).setBigInt64(arg1 + 40, toUint64(v6_0), true);
        dataView(memory0).setInt32(arg1 + 48, toUint32(v6_1), true);
      }
      var variant9 = v4_4;
      if (variant9 === null || variant9 === void 0) {
        dataView(memory0).setInt8(arg1 + 56, 0, true);
      } else {
        const e2 = variant9;
        dataView(memory0).setInt8(arg1 + 56, 1, true);
        var { seconds: v8_0, nanoseconds: v8_1 } = e2;
        dataView(memory0).setBigInt64(arg1 + 64, toUint64(v8_0), true);
        dataView(memory0).setInt32(arg1 + 72, toUint32(v8_1), true);
      }
      var variant11 = v4_5;
      if (variant11 === null || variant11 === void 0) {
        dataView(memory0).setInt8(arg1 + 80, 0, true);
      } else {
        const e2 = variant11;
        dataView(memory0).setInt8(arg1 + 80, 1, true);
        var { seconds: v10_0, nanoseconds: v10_1 } = e2;
        dataView(memory0).setBigInt64(arg1 + 88, toUint64(v10_0), true);
        dataView(memory0).setInt32(arg1 + 96, toUint32(v10_1), true);
      }
      break;
    }
    case "err": {
      const e = variant13.val;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      var val12 = e;
      let enum12;
      switch (val12) {
        case "access": {
          enum12 = 0;
          break;
        }
        case "would-block": {
          enum12 = 1;
          break;
        }
        case "already": {
          enum12 = 2;
          break;
        }
        case "bad-descriptor": {
          enum12 = 3;
          break;
        }
        case "busy": {
          enum12 = 4;
          break;
        }
        case "deadlock": {
          enum12 = 5;
          break;
        }
        case "quota": {
          enum12 = 6;
          break;
        }
        case "exist": {
          enum12 = 7;
          break;
        }
        case "file-too-large": {
          enum12 = 8;
          break;
        }
        case "illegal-byte-sequence": {
          enum12 = 9;
          break;
        }
        case "in-progress": {
          enum12 = 10;
          break;
        }
        case "interrupted": {
          enum12 = 11;
          break;
        }
        case "invalid": {
          enum12 = 12;
          break;
        }
        case "io": {
          enum12 = 13;
          break;
        }
        case "is-directory": {
          enum12 = 14;
          break;
        }
        case "loop": {
          enum12 = 15;
          break;
        }
        case "too-many-links": {
          enum12 = 16;
          break;
        }
        case "message-size": {
          enum12 = 17;
          break;
        }
        case "name-too-long": {
          enum12 = 18;
          break;
        }
        case "no-device": {
          enum12 = 19;
          break;
        }
        case "no-entry": {
          enum12 = 20;
          break;
        }
        case "no-lock": {
          enum12 = 21;
          break;
        }
        case "insufficient-memory": {
          enum12 = 22;
          break;
        }
        case "insufficient-space": {
          enum12 = 23;
          break;
        }
        case "not-directory": {
          enum12 = 24;
          break;
        }
        case "not-empty": {
          enum12 = 25;
          break;
        }
        case "not-recoverable": {
          enum12 = 26;
          break;
        }
        case "unsupported": {
          enum12 = 27;
          break;
        }
        case "no-tty": {
          enum12 = 28;
          break;
        }
        case "no-such-device": {
          enum12 = 29;
          break;
        }
        case "overflow": {
          enum12 = 30;
          break;
        }
        case "not-permitted": {
          enum12 = 31;
          break;
        }
        case "pipe": {
          enum12 = 32;
          break;
        }
        case "read-only": {
          enum12 = 33;
          break;
        }
        case "invalid-seek": {
          enum12 = 34;
          break;
        }
        case "text-file-busy": {
          enum12 = 35;
          break;
        }
        case "cross-device": {
          enum12 = 36;
          break;
        }
        default: {
          if (e instanceof Error) {
            console.error(e);
          }
          throw new TypeError(`"${val12}" is not one of the cases of error-code`);
        }
      }
      dataView(memory0).setInt8(arg1 + 8, enum12, true);
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant13, valueType: typeof variant13 });
      throw new TypeError("invalid variant specified for result");
    }
  }
  _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.stat"][Instruction::Return]', {
    funcName: "[method]descriptor.stat",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline15.fnName = "wasi:filesystem/types@0.2.3#stat";
var _trampoline16 = function(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable1.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream2.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.check-write"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "checkWrite",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "result-catch-handler",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    const hostRet3 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.checkWrite())
    });
    ret = hostRet3 !== null && typeof hostRet3 === "object" && (hostRet3.tag === "ok" || hostRet3.tag === "err") ? hostRet3 : { tag: "ok", val: hostRet3 };
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) {
      throw e;
    }
    ret = { tag: "err", val: getErrorPayload(e) };
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant6 = ret;
  switch (variant6.tag) {
    case "ok": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg1 + 0, 0, true);
      dataView(memory0).setBigInt64(arg1 + 8, toUint64(e), true);
      break;
    }
    case "err": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      var variant5 = e;
      switch (variant5.tag) {
        case "last-operation-failed": {
          const e2 = variant5.val;
          dataView(memory0).setInt8(arg1 + 8, 0, true);
          if (!(e2 instanceof Error$1)) {
            throw new TypeError('Resource error: Not a valid "Error" resource.');
          }
          var handle4 = e2[symbolRscHandle];
          if (!handle4) {
            const rep3 = e2[symbolRscRep] || ++captureCnt0;
            captureTable0.set(rep3, e2);
            handle4 = rscTableCreateOwn(handleTable0, rep3);
          }
          dataView(memory0).setInt32(arg1 + 12, handle4, true);
          break;
        }
        case "closed": {
          dataView(memory0).setInt8(arg1 + 8, 1, true);
          break;
        }
        default: {
          throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant5.tag)}\` (received \`${variant5}\`) specified for \`StreamError\``);
        }
      }
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6 });
      throw new TypeError("invalid variant specified for result");
    }
  }
  _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.check-write"][Instruction::Return]', {
    funcName: "[method]output-stream.check-write",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline16.fnName = "wasi:io/streams@0.2.3#checkWrite";
var _trampoline17 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable1.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream2.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  var ptr3 = arg1;
  var len3 = arg2;
  if (ptr3 % 1 !== 0) throw new TypeError(`list pointer [${ptr3}] is not aligned to 1`);
  var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
  _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.write"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "write",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "result-catch-handler",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    const hostRet4 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.write(result3))
    });
    ret = hostRet4 !== null && typeof hostRet4 === "object" && (hostRet4.tag === "ok" || hostRet4.tag === "err") ? hostRet4 : { tag: "ok", val: hostRet4 };
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) {
      throw e;
    }
    ret = { tag: "err", val: getErrorPayload(e) };
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant7 = ret;
  switch (variant7.tag) {
    case "ok": {
      const e = variant7.val;
      dataView(memory0).setInt8(arg3 + 0, 0, true);
      break;
    }
    case "err": {
      const e = variant7.val;
      dataView(memory0).setInt8(arg3 + 0, 1, true);
      var variant6 = e;
      switch (variant6.tag) {
        case "last-operation-failed": {
          const e2 = variant6.val;
          dataView(memory0).setInt8(arg3 + 4, 0, true);
          if (!(e2 instanceof Error$1)) {
            throw new TypeError('Resource error: Not a valid "Error" resource.');
          }
          var handle5 = e2[symbolRscHandle];
          if (!handle5) {
            const rep3 = e2[symbolRscRep] || ++captureCnt0;
            captureTable0.set(rep3, e2);
            handle5 = rscTableCreateOwn(handleTable0, rep3);
          }
          dataView(memory0).setInt32(arg3 + 8, handle5, true);
          break;
        }
        case "closed": {
          dataView(memory0).setInt8(arg3 + 4, 1, true);
          break;
        }
        default: {
          throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`StreamError\``);
        }
      }
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7 });
      throw new TypeError("invalid variant specified for result");
    }
  }
  _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.write"][Instruction::Return]', {
    funcName: "[method]output-stream.write",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline17.fnName = "wasi:io/streams@0.2.3#write";
var _trampoline18 = function(arg0, arg1) {
  var handle1 = arg0;
  var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable1.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream2.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.blocking-flush"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "blockingFlush",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "result-catch-handler",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    const hostRet3 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.blockingFlush())
    });
    ret = hostRet3 !== null && typeof hostRet3 === "object" && (hostRet3.tag === "ok" || hostRet3.tag === "err") ? hostRet3 : { tag: "ok", val: hostRet3 };
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) {
      throw e;
    }
    ret = { tag: "err", val: getErrorPayload(e) };
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant6 = ret;
  switch (variant6.tag) {
    case "ok": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg1 + 0, 0, true);
      break;
    }
    case "err": {
      const e = variant6.val;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      var variant5 = e;
      switch (variant5.tag) {
        case "last-operation-failed": {
          const e2 = variant5.val;
          dataView(memory0).setInt8(arg1 + 4, 0, true);
          if (!(e2 instanceof Error$1)) {
            throw new TypeError('Resource error: Not a valid "Error" resource.');
          }
          var handle4 = e2[symbolRscHandle];
          if (!handle4) {
            const rep3 = e2[symbolRscRep] || ++captureCnt0;
            captureTable0.set(rep3, e2);
            handle4 = rscTableCreateOwn(handleTable0, rep3);
          }
          dataView(memory0).setInt32(arg1 + 8, handle4, true);
          break;
        }
        case "closed": {
          dataView(memory0).setInt8(arg1 + 4, 1, true);
          break;
        }
        default: {
          throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant5.tag)}\` (received \`${variant5}\`) specified for \`StreamError\``);
        }
      }
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6 });
      throw new TypeError("invalid variant specified for result");
    }
  }
  _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.blocking-flush"][Instruction::Return]', {
    funcName: "[method]output-stream.blocking-flush",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline18.fnName = "wasi:io/streams@0.2.3#blockingFlush";
var _trampoline19 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable1.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream2.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1 });
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2 });
  }
  curResourceBorrows.push(rsc0);
  var ptr3 = arg1;
  var len3 = arg2;
  if (ptr3 % 1 !== 0) throw new TypeError(`list pointer [${ptr3}] is not aligned to 1`);
  var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
  _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.blocking-write-and-flush"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "blockingWriteAndFlush",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "result-catch-handler",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    const hostRet4 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.blockingWriteAndFlush(result3))
    });
    ret = hostRet4 !== null && typeof hostRet4 === "object" && (hostRet4.tag === "ok" || hostRet4.tag === "err") ? hostRet4 : { tag: "ok", val: hostRet4 };
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) {
      throw e;
    }
    ret = { tag: "err", val: getErrorPayload(e) };
  }
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = void 0;
  }
  curResourceBorrows = [];
  var variant7 = ret;
  switch (variant7.tag) {
    case "ok": {
      const e = variant7.val;
      dataView(memory0).setInt8(arg3 + 0, 0, true);
      break;
    }
    case "err": {
      const e = variant7.val;
      dataView(memory0).setInt8(arg3 + 0, 1, true);
      var variant6 = e;
      switch (variant6.tag) {
        case "last-operation-failed": {
          const e2 = variant6.val;
          dataView(memory0).setInt8(arg3 + 4, 0, true);
          if (!(e2 instanceof Error$1)) {
            throw new TypeError('Resource error: Not a valid "Error" resource.');
          }
          var handle5 = e2[symbolRscHandle];
          if (!handle5) {
            const rep3 = e2[symbolRscRep] || ++captureCnt0;
            captureTable0.set(rep3, e2);
            handle5 = rscTableCreateOwn(handleTable0, rep3);
          }
          dataView(memory0).setInt32(arg3 + 8, handle5, true);
          break;
        }
        case "closed": {
          dataView(memory0).setInt8(arg3 + 4, 1, true);
          break;
        }
        default: {
          throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`StreamError\``);
        }
      }
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7 });
      throw new TypeError("invalid variant specified for result");
    }
  }
  _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.blocking-write-and-flush"][Instruction::Return]', {
    funcName: "[method]output-stream.blocking-write-and-flush",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline19.fnName = "wasi:io/streams@0.2.3#blockingWriteAndFlush";
var _trampoline20 = function(arg0, arg1) {
  _debugLog('[iface="wasi:random/random@0.2.3", function="get-random-bytes"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "getRandomBytes",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => getRandomBytes(BigInt.asUintN(64, BigInt(arg0))))
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  var val0 = ret;
  var len0 = Array.isArray(val0) ? val0.length : val0.byteLength;
  var ptr0 = realloc0(0, 0, 1, len0 * 1);
  let valData0;
  const valLenBytes0 = len0 * 1;
  if (Array.isArray(val0)) {
    let offset = 0;
    const dv0 = new DataView(memory0.buffer);
    for (const v of val0) {
      _requireValidNumericPrimitive.bind(null, "u8")(v);
      dv0.setUint8(ptr0 + offset, v, true);
      offset += 1;
    }
  } else {
    valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
    const out0 = new Uint8Array(memory0.buffer, ptr0, valLenBytes0);
    out0.set(valData0);
  }
  dataView(memory0).setUint32(arg1 + 4, len0, true);
  dataView(memory0).setUint32(arg1 + 0, ptr0, true);
  _debugLog('[iface="wasi:random/random@0.2.3", function="get-random-bytes"][Instruction::Return]', {
    funcName: "get-random-bytes",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline20.fnName = "wasi:random/random@0.2.3#getRandomBytes";
var _trampoline21 = function(arg0) {
  _debugLog('[iface="wasi:filesystem/preopens@0.2.3", function="get-directories"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  let parentTask;
  let task;
  let subtask;
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: "getDirectories",
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: "none",
      callingWasmExport: false
    });
    task = results[0];
  };
  taskCreation: {
    parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID
    )?.task;
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    createTask();
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  const started = task.enterSync();
  let ret;
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => getDirectories())
    });
  } catch (err) {
    _debugLog("[Instruction::CallInterface] error during sync call", {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
  }
  var vec3 = ret;
  var len3 = vec3.length;
  var result3 = realloc0(0, 0, 4, len3 * 12);
  for (let i = 0; i < vec3.length; i++) {
    const e = vec3[i];
    const base = result3 + i * 12;
    var [tuple0_0, tuple0_1] = e;
    if (!(tuple0_0 instanceof Descriptor3)) {
      throw new TypeError('Resource error: Not a valid "Descriptor" resource.');
    }
    var handle1 = tuple0_0[symbolRscHandle];
    if (!handle1) {
      const rep2 = tuple0_0[symbolRscRep] || ++captureCnt3;
      captureTable3.set(rep2, tuple0_0);
      handle1 = rscTableCreateOwn(handleTable3, rep2);
    }
    dataView(memory0).setInt32(base + 0, handle1, true);
    var encodeRes = _utf8AllocateAndEncode(tuple0_1, realloc0, memory0);
    var ptr2 = encodeRes.ptr;
    var len2 = encodeRes.len;
    dataView(memory0).setUint32(base + 8, len2, true);
    dataView(memory0).setUint32(base + 4, ptr2, true);
  }
  dataView(memory0).setUint32(arg0 + 4, len3, true);
  dataView(memory0).setUint32(arg0 + 0, result3, true);
  _debugLog('[iface="wasi:filesystem/preopens@0.2.3", function="get-directories"][Instruction::Return]', {
    funcName: "get-directories",
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
};
_trampoline21.fnName = "wasi:filesystem/preopens@0.2.3#getDirectories";
var exports3;
var realloc1;
var realloc1Async;
var postReturn0;
var postReturn0Async;
var postReturn1;
var postReturn1Async;
var postReturn2;
var postReturn2Async;
var postReturn3;
var postReturn3Async;
var postReturn4;
var postReturn4Async;
var protocolEncodeBytes;
function encodeBytes(arg0, arg1, arg2) {
  const hostProvided = false;
  getOrCreateAsyncState(0).throwIfTrapped();
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    preserveFutureResult: false,
    entryFnName: "protocolEncodeBytes",
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: "throw-result-err",
    callingWasmExport: true
  });
  task.setCalleeIsAsync(false);
  const started = task.enterSync();
  CURRENT_TASK_MAY_BLOCK.value = task.mayBlock() ? 1 : 0;
  if (true) {
    task.setReturnMemoryIdx(0);
    task.setReturnMemory(/* @__PURE__ */ (() => memory0)());
  }
  return _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => {
      try {
        var val0 = arg0;
        var len0 = Array.isArray(val0) ? val0.length : val0.byteLength;
        var ptr0 = realloc1(0, 0, 1, len0 * 1);
        let valData0;
        const valLenBytes0 = len0 * 1;
        if (Array.isArray(val0)) {
          let offset = 0;
          const dv0 = new DataView(memory0.buffer);
          for (const v of val0) {
            _requireValidNumericPrimitive.bind(null, "u8")(v);
            dv0.setUint8(ptr0 + offset, v, true);
            offset += 1;
          }
        } else {
          valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
          const out0 = new Uint8Array(memory0.buffer, ptr0, valLenBytes0);
          out0.set(valData0);
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="encode-bytes"][Instruction::CallWasm] enter', {
          funcName: "encode-bytes",
          paramCount: 4,
          async: false,
          postReturn: true
        });
        let ret;
        try {
          ret = _withGlobalCurrentTaskMeta({
            taskID: task.id(),
            componentIdx: task.componentIdx(),
            fn: () => protocolEncodeBytes(ptr0, len0, toUint32(arg1), toUint8(arg2))
          });
        } catch (err) {
          _debugLog("[Instruction::CallWasm] error during sync call", {
            taskID: task.id(),
            err
          });
          getOrCreateAsyncState(0).markTrapped(err);
          task.setErrored(err);
          task.reject(err);
          task.exit();
          throw err;
        }
        let variant4;
        switch (dataView(memory0).getUint8(ret + 0, true)) {
          case 0: {
            var len2 = dataView(memory0).getUint32(ret + 8, true);
            var base2 = dataView(memory0).getUint32(ret + 4, true);
            if (base2 % 4 !== 0) throw new TypeError(`list pointer [${base2}] is not aligned to 4`);
            var result2 = [];
            for (let i = 0; i < len2; i++) {
              const base = base2 + i * 16;
              var ptr1 = dataView(memory0).getUint32(base + 0, true);
              var len1 = dataView(memory0).getUint32(base + 4, true);
              if (ptr1 % 1 !== 0) throw new TypeError(`list pointer [${ptr1}] is not aligned to 1`);
              var result1 = new Uint8Array(memory0.buffer.slice(ptr1, ptr1 + len1 * 1));
              result2.push({
                wireBytes: result1,
                frameNumber: dataView(memory0).getInt32(base + 8, true) >>> 0,
                totalQrCount: dataView(memory0).getInt32(base + 12, true) >>> 0
              });
            }
            variant4 = {
              tag: "ok",
              val: {
                frames: result2
              }
            };
            break;
          }
          case 1: {
            var ptr3 = dataView(memory0).getUint32(ret + 4, true);
            var len3 = dataView(memory0).getUint32(ret + 8, true);
            var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
            variant4 = {
              tag: "err",
              val: result3
            };
            break;
          }
          default: {
            throw new TypeError("invalid variant discriminant for expected");
          }
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="encode-bytes"][Instruction::Return]', {
          funcName: "encode-bytes",
          paramCount: 1,
          async: false,
          postReturn: true
        });
        const retCopy = variant4;
        task.resolve([retCopy.val]);
        let cstate = getOrCreateAsyncState(0);
        cstate.mayLeave = false;
        postReturn0(ret);
        cstate.mayLeave = true;
        task.exit();
        if (typeof retCopy === "object" && retCopy.tag === "err") {
          throw new ComponentError(retCopy.val);
        }
        return retCopy.val;
      } catch (err) {
        if (!task.isResolvedState()) {
          task.setErrored(err);
          task.reject(err);
        }
        if (!task.isExited()) {
          task.exit({ skipExclusiveLockCheck: true });
        }
        throw err;
      }
    }
  });
}
var protocolEncodeText;
function encodeText(arg0, arg1, arg2) {
  const hostProvided = false;
  getOrCreateAsyncState(0).throwIfTrapped();
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    preserveFutureResult: false,
    entryFnName: "protocolEncodeText",
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: "throw-result-err",
    callingWasmExport: true
  });
  task.setCalleeIsAsync(false);
  const started = task.enterSync();
  CURRENT_TASK_MAY_BLOCK.value = task.mayBlock() ? 1 : 0;
  if (true) {
    task.setReturnMemoryIdx(0);
    task.setReturnMemory(/* @__PURE__ */ (() => memory0)());
  }
  return _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => {
      try {
        var encodeRes = _utf8AllocateAndEncode(arg0, realloc1, memory0);
        var ptr0 = encodeRes.ptr;
        var len0 = encodeRes.len;
        _debugLog('[iface="snows:qr-data-transport/protocol", function="encode-text"][Instruction::CallWasm] enter', {
          funcName: "encode-text",
          paramCount: 4,
          async: false,
          postReturn: true
        });
        let ret;
        try {
          ret = _withGlobalCurrentTaskMeta({
            taskID: task.id(),
            componentIdx: task.componentIdx(),
            fn: () => protocolEncodeText(ptr0, len0, toUint32(arg1), toUint8(arg2))
          });
        } catch (err) {
          _debugLog("[Instruction::CallWasm] error during sync call", {
            taskID: task.id(),
            err
          });
          getOrCreateAsyncState(0).markTrapped(err);
          task.setErrored(err);
          task.reject(err);
          task.exit();
          throw err;
        }
        let variant4;
        switch (dataView(memory0).getUint8(ret + 0, true)) {
          case 0: {
            var len2 = dataView(memory0).getUint32(ret + 8, true);
            var base2 = dataView(memory0).getUint32(ret + 4, true);
            if (base2 % 4 !== 0) throw new TypeError(`list pointer [${base2}] is not aligned to 4`);
            var result2 = [];
            for (let i = 0; i < len2; i++) {
              const base = base2 + i * 16;
              var ptr1 = dataView(memory0).getUint32(base + 0, true);
              var len1 = dataView(memory0).getUint32(base + 4, true);
              if (ptr1 % 1 !== 0) throw new TypeError(`list pointer [${ptr1}] is not aligned to 1`);
              var result1 = new Uint8Array(memory0.buffer.slice(ptr1, ptr1 + len1 * 1));
              result2.push({
                wireBytes: result1,
                frameNumber: dataView(memory0).getInt32(base + 8, true) >>> 0,
                totalQrCount: dataView(memory0).getInt32(base + 12, true) >>> 0
              });
            }
            variant4 = {
              tag: "ok",
              val: {
                frames: result2
              }
            };
            break;
          }
          case 1: {
            var ptr3 = dataView(memory0).getUint32(ret + 4, true);
            var len3 = dataView(memory0).getUint32(ret + 8, true);
            var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
            variant4 = {
              tag: "err",
              val: result3
            };
            break;
          }
          default: {
            throw new TypeError("invalid variant discriminant for expected");
          }
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="encode-text"][Instruction::Return]', {
          funcName: "encode-text",
          paramCount: 1,
          async: false,
          postReturn: true
        });
        const retCopy = variant4;
        task.resolve([retCopy.val]);
        let cstate = getOrCreateAsyncState(0);
        cstate.mayLeave = false;
        postReturn0(ret);
        cstate.mayLeave = true;
        task.exit();
        if (typeof retCopy === "object" && retCopy.tag === "err") {
          throw new ComponentError(retCopy.val);
        }
        return retCopy.val;
      } catch (err) {
        if (!task.isResolvedState()) {
          task.setErrored(err);
          task.reject(err);
        }
        if (!task.isExited()) {
          task.exit({ skipExclusiveLockCheck: true });
        }
        throw err;
      }
    }
  });
}
var protocolParseFrame;
function parseFrame(arg0, arg1, arg2, arg3) {
  const hostProvided = false;
  getOrCreateAsyncState(0).throwIfTrapped();
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    preserveFutureResult: false,
    entryFnName: "protocolParseFrame",
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: "throw-result-err",
    callingWasmExport: true
  });
  task.setCalleeIsAsync(false);
  const started = task.enterSync();
  CURRENT_TASK_MAY_BLOCK.value = task.mayBlock() ? 1 : 0;
  if (true) {
    task.setReturnMemoryIdx(0);
    task.setReturnMemory(/* @__PURE__ */ (() => memory0)());
  }
  return _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => {
      try {
        var val0 = arg0;
        var len0 = Array.isArray(val0) ? val0.length : val0.byteLength;
        var ptr0 = realloc1(0, 0, 1, len0 * 1);
        let valData0;
        const valLenBytes0 = len0 * 1;
        if (Array.isArray(val0)) {
          let offset = 0;
          const dv0 = new DataView(memory0.buffer);
          for (const v of val0) {
            _requireValidNumericPrimitive.bind(null, "u8")(v);
            dv0.setUint8(ptr0 + offset, v, true);
            offset += 1;
          }
        } else {
          valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
          const out0 = new Uint8Array(memory0.buffer, ptr0, valLenBytes0);
          out0.set(valData0);
        }
        var variant1 = arg1;
        let variant1_0;
        let variant1_1;
        if (variant1 === null || variant1 === void 0) {
          variant1_0 = 0;
          variant1_1 = 0;
        } else {
          const e = variant1;
          variant1_0 = 1;
          variant1_1 = toUint32(e);
        }
        var variant2 = arg2;
        let variant2_0;
        let variant2_1;
        if (variant2 === null || variant2 === void 0) {
          variant2_0 = 0;
          variant2_1 = 0;
        } else {
          const e = variant2;
          variant2_0 = 1;
          variant2_1 = toUint16(e);
        }
        var variant3 = arg3;
        let variant3_0;
        let variant3_1;
        if (variant3 === null || variant3 === void 0) {
          variant3_0 = 0;
          variant3_1 = 0;
        } else {
          const e = variant3;
          variant3_0 = 1;
          variant3_1 = toUint8(e);
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="parse-frame"][Instruction::CallWasm] enter', {
          funcName: "parse-frame",
          paramCount: 8,
          async: false,
          postReturn: true
        });
        let ret;
        try {
          ret = _withGlobalCurrentTaskMeta({
            taskID: task.id(),
            componentIdx: task.componentIdx(),
            fn: () => protocolParseFrame(ptr0, len0, variant1_0, variant1_1, variant2_0, variant2_1, variant3_0, variant3_1)
          });
        } catch (err) {
          _debugLog("[Instruction::CallWasm] error during sync call", {
            taskID: task.id(),
            err
          });
          getOrCreateAsyncState(0).markTrapped(err);
          task.setErrored(err);
          task.reject(err);
          task.exit();
          throw err;
        }
        let variant12;
        switch (dataView(memory0).getUint8(ret + 0, true)) {
          case 0: {
            var bool4 = dataView(memory0).getUint8(ret + 4, true);
            var bool5 = dataView(memory0).getUint8(ret + 5, true);
            let variant6;
            switch (dataView(memory0).getUint8(ret + 16, true)) {
              case 0: {
                variant6 = void 0;
                break;
              }
              case 1: {
                variant6 = clampGuest(dataView(memory0).getUint8(ret + 17, true), 0, 255);
                break;
              }
              default: {
                throw new TypeError("invalid variant discriminant for option");
              }
            }
            let variant8;
            switch (dataView(memory0).getUint8(ret + 18, true)) {
              case 0: {
                variant8 = void 0;
                break;
              }
              case 1: {
                let enum7;
                switch (dataView(memory0).getUint8(ret + 19, true)) {
                  case 0: {
                    enum7 = "uint8array";
                    break;
                  }
                  case 1: {
                    enum7 = "bytes-string";
                    break;
                  }
                  default: {
                    throw new TypeError("invalid discriminant specified for DataType");
                  }
                }
                variant8 = enum7;
                break;
              }
              default: {
                throw new TypeError("invalid variant discriminant for option");
              }
            }
            let variant9;
            switch (dataView(memory0).getUint8(ret + 28, true)) {
              case 0: {
                variant9 = void 0;
                break;
              }
              case 1: {
                variant9 = dataView(memory0).getInt32(ret + 32, true) >>> 0;
                break;
              }
              default: {
                throw new TypeError("invalid variant discriminant for option");
              }
            }
            var bool10 = dataView(memory0).getUint8(ret + 36, true);
            variant12 = {
              tag: "ok",
              val: {
                isFirst: bool4 == 0 ? false : bool4 == 1 ? true : throwInvalidBool(),
                isParity: bool5 == 0 ? false : bool5 == 1 ? true : throwInvalidBool(),
                version: clampGuest(dataView(memory0).getUint8(ret + 6, true), 0, 255),
                totalQrCount: dataView(memory0).getInt32(ret + 8, true) >>> 0,
                frameNumber: dataView(memory0).getInt32(ret + 12, true) >>> 0,
                parityMode: variant6,
                dataType: variant8,
                payloadBitLen: dataView(memory0).getInt32(ret + 20, true) >>> 0,
                frameCrc: clampGuest(dataView(memory0).getUint16(ret + 24, true), 0, 65535),
                overallCrc: variant9,
                crcValid: bool10 == 0 ? false : bool10 == 1 ? true : throwInvalidBool()
              }
            };
            break;
          }
          case 1: {
            var ptr11 = dataView(memory0).getUint32(ret + 4, true);
            var len11 = dataView(memory0).getUint32(ret + 8, true);
            var result11 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr11, len11));
            variant12 = {
              tag: "err",
              val: result11
            };
            break;
          }
          default: {
            throw new TypeError("invalid variant discriminant for expected");
          }
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="parse-frame"][Instruction::Return]', {
          funcName: "parse-frame",
          paramCount: 1,
          async: false,
          postReturn: true
        });
        const retCopy = variant12;
        task.resolve([retCopy.val]);
        let cstate = getOrCreateAsyncState(0);
        cstate.mayLeave = false;
        postReturn1(ret);
        cstate.mayLeave = true;
        task.exit();
        if (typeof retCopy === "object" && retCopy.tag === "err") {
          throw new ComponentError(retCopy.val);
        }
        return retCopy.val;
      } catch (err) {
        if (!task.isResolvedState()) {
          task.setErrored(err);
          task.reject(err);
        }
        if (!task.isExited()) {
          task.exit({ skipExclusiveLockCheck: true });
        }
        throw err;
      }
    }
  });
}
var protocolDecodeFrames;
function decodeFrames(arg0) {
  const hostProvided = false;
  getOrCreateAsyncState(0).throwIfTrapped();
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    preserveFutureResult: false,
    entryFnName: "protocolDecodeFrames",
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: "throw-result-err",
    callingWasmExport: true
  });
  task.setCalleeIsAsync(false);
  const started = task.enterSync();
  CURRENT_TASK_MAY_BLOCK.value = task.mayBlock() ? 1 : 0;
  if (true) {
    task.setReturnMemoryIdx(0);
    task.setReturnMemory(/* @__PURE__ */ (() => memory0)());
  }
  return _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => {
      try {
        var vec1 = arg0;
        var len1 = vec1.length;
        var result1 = realloc1(0, 0, 4, len1 * 8);
        for (let i = 0; i < vec1.length; i++) {
          const e = vec1[i];
          const base = result1 + i * 8;
          var val0 = e;
          var len0 = Array.isArray(val0) ? val0.length : val0.byteLength;
          var ptr0 = realloc1(0, 0, 1, len0 * 1);
          let valData0;
          const valLenBytes0 = len0 * 1;
          if (Array.isArray(val0)) {
            let offset = 0;
            const dv0 = new DataView(memory0.buffer);
            for (const v of val0) {
              _requireValidNumericPrimitive.bind(null, "u8")(v);
              dv0.setUint8(ptr0 + offset, v, true);
              offset += 1;
            }
          } else {
            valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
            const out0 = new Uint8Array(memory0.buffer, ptr0, valLenBytes0);
            out0.set(valData0);
          }
          dataView(memory0).setUint32(base + 4, len0, true);
          dataView(memory0).setUint32(base + 0, ptr0, true);
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="decode-frames"][Instruction::CallWasm] enter', {
          funcName: "decode-frames",
          paramCount: 2,
          async: false,
          postReturn: true
        });
        let ret;
        try {
          ret = _withGlobalCurrentTaskMeta({
            taskID: task.id(),
            componentIdx: task.componentIdx(),
            fn: () => protocolDecodeFrames(result1, len1)
          });
        } catch (err) {
          _debugLog("[Instruction::CallWasm] error during sync call", {
            taskID: task.id(),
            err
          });
          getOrCreateAsyncState(0).markTrapped(err);
          task.setErrored(err);
          task.reject(err);
          task.exit();
          throw err;
        }
        let variant6;
        switch (dataView(memory0).getUint8(ret + 0, true)) {
          case 0: {
            let variant4;
            switch (dataView(memory0).getUint8(ret + 4, true)) {
              case 0: {
                var ptr2 = dataView(memory0).getUint32(ret + 8, true);
                var len2 = dataView(memory0).getUint32(ret + 12, true);
                if (ptr2 % 1 !== 0) throw new TypeError(`list pointer [${ptr2}] is not aligned to 1`);
                var result2 = new Uint8Array(memory0.buffer.slice(ptr2, ptr2 + len2 * 1));
                variant4 = {
                  tag: "bytes",
                  val: result2
                };
                break;
              }
              case 1: {
                var ptr3 = dataView(memory0).getUint32(ret + 8, true);
                var len3 = dataView(memory0).getUint32(ret + 12, true);
                var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
                variant4 = {
                  tag: "text",
                  val: result3
                };
                break;
              }
              default: {
                throw new TypeError("invalid variant discriminant for DecodedPayload");
              }
            }
            variant6 = {
              tag: "ok",
              val: variant4
            };
            break;
          }
          case 1: {
            var ptr5 = dataView(memory0).getUint32(ret + 4, true);
            var len5 = dataView(memory0).getUint32(ret + 8, true);
            var result5 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr5, len5));
            variant6 = {
              tag: "err",
              val: result5
            };
            break;
          }
          default: {
            throw new TypeError("invalid variant discriminant for expected");
          }
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="decode-frames"][Instruction::Return]', {
          funcName: "decode-frames",
          paramCount: 1,
          async: false,
          postReturn: true
        });
        const retCopy = variant6;
        task.resolve([retCopy.val]);
        let cstate = getOrCreateAsyncState(0);
        cstate.mayLeave = false;
        postReturn2(ret);
        cstate.mayLeave = true;
        task.exit();
        if (typeof retCopy === "object" && retCopy.tag === "err") {
          throw new ComponentError(retCopy.val);
        }
        return retCopy.val;
      } catch (err) {
        if (!task.isResolvedState()) {
          task.setErrored(err);
          task.reject(err);
        }
        if (!task.isExited()) {
          task.exit({ skipExclusiveLockCheck: true });
        }
        throw err;
      }
    }
  });
}
var protocolGenerateQrMatrix;
function generateQrMatrix(arg0, arg1, arg2) {
  const hostProvided = false;
  getOrCreateAsyncState(0).throwIfTrapped();
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    preserveFutureResult: false,
    entryFnName: "protocolGenerateQrMatrix",
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: "throw-result-err",
    callingWasmExport: true
  });
  task.setCalleeIsAsync(false);
  const started = task.enterSync();
  CURRENT_TASK_MAY_BLOCK.value = task.mayBlock() ? 1 : 0;
  if (true) {
    task.setReturnMemoryIdx(0);
    task.setReturnMemory(/* @__PURE__ */ (() => memory0)());
  }
  return _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => {
      try {
        var val0 = arg0;
        var len0 = Array.isArray(val0) ? val0.length : val0.byteLength;
        var ptr0 = realloc1(0, 0, 1, len0 * 1);
        let valData0;
        const valLenBytes0 = len0 * 1;
        if (Array.isArray(val0)) {
          let offset = 0;
          const dv0 = new DataView(memory0.buffer);
          for (const v of val0) {
            _requireValidNumericPrimitive.bind(null, "u8")(v);
            dv0.setUint8(ptr0 + offset, v, true);
            offset += 1;
          }
        } else {
          valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
          const out0 = new Uint8Array(memory0.buffer, ptr0, valLenBytes0);
          out0.set(valData0);
        }
        var val1 = arg2;
        let enum1;
        switch (val1) {
          case "l": {
            enum1 = 0;
            break;
          }
          case "m": {
            enum1 = 1;
            break;
          }
          case "q": {
            enum1 = 2;
            break;
          }
          case "h": {
            enum1 = 3;
            break;
          }
          default: {
            if (arg2 instanceof Error) {
              console.error(arg2);
            }
            throw new TypeError(`"${val1}" is not one of the cases of qr-ec-level`);
          }
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="generate-qr-matrix"][Instruction::CallWasm] enter', {
          funcName: "generate-qr-matrix",
          paramCount: 4,
          async: false,
          postReturn: true
        });
        let ret;
        try {
          ret = _withGlobalCurrentTaskMeta({
            taskID: task.id(),
            componentIdx: task.componentIdx(),
            fn: () => protocolGenerateQrMatrix(ptr0, len0, toUint8(arg1), enum1)
          });
        } catch (err) {
          _debugLog("[Instruction::CallWasm] error during sync call", {
            taskID: task.id(),
            err
          });
          getOrCreateAsyncState(0).markTrapped(err);
          task.setErrored(err);
          task.reject(err);
          task.exit();
          throw err;
        }
        let variant4;
        switch (dataView(memory0).getUint8(ret + 0, true)) {
          case 0: {
            var ptr2 = dataView(memory0).getUint32(ret + 12, true);
            var len2 = dataView(memory0).getUint32(ret + 16, true);
            if (ptr2 % 1 !== 0) throw new TypeError(`list pointer [${ptr2}] is not aligned to 1`);
            var result2 = new Uint8Array(memory0.buffer.slice(ptr2, ptr2 + len2 * 1));
            variant4 = {
              tag: "ok",
              val: {
                width: dataView(memory0).getInt32(ret + 4, true) >>> 0,
                height: dataView(memory0).getInt32(ret + 8, true) >>> 0,
                modules: result2
              }
            };
            break;
          }
          case 1: {
            var ptr3 = dataView(memory0).getUint32(ret + 4, true);
            var len3 = dataView(memory0).getUint32(ret + 8, true);
            var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
            variant4 = {
              tag: "err",
              val: result3
            };
            break;
          }
          default: {
            throw new TypeError("invalid variant discriminant for expected");
          }
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="generate-qr-matrix"][Instruction::Return]', {
          funcName: "generate-qr-matrix",
          paramCount: 1,
          async: false,
          postReturn: true
        });
        const retCopy = variant4;
        task.resolve([retCopy.val]);
        let cstate = getOrCreateAsyncState(0);
        cstate.mayLeave = false;
        postReturn3(ret);
        cstate.mayLeave = true;
        task.exit();
        if (typeof retCopy === "object" && retCopy.tag === "err") {
          throw new ComponentError(retCopy.val);
        }
        return retCopy.val;
      } catch (err) {
        if (!task.isResolvedState()) {
          task.setErrored(err);
          task.reject(err);
        }
        if (!task.isExited()) {
          task.exit({ skipExclusiveLockCheck: true });
        }
        throw err;
      }
    }
  });
}
var protocolDecodeQrImage;
function decodeQrImage(arg0, arg1, arg2) {
  const hostProvided = false;
  getOrCreateAsyncState(0).throwIfTrapped();
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    preserveFutureResult: false,
    entryFnName: "protocolDecodeQrImage",
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: "throw-result-err",
    callingWasmExport: true
  });
  task.setCalleeIsAsync(false);
  const started = task.enterSync();
  CURRENT_TASK_MAY_BLOCK.value = task.mayBlock() ? 1 : 0;
  if (true) {
    task.setReturnMemoryIdx(0);
    task.setReturnMemory(/* @__PURE__ */ (() => memory0)());
  }
  return _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => {
      try {
        var val0 = arg0;
        var len0 = Array.isArray(val0) ? val0.length : val0.byteLength;
        var ptr0 = realloc1(0, 0, 1, len0 * 1);
        let valData0;
        const valLenBytes0 = len0 * 1;
        if (Array.isArray(val0)) {
          let offset = 0;
          const dv0 = new DataView(memory0.buffer);
          for (const v of val0) {
            _requireValidNumericPrimitive.bind(null, "u8")(v);
            dv0.setUint8(ptr0 + offset, v, true);
            offset += 1;
          }
        } else {
          valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
          const out0 = new Uint8Array(memory0.buffer, ptr0, valLenBytes0);
          out0.set(valData0);
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="decode-qr-image"][Instruction::CallWasm] enter', {
          funcName: "decode-qr-image",
          paramCount: 4,
          async: false,
          postReturn: true
        });
        let ret;
        try {
          ret = _withGlobalCurrentTaskMeta({
            taskID: task.id(),
            componentIdx: task.componentIdx(),
            fn: () => protocolDecodeQrImage(ptr0, len0, toUint32(arg1), toUint32(arg2))
          });
        } catch (err) {
          _debugLog("[Instruction::CallWasm] error during sync call", {
            taskID: task.id(),
            err
          });
          getOrCreateAsyncState(0).markTrapped(err);
          task.setErrored(err);
          task.reject(err);
          task.exit();
          throw err;
        }
        let variant3;
        switch (dataView(memory0).getUint8(ret + 0, true)) {
          case 0: {
            var ptr1 = dataView(memory0).getUint32(ret + 4, true);
            var len1 = dataView(memory0).getUint32(ret + 8, true);
            if (ptr1 % 1 !== 0) throw new TypeError(`list pointer [${ptr1}] is not aligned to 1`);
            var result1 = new Uint8Array(memory0.buffer.slice(ptr1, ptr1 + len1 * 1));
            variant3 = {
              tag: "ok",
              val: result1
            };
            break;
          }
          case 1: {
            var ptr2 = dataView(memory0).getUint32(ret + 4, true);
            var len2 = dataView(memory0).getUint32(ret + 8, true);
            var result2 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr2, len2));
            variant3 = {
              tag: "err",
              val: result2
            };
            break;
          }
          default: {
            throw new TypeError("invalid variant discriminant for expected");
          }
        }
        _debugLog('[iface="snows:qr-data-transport/protocol", function="decode-qr-image"][Instruction::Return]', {
          funcName: "decode-qr-image",
          paramCount: 1,
          async: false,
          postReturn: true
        });
        const retCopy = variant3;
        task.resolve([retCopy.val]);
        let cstate = getOrCreateAsyncState(0);
        cstate.mayLeave = false;
        postReturn4(ret);
        cstate.mayLeave = true;
        task.exit();
        if (typeof retCopy === "object" && retCopy.tag === "err") {
          throw new ComponentError(retCopy.val);
        }
        return retCopy.val;
      } catch (err) {
        if (!task.isResolvedState()) {
          task.setErrored(err);
          task.reject(err);
        }
        if (!task.isExited()) {
          task.exit({ skipExclusiveLockCheck: true });
        }
        throw err;
      }
    }
  });
}
var trampoline0 = _trampoline0.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 0,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline0.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatU64],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline0
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 0,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline0.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatU64],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline0
  }
);
function trampoline1(handle) {
  const handleEntry = rscTableRemove(handleTable3, handle);
  if (handleEntry.own) {
    const rsc = captureTable3.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose3]) rsc[symbolDispose3]();
      captureTable3.delete(handleEntry.rep);
    } else if (Descriptor3[symbolCabiDispose]) {
      Descriptor3[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline2(handle) {
  const handleEntry = rscTableRemove(handleTable1, handle);
  if (handleEntry.own) {
    const rsc = captureTable1.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose3]) rsc[symbolDispose3]();
      captureTable1.delete(handleEntry.rep);
    } else if (OutputStream2[symbolCabiDispose]) {
      OutputStream2[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline3(handle) {
  const handleEntry = rscTableRemove(handleTable0, handle);
  if (handleEntry.own) {
    const rsc = captureTable0.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose3]) rsc[symbolDispose3]();
      captureTable0.delete(handleEntry.rep);
    } else if (Error$1[symbolCabiDispose]) {
      Error$1[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline4(handle) {
  const handleEntry = rscTableRemove(handleTable2, handle);
  if (handleEntry.own) {
    const rsc = captureTable2.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose3]) rsc[symbolDispose3]();
      captureTable2.delete(handleEntry.rep);
    } else if (InputStream2[symbolCabiDispose]) {
      InputStream2[symbolCabiDispose](handleEntry.rep);
    }
  }
}
var trampoline5 = _trampoline5.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 5,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline5.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      tableIdx: 1,
      lowerFn: function lowerImportedOwnedHost_OutputStream(obj) {
        if (!(obj instanceof OutputStream2)) {
          throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep2 = obj[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep2, obj);
          handle = rscTableCreateOwn(handleTable1, rep2);
        }
        return handle;
      }
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline5
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 5,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline5.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      tableIdx: 1,
      lowerFn: function lowerImportedOwnedHost_OutputStream2(obj) {
        if (!(obj instanceof OutputStream2)) {
          throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep2 = obj[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep2, obj);
          handle = rscTableCreateOwn(handleTable1, rep2);
        }
        return handle;
      }
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline5
  }
);
var trampoline6 = _trampoline6.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 6,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline6.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      tableIdx: 2,
      lowerFn: function lowerImportedOwnedHost_InputStream(obj) {
        if (!(obj instanceof InputStream2)) {
          throw new TypeError('Resource error: Not a valid "InputStream" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep2 = obj[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep2, obj);
          handle = rscTableCreateOwn(handleTable2, rep2);
        }
        return handle;
      }
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline6
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 6,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline6.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      tableIdx: 2,
      lowerFn: function lowerImportedOwnedHost_InputStream2(obj) {
        if (!(obj instanceof InputStream2)) {
          throw new TypeError('Resource error: Not a valid "InputStream" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep2 = obj[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep2, obj);
          handle = rscTableCreateOwn(handleTable2, rep2);
        }
        return handle;
      }
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline6
  }
);
var trampoline7 = _trampoline7.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 7,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline7.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      tableIdx: 1,
      lowerFn: function lowerImportedOwnedHost_OutputStream3(obj) {
        if (!(obj instanceof OutputStream2)) {
          throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep2 = obj[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep2, obj);
          handle = rscTableCreateOwn(handleTable1, rep2);
        }
        return handle;
      }
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline7
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 7,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline7.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      tableIdx: 1,
      lowerFn: function lowerImportedOwnedHost_OutputStream4(obj) {
        if (!(obj instanceof OutputStream2)) {
          throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep2 = obj[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep2, obj);
          handle = rscTableCreateOwn(handleTable1, rep2);
        }
        return handle;
      }
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline7
  }
);
var trampoline8 = _trampoline8.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 8,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline8.manuallyAsync,
    paramLiftFns: [
      _liftFlatResult({
        caseMetas: [["ok", null, 0, 0, 0, []], ["err", null, 0, 0, 0, []]],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
        variantPayloadFlatTypes: []
      })
    ],
    resultLowerFns: [],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline8
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 8,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline8.manuallyAsync,
    paramLiftFns: [
      _liftFlatResult({
        caseMetas: [["ok", null, 0, 0, 0, []], ["err", null, 0, 0, 0, []]],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
        variantPayloadFlatTypes: []
      })
    ],
    resultLowerFns: [],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: "utf8",
    getMemoryFn: () => null,
    getReallocFn: void 0,
    importFn: _trampoline8
  }
);
var trampoline9 = _trampoline9.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 9,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline9.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatStringAny, 8, 4], [_lowerFlatStringAny, 8, 4]], size32: 16, align32: 4 }),
      elemSize32: 16,
      elemAlign32: 4
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline9
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 9,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline9.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatStringAny, 8, 4], [_lowerFlatStringAny, 8, 4]], size32: 16, align32: 4 }),
      elemSize32: 16,
      elemAlign32: 4
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline9
  }
);
var trampoline10 = _trampoline10.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 10,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline10.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatRecord({ fieldMetas: [["seconds", _lowerFlatU64, 8, 8], ["nanoseconds", _lowerFlatU32, 4, 4]], size32: 16, align32: 8 })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline10
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 10,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline10.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatRecord({ fieldMetas: [["seconds", _lowerFlatU64, 8, 8], ["nanoseconds", _lowerFlatU32, 4, 4]], size32: 16, align32: 8 })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline10
  }
);
var trampoline11 = _trampoline11.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 11,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline11.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 0)],
    resultLowerFns: [
      _lowerFlatOption({
        caseMetas: [
          ["none", null, 0, 0, 0],
          [
            "some",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            1,
            1,
            1
          ]
        ],
        variantSize32: 2,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 2,
        payloadMaybeNull: false
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline11
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 11,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline11.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 0)],
    resultLowerFns: [
      _lowerFlatOption({
        caseMetas: [
          ["none", null, 0, 0, 0],
          [
            "some",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            1,
            1,
            1
          ]
        ],
        variantSize32: 2,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 2,
        payloadMaybeNull: false
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline11
  }
);
var trampoline12 = _trampoline12.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 12,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline12.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3), _liftFlatU64],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", _lowerFlatOwn({
            componentIdx: 0,
            tableIdx: 1,
            lowerFn: function lowerImportedOwnedHost_OutputStream5(obj) {
              if (!(obj instanceof OutputStream2)) {
                throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
              }
              let handle = obj[symbolRscHandle];
              if (!handle) {
                const rep2 = obj[symbolRscRep] || ++captureCnt1;
                captureTable1.set(rep2, obj);
                handle = rscTableCreateOwn(handleTable1, rep2);
              }
              return handle;
            }
          }), 8, 4, 4],
          [
            "err",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            8,
            4,
            4
          ]
        ],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline12
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 12,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline12.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3), _liftFlatU64],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", _lowerFlatOwn({
            componentIdx: 0,
            tableIdx: 1,
            lowerFn: function lowerImportedOwnedHost_OutputStream6(obj) {
              if (!(obj instanceof OutputStream2)) {
                throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
              }
              let handle = obj[symbolRscHandle];
              if (!handle) {
                const rep2 = obj[symbolRscRep] || ++captureCnt1;
                captureTable1.set(rep2, obj);
                handle = rscTableCreateOwn(handleTable1, rep2);
              }
              return handle;
            }
          }), 8, 4, 4],
          [
            "err",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            8,
            4,
            4
          ]
        ],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline12
  }
);
var trampoline13 = _trampoline13.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 13,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline13.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", _lowerFlatOwn({
            componentIdx: 0,
            tableIdx: 1,
            lowerFn: function lowerImportedOwnedHost_OutputStream7(obj) {
              if (!(obj instanceof OutputStream2)) {
                throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
              }
              let handle = obj[symbolRscHandle];
              if (!handle) {
                const rep2 = obj[symbolRscRep] || ++captureCnt1;
                captureTable1.set(rep2, obj);
                handle = rscTableCreateOwn(handleTable1, rep2);
              }
              return handle;
            }
          }), 8, 4, 4],
          [
            "err",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            8,
            4,
            4
          ]
        ],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline13
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 13,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline13.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", _lowerFlatOwn({
            componentIdx: 0,
            tableIdx: 1,
            lowerFn: function lowerImportedOwnedHost_OutputStream8(obj) {
              if (!(obj instanceof OutputStream2)) {
                throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
              }
              let handle = obj[symbolRscHandle];
              if (!handle) {
                const rep2 = obj[symbolRscRep] || ++captureCnt1;
                captureTable1.set(rep2, obj);
                handle = rscTableCreateOwn(handleTable1, rep2);
              }
              return handle;
            }
          }), 8, 4, 4],
          [
            "err",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            8,
            4,
            4
          ]
        ],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline13
  }
);
var trampoline14 = _trampoline14.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 14,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline14.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          [
            "ok",
            _lowerFlatEnum({
              caseMetas: [["unknown", null, 1, 1, 1], ["block-device", null, 1, 1, 1], ["character-device", null, 1, 1, 1], ["directory", null, 1, 1, 1], ["fifo", null, 1, 1, 1], ["symbolic-link", null, 1, 1, 1], ["regular-file", null, 1, 1, 1], ["socket", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            2,
            1,
            1
          ],
          [
            "err",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            2,
            1,
            1
          ]
        ],
        variantSize32: 2,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 2
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline14
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 14,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline14.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          [
            "ok",
            _lowerFlatEnum({
              caseMetas: [["unknown", null, 1, 1, 1], ["block-device", null, 1, 1, 1], ["character-device", null, 1, 1, 1], ["directory", null, 1, 1, 1], ["fifo", null, 1, 1, 1], ["symbolic-link", null, 1, 1, 1], ["regular-file", null, 1, 1, 1], ["socket", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            2,
            1,
            1
          ],
          [
            "err",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            2,
            1,
            1
          ]
        ],
        variantSize32: 2,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 2
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline14
  }
);
var trampoline15 = _trampoline15.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 15,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline15.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", _lowerFlatRecord({ fieldMetas: [[
            "type",
            _lowerFlatEnum({
              caseMetas: [["unknown", null, 1, 1, 1], ["block-device", null, 1, 1, 1], ["character-device", null, 1, 1, 1], ["directory", null, 1, 1, 1], ["fifo", null, 1, 1, 1], ["symbolic-link", null, 1, 1, 1], ["regular-file", null, 1, 1, 1], ["socket", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            1,
            1
          ], ["linkCount", _lowerFlatU64, 8, 8], ["size", _lowerFlatU64, 8, 8], [
            "dataAccessTimestamp",
            _lowerFlatOption({
              caseMetas: [
                ["none", null, 0, 0, 0],
                ["some", _lowerFlatRecord({ fieldMetas: [["seconds", _lowerFlatU64, 8, 8], ["nanoseconds", _lowerFlatU32, 4, 4]], size32: 16, align32: 8 }), 16, 8, 2]
              ],
              variantSize32: 24,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 3,
              payloadMaybeNull: false
            }),
            24,
            8
          ], [
            "dataModificationTimestamp",
            _lowerFlatOption({
              caseMetas: [
                ["none", null, 0, 0, 0],
                ["some", _lowerFlatRecord({ fieldMetas: [["seconds", _lowerFlatU64, 8, 8], ["nanoseconds", _lowerFlatU32, 4, 4]], size32: 16, align32: 8 }), 16, 8, 2]
              ],
              variantSize32: 24,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 3,
              payloadMaybeNull: false
            }),
            24,
            8
          ], [
            "statusChangeTimestamp",
            _lowerFlatOption({
              caseMetas: [
                ["none", null, 0, 0, 0],
                ["some", _lowerFlatRecord({ fieldMetas: [["seconds", _lowerFlatU64, 8, 8], ["nanoseconds", _lowerFlatU32, 4, 4]], size32: 16, align32: 8 }), 16, 8, 2]
              ],
              variantSize32: 24,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 3,
              payloadMaybeNull: false
            }),
            24,
            8
          ]], size32: 96, align32: 8 }), 104, 8, 8],
          [
            "err",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            104,
            8,
            8
          ]
        ],
        variantSize32: 104,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 13
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline15
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 15,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline15.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", _lowerFlatRecord({ fieldMetas: [[
            "type",
            _lowerFlatEnum({
              caseMetas: [["unknown", null, 1, 1, 1], ["block-device", null, 1, 1, 1], ["character-device", null, 1, 1, 1], ["directory", null, 1, 1, 1], ["fifo", null, 1, 1, 1], ["symbolic-link", null, 1, 1, 1], ["regular-file", null, 1, 1, 1], ["socket", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            1,
            1
          ], ["linkCount", _lowerFlatU64, 8, 8], ["size", _lowerFlatU64, 8, 8], [
            "dataAccessTimestamp",
            _lowerFlatOption({
              caseMetas: [
                ["none", null, 0, 0, 0],
                ["some", _lowerFlatRecord({ fieldMetas: [["seconds", _lowerFlatU64, 8, 8], ["nanoseconds", _lowerFlatU32, 4, 4]], size32: 16, align32: 8 }), 16, 8, 2]
              ],
              variantSize32: 24,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 3,
              payloadMaybeNull: false
            }),
            24,
            8
          ], [
            "dataModificationTimestamp",
            _lowerFlatOption({
              caseMetas: [
                ["none", null, 0, 0, 0],
                ["some", _lowerFlatRecord({ fieldMetas: [["seconds", _lowerFlatU64, 8, 8], ["nanoseconds", _lowerFlatU32, 4, 4]], size32: 16, align32: 8 }), 16, 8, 2]
              ],
              variantSize32: 24,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 3,
              payloadMaybeNull: false
            }),
            24,
            8
          ], [
            "statusChangeTimestamp",
            _lowerFlatOption({
              caseMetas: [
                ["none", null, 0, 0, 0],
                ["some", _lowerFlatRecord({ fieldMetas: [["seconds", _lowerFlatU64, 8, 8], ["nanoseconds", _lowerFlatU32, 4, 4]], size32: 16, align32: 8 }), 16, 8, 2]
              ],
              variantSize32: 24,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 3,
              payloadMaybeNull: false
            }),
            24,
            8
          ]], size32: 96, align32: 8 }), 104, 8, 8],
          [
            "err",
            _lowerFlatEnum({
              caseMetas: [["access", null, 1, 1, 1], ["would-block", null, 1, 1, 1], ["already", null, 1, 1, 1], ["bad-descriptor", null, 1, 1, 1], ["busy", null, 1, 1, 1], ["deadlock", null, 1, 1, 1], ["quota", null, 1, 1, 1], ["exist", null, 1, 1, 1], ["file-too-large", null, 1, 1, 1], ["illegal-byte-sequence", null, 1, 1, 1], ["in-progress", null, 1, 1, 1], ["interrupted", null, 1, 1, 1], ["invalid", null, 1, 1, 1], ["io", null, 1, 1, 1], ["is-directory", null, 1, 1, 1], ["loop", null, 1, 1, 1], ["too-many-links", null, 1, 1, 1], ["message-size", null, 1, 1, 1], ["name-too-long", null, 1, 1, 1], ["no-device", null, 1, 1, 1], ["no-entry", null, 1, 1, 1], ["no-lock", null, 1, 1, 1], ["insufficient-memory", null, 1, 1, 1], ["insufficient-space", null, 1, 1, 1], ["not-directory", null, 1, 1, 1], ["not-empty", null, 1, 1, 1], ["not-recoverable", null, 1, 1, 1], ["unsupported", null, 1, 1, 1], ["no-tty", null, 1, 1, 1], ["no-such-device", null, 1, 1, 1], ["overflow", null, 1, 1, 1], ["not-permitted", null, 1, 1, 1], ["pipe", null, 1, 1, 1], ["read-only", null, 1, 1, 1], ["invalid-seek", null, 1, 1, 1], ["text-file-busy", null, 1, 1, 1], ["cross-device", null, 1, 1, 1]],
              variantSize32: 1,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 1
            }),
            104,
            8,
            8
          ]
        ],
        variantSize32: 104,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 13
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline15
  }
);
var trampoline16 = _trampoline16.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 16,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline16.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", _lowerFlatU64, 16, 8, 8],
          ["err", _lowerFlatVariant({
            caseMetas: [["last-operation-failed", _lowerFlatOwn({
              componentIdx: 0,
              tableIdx: 0,
              lowerFn: function lowerImportedOwnedHost_Error$1(obj) {
                if (!(obj instanceof Error$1)) {
                  throw new TypeError('Resource error: Not a valid "Error$1" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep2 = obj[symbolRscRep] || ++captureCnt0;
                  captureTable0.set(rep2, obj);
                  handle = rscTableCreateOwn(handleTable0, rep2);
                }
                return handle;
              }
            }), 4, 4, 1], ["closed", null, 0, 0, 0]],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2
          }), 16, 8, 8]
        ],
        variantSize32: 16,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline16
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 16,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline16.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", _lowerFlatU64, 16, 8, 8],
          ["err", _lowerFlatVariant({
            caseMetas: [["last-operation-failed", _lowerFlatOwn({
              componentIdx: 0,
              tableIdx: 0,
              lowerFn: function lowerImportedOwnedHost_Error$12(obj) {
                if (!(obj instanceof Error$1)) {
                  throw new TypeError('Resource error: Not a valid "Error$1" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep2 = obj[symbolRscRep] || ++captureCnt0;
                  captureTable0.set(rep2, obj);
                  handle = rscTableCreateOwn(handleTable0, rep2);
                }
                return handle;
              }
            }), 4, 4, 1], ["closed", null, 0, 0, 0]],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2
          }), 16, 8, 8]
        ],
        variantSize32: 16,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline16
  }
);
var trampoline17 = _trampoline17.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 17,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline17.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1), _liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array
    })],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", null, 12, 4, 4],
          ["err", _lowerFlatVariant({
            caseMetas: [["last-operation-failed", _lowerFlatOwn({
              componentIdx: 0,
              tableIdx: 0,
              lowerFn: function lowerImportedOwnedHost_Error$13(obj) {
                if (!(obj instanceof Error$1)) {
                  throw new TypeError('Resource error: Not a valid "Error$1" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep2 = obj[symbolRscRep] || ++captureCnt0;
                  captureTable0.set(rep2, obj);
                  handle = rscTableCreateOwn(handleTable0, rep2);
                }
                return handle;
              }
            }), 4, 4, 1], ["closed", null, 0, 0, 0]],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2
          }), 12, 4, 4]
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline17
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 17,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline17.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1), _liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array
    })],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", null, 12, 4, 4],
          ["err", _lowerFlatVariant({
            caseMetas: [["last-operation-failed", _lowerFlatOwn({
              componentIdx: 0,
              tableIdx: 0,
              lowerFn: function lowerImportedOwnedHost_Error$14(obj) {
                if (!(obj instanceof Error$1)) {
                  throw new TypeError('Resource error: Not a valid "Error$1" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep2 = obj[symbolRscRep] || ++captureCnt0;
                  captureTable0.set(rep2, obj);
                  handle = rscTableCreateOwn(handleTable0, rep2);
                }
                return handle;
              }
            }), 4, 4, 1], ["closed", null, 0, 0, 0]],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2
          }), 12, 4, 4]
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline17
  }
);
var trampoline18 = _trampoline18.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 18,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline18.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", null, 12, 4, 4],
          ["err", _lowerFlatVariant({
            caseMetas: [["last-operation-failed", _lowerFlatOwn({
              componentIdx: 0,
              tableIdx: 0,
              lowerFn: function lowerImportedOwnedHost_Error$15(obj) {
                if (!(obj instanceof Error$1)) {
                  throw new TypeError('Resource error: Not a valid "Error$1" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep2 = obj[symbolRscRep] || ++captureCnt0;
                  captureTable0.set(rep2, obj);
                  handle = rscTableCreateOwn(handleTable0, rep2);
                }
                return handle;
              }
            }), 4, 4, 1], ["closed", null, 0, 0, 0]],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2
          }), 12, 4, 4]
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline18
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 18,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline18.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1)],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", null, 12, 4, 4],
          ["err", _lowerFlatVariant({
            caseMetas: [["last-operation-failed", _lowerFlatOwn({
              componentIdx: 0,
              tableIdx: 0,
              lowerFn: function lowerImportedOwnedHost_Error$16(obj) {
                if (!(obj instanceof Error$1)) {
                  throw new TypeError('Resource error: Not a valid "Error$1" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep2 = obj[symbolRscRep] || ++captureCnt0;
                  captureTable0.set(rep2, obj);
                  handle = rscTableCreateOwn(handleTable0, rep2);
                }
                return handle;
              }
            }), 4, 4, 1], ["closed", null, 0, 0, 0]],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2
          }), 12, 4, 4]
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline18
  }
);
var trampoline19 = _trampoline19.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 19,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline19.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1), _liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array
    })],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", null, 12, 4, 4],
          ["err", _lowerFlatVariant({
            caseMetas: [["last-operation-failed", _lowerFlatOwn({
              componentIdx: 0,
              tableIdx: 0,
              lowerFn: function lowerImportedOwnedHost_Error$17(obj) {
                if (!(obj instanceof Error$1)) {
                  throw new TypeError('Resource error: Not a valid "Error$1" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep2 = obj[symbolRscRep] || ++captureCnt0;
                  captureTable0.set(rep2, obj);
                  handle = rscTableCreateOwn(handleTable0, rep2);
                }
                return handle;
              }
            }), 4, 4, 1], ["closed", null, 0, 0, 0]],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2
          }), 12, 4, 4]
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline19
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 19,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline19.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1), _liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array
    })],
    resultLowerFns: [
      _lowerFlatResult({
        caseMetas: [
          ["ok", null, 12, 4, 4],
          ["err", _lowerFlatVariant({
            caseMetas: [["last-operation-failed", _lowerFlatOwn({
              componentIdx: 0,
              tableIdx: 0,
              lowerFn: function lowerImportedOwnedHost_Error$18(obj) {
                if (!(obj instanceof Error$1)) {
                  throw new TypeError('Resource error: Not a valid "Error$1" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep2 = obj[symbolRscRep] || ++captureCnt0;
                  captureTable0.set(rep2, obj);
                  handle = rscTableCreateOwn(handleTable0, rep2);
                }
                return handle;
              }
            }), 4, 4, 1], ["closed", null, 0, 0, 0]],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2
          }), 12, 4, 4]
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3
      })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: void 0,
    importFn: _trampoline19
  }
);
var trampoline20 = _trampoline20.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 20,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline20.manuallyAsync,
    paramLiftFns: [_liftFlatU64],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatU8,
      elemSize32: 1,
      elemAlign32: 1
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline20
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 20,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline20.manuallyAsync,
    paramLiftFns: [_liftFlatU64],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatU8,
      elemSize32: 1,
      elemAlign32: 1
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline20
  }
);
var trampoline21 = _trampoline21.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 21,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline21.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatOwn({
        componentIdx: 0,
        tableIdx: 3,
        lowerFn: function lowerImportedOwnedHost_Descriptor(obj) {
          if (!(obj instanceof Descriptor3)) {
            throw new TypeError('Resource error: Not a valid "Descriptor" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep2 = obj[symbolRscRep] || ++captureCnt3;
            captureTable3.set(rep2, obj);
            handle = rscTableCreateOwn(handleTable3, rep2);
          }
          return handle;
        }
      }), 4, 4], [_lowerFlatStringAny, 8, 4]], size32: 12, align32: 4 }),
      elemSize32: 12,
      elemAlign32: 4
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline21
  }
))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 21,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline21.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatOwn({
        componentIdx: 0,
        tableIdx: 3,
        lowerFn: function lowerImportedOwnedHost_Descriptor2(obj) {
          if (!(obj instanceof Descriptor3)) {
            throw new TypeError('Resource error: Not a valid "Descriptor" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep2 = obj[symbolRscRep] || ++captureCnt3;
            captureTable3.set(rep2, obj);
            handle = rscTableCreateOwn(handleTable3, rep2);
          }
          return handle;
        }
      }), 4, 4], [_lowerFlatStringAny, 8, 4]], size32: 12, align32: 4 }),
      elemSize32: 12,
      elemAlign32: 4
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: "utf8",
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline21
  }
);
var $init = (() => {
  let gen = (function* _initGenerator() {
    const module0 = fetchCompile(new URL("./protocol.core.wasm", import.meta.url));
    const module1 = fetchCompile(new URL("./protocol.core2.wasm", import.meta.url));
    const module2 = base64Compile("AGFzbQEAAAABNQlgAn9/AX9gA39+fwF/YAR/f39/AX9gAX8AYAF/AGACf38AYAN/fn8AYAR/f39/AGACfn8AAxQTAAAAAQIDBAQFBgUFBQUHBQcIBAQFAXABExMHYRQBMAAAATEAAQEyAAIBMwADATQABAE1AAUBNgAGATcABwE4AAgBOQAJAjEwAAoCMTEACwIxMgAMAjEzAA0CMTQADgIxNQAPAjE2ABACMTcAEQIxOAASCCRpbXBvcnRzAQAK7QETCwAgACABQQARAAALCwAgACABQQERAAALCwAgACABQQIRAAALDQAgACABIAJBAxEBAAsPACAAIAEgAiADQQQRAgALCQAgAEEFEQMACwkAIABBBhEEAAsJACAAQQcRBAALCwAgACABQQgRBQALDQAgACABIAJBCREGAAsLACAAIAFBChEFAAsLACAAIAFBCxEFAAsLACAAIAFBDBEFAAsLACAAIAFBDREFAAsPACAAIAEgAiADQQ4RBwALCwAgACABQQ8RBQALDwAgACABIAIgA0EQEQcACwsAIAAgAUEREQgACwkAIABBEhEEAAsALwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQENd2l0LWNvbXBvbmVudAcwLjIyNy4xAM0IBG5hbWUAExJ3aXQtY29tcG9uZW50OnNoaW0BsAgTACdhZGFwdC13YXNpX3NuYXBzaG90X3ByZXZpZXcxLXJhbmRvbV9nZXQBKGFkYXB0LXdhc2lfc25hcHNob3RfcHJldmlldzEtZW52aXJvbl9nZXQCLmFkYXB0LXdhc2lfc25hcHNob3RfcHJldmlldzEtZW52aXJvbl9zaXplc19nZXQDK2FkYXB0LXdhc2lfc25hcHNob3RfcHJldmlldzEtY2xvY2tfdGltZV9nZXQEJWFkYXB0LXdhc2lfc25hcHNob3RfcHJldmlldzEtZmRfd3JpdGUFJmFkYXB0LXdhc2lfc25hcHNob3RfcHJldmlldzEtcHJvY19leGl0BjNpbmRpcmVjdC13YXNpOmNsaS9lbnZpcm9ubWVudEAwLjIuMy1nZXQtZW52aXJvbm1lbnQHKWluZGlyZWN0LXdhc2k6Y2xvY2tzL3dhbGwtY2xvY2tAMC4yLjMtbm93CDppbmRpcmVjdC13YXNpOmZpbGVzeXN0ZW0vdHlwZXNAMC4yLjMtZmlsZXN5c3RlbS1lcnJvci1jb2RlCUhpbmRpcmVjdC13YXNpOmZpbGVzeXN0ZW0vdHlwZXNAMC4yLjMtW21ldGhvZF1kZXNjcmlwdG9yLndyaXRlLXZpYS1zdHJlYW0KSWluZGlyZWN0LXdhc2k6ZmlsZXN5c3RlbS90eXBlc0AwLjIuMy1bbWV0aG9kXWRlc2NyaXB0b3IuYXBwZW5kLXZpYS1zdHJlYW0LQGluZGlyZWN0LXdhc2k6ZmlsZXN5c3RlbS90eXBlc0AwLjIuMy1bbWV0aG9kXWRlc2NyaXB0b3IuZ2V0LXR5cGUMPGluZGlyZWN0LXdhc2k6ZmlsZXN5c3RlbS90eXBlc0AwLjIuMy1bbWV0aG9kXWRlc2NyaXB0b3Iuc3RhdA1AaW5kaXJlY3Qtd2FzaTppby9zdHJlYW1zQDAuMi4zLVttZXRob2Rdb3V0cHV0LXN0cmVhbS5jaGVjay13cml0ZQ46aW5kaXJlY3Qtd2FzaTppby9zdHJlYW1zQDAuMi4zLVttZXRob2Rdb3V0cHV0LXN0cmVhbS53cml0ZQ9DaW5kaXJlY3Qtd2FzaTppby9zdHJlYW1zQDAuMi4zLVttZXRob2Rdb3V0cHV0LXN0cmVhbS5ibG9ja2luZy1mbHVzaBBNaW5kaXJlY3Qtd2FzaTppby9zdHJlYW1zQDAuMi4zLVttZXRob2Rdb3V0cHV0LXN0cmVhbS5ibG9ja2luZy13cml0ZS1hbmQtZmx1c2gRMmluZGlyZWN0LXdhc2k6cmFuZG9tL3JhbmRvbUAwLjIuMy1nZXQtcmFuZG9tLWJ5dGVzEjdpbmRpcmVjdC13YXNpOmZpbGVzeXN0ZW0vcHJlb3BlbnNAMC4yLjItZ2V0LWRpcmVjdG9yaWVz");
    const module3 = base64Compile("AGFzbQEAAAABNQlgAn9/AX9gA39+fwF/YAR/f39/AX9gAX8AYAF/AGACf38AYAN/fn8AYAR/f39/AGACfn8AAngUAAEwAAAAATEAAAABMgAAAAEzAAEAATQAAgABNQADAAE2AAQAATcABAABOAAFAAE5AAYAAjEwAAUAAjExAAUAAjEyAAUAAjEzAAUAAjE0AAcAAjE1AAUAAjE2AAcAAjE3AAgAAjE4AAQACCRpbXBvcnRzAXABExMJGQEAQQALEwABAgMEBQYHCAkKCwwNDg8QERIALwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQENd2l0LWNvbXBvbmVudAcwLjIyNy4xABwEbmFtZQAVFHdpdC1jb21wb25lbnQ6Zml4dXBz");
    const instanceFlags0 = new WebAssembly.Global({ value: "i32", mutable: true }, 1);
    INSTANCE_FLAGS.set(0, instanceFlags0);
    ({ exports: exports0 } = yield instantiateCore(yield module2));
    ({ exports: exports1 } = yield instantiateCore(yield module0, {
      wasi_snapshot_preview1: {
        clock_time_get: Object.assign(exports0["3"], { _jcoMaySuspend: false }),
        environ_get: Object.assign(exports0["1"], { _jcoMaySuspend: false }),
        environ_sizes_get: Object.assign(exports0["2"], { _jcoMaySuspend: false }),
        fd_write: Object.assign(exports0["4"], { _jcoMaySuspend: false }),
        proc_exit: Object.assign(exports0["5"], { _jcoMaySuspend: false }),
        random_get: Object.assign(exports0["0"], { _jcoMaySuspend: false })
      }
    }));
    ({ exports: exports2 } = yield instantiateCore(yield module1, {
      __main_module__: {
        cabi_realloc: Object.assign(exports1.cabi_realloc, { _jcoMaySuspend: false })
      },
      env: {
        memory: exports1.memory
      },
      "wasi:cli/environment@0.2.3": {
        "get-environment": Object.assign(exports0["6"], { _jcoMaySuspend: false })
      },
      "wasi:cli/exit@0.2.3": {
        exit: Object.assign(trampoline8, { _jcoMaySuspend: false })
      },
      "wasi:cli/stderr@0.2.3": {
        "get-stderr": Object.assign(trampoline5, { _jcoMaySuspend: false })
      },
      "wasi:cli/stdin@0.2.3": {
        "get-stdin": Object.assign(trampoline6, { _jcoMaySuspend: false })
      },
      "wasi:cli/stdout@0.2.3": {
        "get-stdout": Object.assign(trampoline7, { _jcoMaySuspend: false })
      },
      "wasi:clocks/monotonic-clock@0.2.3": {
        now: Object.assign(trampoline0, { _jcoMaySuspend: false })
      },
      "wasi:clocks/wall-clock@0.2.3": {
        now: Object.assign(exports0["7"], { _jcoMaySuspend: false })
      },
      "wasi:filesystem/preopens@0.2.2": {
        "get-directories": Object.assign(exports0["18"], { _jcoMaySuspend: false })
      },
      "wasi:filesystem/types@0.2.3": {
        "[method]descriptor.append-via-stream": Object.assign(exports0["10"], { _jcoMaySuspend: false }),
        "[method]descriptor.get-type": Object.assign(exports0["11"], { _jcoMaySuspend: false }),
        "[method]descriptor.stat": Object.assign(exports0["12"], { _jcoMaySuspend: false }),
        "[method]descriptor.write-via-stream": Object.assign(exports0["9"], { _jcoMaySuspend: false }),
        "[resource-drop]descriptor": Object.assign(_guardMayLeave(0, trampoline1), { _jcoMaySuspend: false }),
        "filesystem-error-code": Object.assign(exports0["8"], { _jcoMaySuspend: false })
      },
      "wasi:io/error@0.2.3": {
        "[resource-drop]error": Object.assign(_guardMayLeave(0, trampoline3), { _jcoMaySuspend: false })
      },
      "wasi:io/streams@0.2.3": {
        "[method]output-stream.blocking-flush": Object.assign(exports0["15"], { _jcoMaySuspend: false }),
        "[method]output-stream.blocking-write-and-flush": Object.assign(exports0["16"], { _jcoMaySuspend: false }),
        "[method]output-stream.check-write": Object.assign(exports0["13"], { _jcoMaySuspend: false }),
        "[method]output-stream.write": Object.assign(exports0["14"], { _jcoMaySuspend: false }),
        "[resource-drop]input-stream": Object.assign(_guardMayLeave(0, trampoline4), { _jcoMaySuspend: false }),
        "[resource-drop]output-stream": Object.assign(_guardMayLeave(0, trampoline2), { _jcoMaySuspend: false })
      },
      "wasi:random/random@0.2.3": {
        "get-random-bytes": Object.assign(exports0["17"], { _jcoMaySuspend: false })
      }
    }));
    memory0 = exports1.memory;
    realloc0 = exports2.cabi_import_realloc;
    try {
      realloc0Async = WebAssembly.promising(exports2.cabi_import_realloc);
    } catch (err) {
      realloc0Async = exports2.cabi_import_realloc;
    }
    ({ exports: exports3 } = yield instantiateCore(yield module3, {
      "": {
        $imports: exports0.$imports,
        "0": Object.assign(exports2.random_get, { _jcoMaySuspend: false }),
        "1": Object.assign(exports2.environ_get, { _jcoMaySuspend: false }),
        "10": Object.assign(trampoline13, { _jcoMaySuspend: false }),
        "11": Object.assign(trampoline14, { _jcoMaySuspend: false }),
        "12": Object.assign(trampoline15, { _jcoMaySuspend: false }),
        "13": Object.assign(trampoline16, { _jcoMaySuspend: false }),
        "14": Object.assign(trampoline17, { _jcoMaySuspend: false }),
        "15": Object.assign(trampoline18, { _jcoMaySuspend: false }),
        "16": Object.assign(trampoline19, { _jcoMaySuspend: false }),
        "17": Object.assign(trampoline20, { _jcoMaySuspend: false }),
        "18": Object.assign(trampoline21, { _jcoMaySuspend: false }),
        "2": Object.assign(exports2.environ_sizes_get, { _jcoMaySuspend: false }),
        "3": Object.assign(exports2.clock_time_get, { _jcoMaySuspend: false }),
        "4": Object.assign(exports2.fd_write, { _jcoMaySuspend: false }),
        "5": Object.assign(exports2.proc_exit, { _jcoMaySuspend: false }),
        "6": Object.assign(trampoline9, { _jcoMaySuspend: false }),
        "7": Object.assign(trampoline10, { _jcoMaySuspend: false }),
        "8": Object.assign(trampoline11, { _jcoMaySuspend: false }),
        "9": Object.assign(trampoline12, { _jcoMaySuspend: false })
      }
    }));
    realloc1 = exports1.cabi_realloc;
    try {
      realloc1Async = WebAssembly.promising(exports1.cabi_realloc);
    } catch (err) {
      realloc1Async = exports1.cabi_realloc;
    }
    postReturn0 = exports1["cabi_post_snows:qr-data-transport/protocol#encode-bytes"];
    try {
      postReturn0Async = WebAssembly.promising(exports1["cabi_post_snows:qr-data-transport/protocol#encode-bytes"]);
    } catch (err) {
      postReturn0Async = exports1["cabi_post_snows:qr-data-transport/protocol#encode-bytes"];
    }
    postReturn1 = exports1["cabi_post_snows:qr-data-transport/protocol#parse-frame"];
    try {
      postReturn1Async = WebAssembly.promising(exports1["cabi_post_snows:qr-data-transport/protocol#parse-frame"]);
    } catch (err) {
      postReturn1Async = exports1["cabi_post_snows:qr-data-transport/protocol#parse-frame"];
    }
    postReturn2 = exports1["cabi_post_snows:qr-data-transport/protocol#decode-frames"];
    try {
      postReturn2Async = WebAssembly.promising(exports1["cabi_post_snows:qr-data-transport/protocol#decode-frames"]);
    } catch (err) {
      postReturn2Async = exports1["cabi_post_snows:qr-data-transport/protocol#decode-frames"];
    }
    postReturn3 = exports1["cabi_post_snows:qr-data-transport/protocol#generate-qr-matrix"];
    try {
      postReturn3Async = WebAssembly.promising(exports1["cabi_post_snows:qr-data-transport/protocol#generate-qr-matrix"]);
    } catch (err) {
      postReturn3Async = exports1["cabi_post_snows:qr-data-transport/protocol#generate-qr-matrix"];
    }
    postReturn4 = exports1["cabi_post_snows:qr-data-transport/protocol#decode-qr-image"];
    try {
      postReturn4Async = WebAssembly.promising(exports1["cabi_post_snows:qr-data-transport/protocol#decode-qr-image"]);
    } catch (err) {
      postReturn4Async = exports1["cabi_post_snows:qr-data-transport/protocol#decode-qr-image"];
    }
    protocolEncodeBytes = exports1["snows:qr-data-transport/protocol#encode-bytes"];
    protocolEncodeText = exports1["snows:qr-data-transport/protocol#encode-text"];
    protocolParseFrame = exports1["snows:qr-data-transport/protocol#parse-frame"];
    protocolDecodeFrames = exports1["snows:qr-data-transport/protocol#decode-frames"];
    protocolGenerateQrMatrix = exports1["snows:qr-data-transport/protocol#generate-qr-matrix"];
    protocolDecodeQrImage = exports1["snows:qr-data-transport/protocol#decode-qr-image"];
  })();
  let promise, resolve, reject;
  function normalizeInstantiationError(e) {
    if (typeof WebAssembly.SuspendError === "function" && e instanceof WebAssembly.SuspendError) {
      return new WebAssembly.RuntimeError("cannot block a synchronous task before returning");
    }
    return e;
  }
  function runNext(value) {
    try {
      let done;
      do {
        ({ value, done } = gen.next(value));
      } while (!(value instanceof Promise) && !done);
      if (done) {
        if (resolve) resolve(value);
        else return value;
      }
      if (!promise) promise = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
      value.then(runNext, (e) => reject(normalizeInstantiationError(e)));
    } catch (e) {
      e = normalizeInstantiationError(e);
      if (reject) reject(e);
      else throw e;
    }
  }
  const maybeSyncReturn = runNext(null);
  return promise || maybeSyncReturn;
})();
await $init;
var protocol = {
  decodeFrames,
  decodeQrImage,
  encodeBytes,
  encodeText,
  generateQrMatrix,
  parseFrame
};

// src/api/browserRuntimeApi.ts
var BrowserRuntimeApi = class {
  cameraStream = null;
  cameraVideo = null;
  cameraAnimationId = null;
  resolveCanvas(canvasTarget) {
    if (typeof document === "undefined") {
      return null;
    }
    if (!canvasTarget) {
      return document.querySelector("canvas");
    }
    if (typeof canvasTarget === "string") {
      const el = document.getElementById(canvasTarget);
      if (el && el instanceof HTMLCanvasElement) {
        return el;
      }
      return document.querySelector(canvasTarget);
    }
    if (canvasTarget instanceof HTMLCanvasElement) {
      return canvasTarget;
    }
    return null;
  }
  renderQrModuleMatrix(matrix, options) {
    const canvas = this.resolveCanvas(options?.canvas);
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const canvasWidth = options?.width ?? canvas.width ?? 300;
    const canvasHeight = options?.height ?? canvas.height ?? 300;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const { width, height, modules } = matrix;
    if (width <= 0 || height <= 0 || modules.length < width * height) {
      return;
    }
    const darkColor = options?.darkColor ?? "#000000";
    const lightColor = options?.lightColor ?? "#FFFFFF";
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.imageSmoothingEnabled = false;
    if ("mozImageSmoothingEnabled" in ctx) ctx.mozImageSmoothingEnabled = false;
    if ("webkitImageSmoothingEnabled" in ctx) ctx.webkitImageSmoothingEnabled = false;
    ctx.fillStyle = darkColor;
    for (let y = 0; y < height; y++) {
      const startY = Math.round(y * canvasHeight / height);
      const endY = Math.round((y + 1) * canvasHeight / height);
      const h = endY - startY;
      for (let x = 0; x < width; x++) {
        if (modules[y * width + x] === 1) {
          const startX = Math.round(x * canvasWidth / width);
          const endX = Math.round((x + 1) * canvasWidth / width);
          const w = endX - startX;
          ctx.fillRect(startX, startY, w, h);
        }
      }
    }
  }
  clearCanvas(canvasTarget) {
    const canvas = this.resolveCanvas(canvasTarget);
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  async getAvailableVideoDevices() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "videoinput");
  }
  async startCamera(onFrame, options) {
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API (navigator.mediaDevices.getUserMedia) is not available in this environment");
    }
    this.stopCamera();
    const facingMode = options?.facingMode ?? "environment";
    const videoConstraints = {
      width: options?.width ? { ideal: options.width } : void 0,
      height: options?.height ? { ideal: options.height } : void 0
    };
    if (options?.deviceId) {
      videoConstraints.deviceId = { exact: options.deviceId };
    } else if (facingMode) {
      videoConstraints.facingMode = { ideal: facingMode };
    }
    const constraints = {
      video: videoConstraints
    };
    this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (options?.isManual ?? true) {
      const track = this.cameraStream.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({
            focusMode: { ideal: "manual" },
            exposureMode: { ideal: "manual" },
            whiteBalanceMode: { ideal: "manual" }
          });
        } catch {
        }
      }
    }
    this.cameraVideo = document.createElement("video");
    this.cameraVideo.srcObject = this.cameraStream;
    this.cameraVideo.setAttribute("playsinline", "true");
    await this.cameraVideo.play();
    const offscreenCanvas = document.createElement("canvas");
    const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
    const fps = options?.fps && options.fps > 0 ? options.fps : 30;
    const intervalMs = 1e3 / fps;
    let lastFrameTime = 0;
    const captureLoop = (now2) => {
      if (!this.cameraVideo || !this.cameraStream) {
        return;
      }
      if (now2 - lastFrameTime >= intervalMs) {
        lastFrameTime = now2;
        const vWidth = this.cameraVideo.videoWidth;
        const vHeight = this.cameraVideo.videoHeight;
        if (vWidth > 0 && vHeight > 0 && offscreenCtx) {
          offscreenCanvas.width = vWidth;
          offscreenCanvas.height = vHeight;
          offscreenCtx.drawImage(this.cameraVideo, 0, 0, vWidth, vHeight);
          const imgData = offscreenCtx.getImageData(0, 0, vWidth, vHeight);
          if (options?.previewCanvas) {
            const pCanvas = this.resolveCanvas(options.previewCanvas);
            if (pCanvas) {
              const pCtx = pCanvas.getContext("2d");
              if (pCtx) {
                if (pCanvas.width !== vWidth) pCanvas.width = vWidth;
                if (pCanvas.height !== vHeight) pCanvas.height = vHeight;
                pCtx.drawImage(this.cameraVideo, 0, 0, vWidth, vHeight);
                if (options.drawOverlay) {
                  options.drawOverlay(pCtx, vWidth, vHeight);
                }
              }
            }
          }
          onFrame(new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength), vWidth, vHeight);
        }
      }
      this.cameraAnimationId = requestAnimationFrame(captureLoop);
    };
    this.cameraAnimationId = requestAnimationFrame(captureLoop);
  }
  stopCamera() {
    if (this.cameraAnimationId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.cameraAnimationId);
      this.cameraAnimationId = null;
    }
    if (this.cameraStream) {
      for (const track of this.cameraStream.getTracks()) {
        track.stop();
      }
      this.cameraStream = null;
    }
    if (this.cameraVideo) {
      this.cameraVideo.pause();
      this.cameraVideo.srcObject = null;
      this.cameraVideo = null;
    }
  }
  isWorkerSupported() {
    return typeof Worker !== "undefined";
  }
};

// src/utils/qrCapacity.ts
var ECC_CODEWORDS_PER_BLOCK = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];
var NUM_ERROR_CORRECTION_BLOCKS = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];
function calculateMaxFrameBits(qrVersion, ecLevel) {
  if (qrVersion < 1 || qrVersion > 40) {
    throw new Error("qrVersion must be between 1 and 40");
  }
  const version = Math.floor(qrVersion);
  let rawDataModules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    rawDataModules -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) {
      rawDataModules -= 36;
    }
  }
  let ecIndex = 1;
  switch (ecLevel) {
    case "l":
      ecIndex = 0;
      break;
    case "m":
      ecIndex = 1;
      break;
    case "q":
      ecIndex = 2;
      break;
    case "h":
      ecIndex = 3;
      break;
  }
  const rawCodewords = Math.floor(rawDataModules / 8);
  const eccCodewords = ECC_CODEWORDS_PER_BLOCK[ecIndex][version];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecIndex][version];
  const dataCodewords = rawCodewords - eccCodewords * numBlocks;
  const totalDataBits = dataCodewords * 8;
  const segmentHeaderBits = version < 10 ? 12 : 20;
  return Math.max(1, totalDataBits - segmentHeaderBits);
}

// src/api/dataApi.ts
function ensureSharedUint8Array(arr) {
  if (!arr) {
    return new Uint8Array(0);
  }
  if (arr.byteOffset === 0 && arr.byteLength === arr.buffer.byteLength) {
    return arr;
  }
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
var DataApi = class {
  /**
   * Encodes raw bytes into wire frames using WASM protocol core.
   * Automatically calculates maxFrameBits from qrVersion and ecLevel if qrVersion <= 40.
   */
  static encodeBytes(data, qrVersion = 5, ecLevel = "m", parityMode = 0) {
    const bytes = ensureSharedUint8Array(data);
    const maxFrameBits = qrVersion > 40 ? qrVersion : calculateMaxFrameBits(qrVersion, ecLevel);
    return protocol.encodeBytes(bytes, maxFrameBits, parityMode);
  }
  /**
   * Encodes text into wire frames using WASM protocol core.
   * Automatically calculates maxFrameBits from qrVersion and ecLevel if qrVersion <= 40.
   */
  static encodeText(text, qrVersion = 5, ecLevel = "m", parityMode = 0) {
    const maxFrameBits = qrVersion > 40 ? qrVersion : calculateMaxFrameBits(qrVersion, ecLevel);
    return protocol.encodeText(text, maxFrameBits, parityMode);
  }
  /**
   * Parses a single wire frame and verifies its CRC.
   */
  static parseFrame(wireBytes, knownTotalQrCount, knownFirstFrameCrc, knownParityMode) {
    const bytes = ensureSharedUint8Array(wireBytes);
    return protocol.parseFrame(bytes, knownTotalQrCount, knownFirstFrameCrc, knownParityMode);
  }
  /**
   * Decodes a complete list of wire frames and returns the payload along with its type.
   * Returns { type: "Uint8Array" | "string", data: Uint8Array | string } according to Spec v8.
   */
  static decodeFrames(wireFrames) {
    const sharedFrames = wireFrames.map(ensureSharedUint8Array);
    const decoded = protocol.decodeFrames(sharedFrames);
    if (decoded.tag === "bytes") {
      return {
        type: "Uint8Array",
        data: decoded.val
      };
    }
    if (decoded.tag === "text") {
      return {
        type: "string",
        data: decoded.val
      };
    }
    throw new Error("Unknown decoded payload tag");
  }
  /**
   * Generates a binary QR module matrix using qrcodegen via WASM.
   */
  static generateQrMatrix(wireBytes, qrVersion, ecLevel) {
    const bytes = ensureSharedUint8Array(wireBytes);
    return protocol.generateQrMatrix(bytes, qrVersion, ecLevel);
  }
  /**
   * Decodes QR code image pixels (RGBA) to wire bytes using rxing via WASM.
   */
  static decodeQrImage(rgbaPixels, width, height) {
    const pixels = ensureSharedUint8Array(rgbaPixels);
    return protocol.decodeQrImage(pixels, width, height);
  }
};

// src/config/index.ts
var TransportConfig = class _TransportConfig {
  /**
   * Maximum consecutive CRC errors before declaring a critical error.
   * Default: 16.
   * 0 means unlimited (disabled threshold).
   * Values < 0 are invalid.
   */
  maxConsecutiveCrcErrors;
  /**
   * Maximum number of pending frame byte arrays saved before receiving First QR.
   * Default: 256.
   */
  maxPendingFramesBeforeFirst;
  /**
   * Whether to use a Worker thread if available.
   * Default: true.
   */
  useWorker;
  /**
   * Frame transmission interval in milliseconds for send mode.
   * Default: 100ms.
   */
  intervalMs;
  constructor(options) {
    const crcMax = options?.maxConsecutiveCrcErrors ?? 16;
    if (crcMax < 0) {
      throw new Error("maxConsecutiveCrcErrors must be non-negative");
    }
    this.maxConsecutiveCrcErrors = crcMax;
    const pendingMax = options?.maxPendingFramesBeforeFirst ?? 256;
    if (pendingMax < 0) {
      throw new Error("maxPendingFramesBeforeFirst must be non-negative");
    }
    this.maxPendingFramesBeforeFirst = pendingMax;
    this.useWorker = options?.useWorker ?? true;
    this.intervalMs = options?.intervalMs ?? 100;
  }
  clone() {
    return new _TransportConfig({
      maxConsecutiveCrcErrors: this.maxConsecutiveCrcErrors,
      maxPendingFramesBeforeFirst: this.maxPendingFramesBeforeFirst,
      useWorker: this.useWorker,
      intervalMs: this.intervalMs
    });
  }
};
var DataConfig = class _DataConfig {
  /**
   * QR Code Version (1 ~ 40).
   * Default: 5.
   */
  qrVersion;
  /**
   * QR Code Error Correction Level ('l', 'm', 'q', 'h').
   * Default: 'm'.
   */
  ecLevel;
  /**
   * Parity Mode (0, 8, 16, 32).
   * Default: ParityMode.None (0).
   */
  parityMode;
  constructor(options) {
    const ver = options?.qrVersion ?? 5;
    if (ver < 1 || ver > 40) {
      throw new Error("qrVersion must be between 1 and 40");
    }
    this.qrVersion = ver;
    const ec = options?.ecLevel ?? "m";
    if (!["l", "m", "q", "h"].includes(ec)) {
      throw new Error("ecLevel must be one of 'l', 'm', 'q', 'h'");
    }
    this.ecLevel = ec;
    const pm = options?.parityMode ?? 0 /* None */;
    if (![0, 8, 16, 32].includes(pm)) {
      throw new Error("parityMode must be 0, 8, 16, or 32");
    }
    this.parityMode = pm;
  }
  /**
   * Maximum total bits per wire frame calculated automatically from qrVersion and ecLevel.
   */
  get maxFrameBits() {
    return calculateMaxFrameBits(this.qrVersion, this.ecLevel);
  }
  clone() {
    return new _DataConfig({
      qrVersion: this.qrVersion,
      ecLevel: this.ecLevel,
      parityMode: this.parityMode
    });
  }
};
var BrowserRuntimeConfig = class _BrowserRuntimeConfig {
  renderFps;
  cameraFps;
  decodeFrequency;
  qrWidth;
  qrHeight;
  canvasWidth;
  canvasHeight;
  facingMode;
  deviceId;
  constructor(options) {
    this.renderFps = options?.renderFps ?? 10;
    this.cameraFps = options?.cameraFps ?? 30;
    this.decodeFrequency = options?.decodeFrequency ?? 10;
    this.qrWidth = options?.qrWidth ?? 300;
    this.qrHeight = options?.qrHeight ?? 300;
    this.canvasWidth = options?.canvasWidth ?? 300;
    this.canvasHeight = options?.canvasHeight ?? 300;
    this.facingMode = options?.facingMode ?? "environment";
    this.deviceId = options?.deviceId;
  }
  clone() {
    return new _BrowserRuntimeConfig({
      renderFps: this.renderFps,
      cameraFps: this.cameraFps,
      decodeFrequency: this.decodeFrequency,
      qrWidth: this.qrWidth,
      qrHeight: this.qrHeight,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      facingMode: this.facingMode,
      deviceId: this.deviceId
    });
  }
};
var AppConfig = class _AppConfig {
  transport;
  data;
  browserRuntime;
  constructor(options) {
    this.transport = new TransportConfig(options?.transport);
    this.data = new DataConfig(options?.data);
    this.browserRuntime = new BrowserRuntimeConfig(options?.browserRuntime);
  }
  clone() {
    return new _AppConfig({
      transport: this.transport.clone(),
      data: this.data.clone(),
      browserRuntime: this.browserRuntime.clone()
    });
  }
};

// src/api/transportApi.ts
var TransportApi = class {
  state = "Idle";
  config;
  runtime;
  // Callbacks
  warningCallbacks = [];
  errorCallbacks = [];
  completeCallbacks = [];
  frameProcessedCallbacks = [];
  sendProgressCallbacks = [];
  // Sender state
  sendTimer = null;
  sendWireFrames = [];
  sendFrameIndex = 0;
  sendCanvasTarget;
  // Receiver state
  pendingPreFirstFrames = [];
  storedFrames = /* @__PURE__ */ new Map();
  knownTotalQrCount;
  knownFirstFrameCrc;
  consecutiveCrcErrors = 0;
  receiveStartTime = null;
  totalReceivedWireBits = 0;
  lastQrDetected = false;
  constructor(config, runtime) {
    this.config = config ? config.clone() : new AppConfig();
    this.runtime = runtime;
  }
  setRuntime(runtime) {
    this.runtime = runtime;
  }
  getConfig() {
    return this.config;
  }
  getState() {
    return this.state;
  }
  onWarning(callback) {
    this.warningCallbacks.push(callback);
  }
  onError(callback) {
    this.errorCallbacks.push(callback);
  }
  onComplete(callback) {
    this.completeCallbacks.push(callback);
  }
  onSendProgress(callback) {
    this.sendProgressCallbacks.push(callback);
  }
  onFrameProcessed(callback) {
    this.frameProcessedCallbacks.push(callback);
    callback(this.buildFrameProcessedEvent());
  }
  buildFrameProcessedEvent() {
    let bps = 0;
    if (this.receiveStartTime !== null) {
      const elapsedSec = (performance.now() - this.receiveStartTime) / 1e3;
      if (elapsedSec > 0) {
        bps = Math.round(this.totalReceivedWireBits / elapsedSec);
      }
    }
    return {
      validCount: this.storedFrames.size,
      pendingCount: this.pendingPreFirstFrames.length,
      totalCount: this.knownTotalQrCount ?? -1,
      isQrDetected: this.lastQrDetected,
      bps
    };
  }
  emitFrameProcessed() {
    const event = this.buildFrameProcessedEvent();
    for (const cb of this.frameProcessedCallbacks) {
      cb(event);
    }
  }
  emitSendProgress() {
    if (this.sendWireFrames.length === 0) return;
    const event = {
      index: this.sendFrameIndex + 1,
      // 1-based indexing for external users
      maxIndex: this.sendWireFrames.length
    };
    for (const cb of this.sendProgressCallbacks) {
      cb(event);
    }
  }
  emitWarning(warning) {
    for (const cb of this.warningCallbacks) {
      cb(warning);
    }
  }
  emitError(error2) {
    if (error2.critical) {
      this.state = "Error";
      this.resetReceiverState();
      this.resetSenderState();
    }
    for (const cb of this.errorCallbacks) {
      cb(error2);
    }
  }
  emitComplete(result) {
    this.state = "Completed";
    if (this.runtime) {
      this.runtime.stopCamera();
    }
    for (const cb of this.completeCallbacks) {
      cb(result);
    }
  }
  // ------------------------------------------------------------------
  // Sender Implementation
  // ------------------------------------------------------------------
  async startSend(data, options) {
    if (this.sendTimer !== null) {
      return;
    }
    if (options) {
      if (options.qrVersion !== void 0) {
        this.config.data.qrVersion = options.qrVersion;
      }
      if (options.ecLevel !== void 0) {
        this.config.data.ecLevel = options.ecLevel;
      }
      if (options.intervalMs !== void 0) {
        this.config.transport.intervalMs = options.intervalMs;
      }
      if (options.parityMode !== void 0) {
        this.config.data.parityMode = options.parityMode;
      }
      if (options.canvas !== void 0) {
        this.sendCanvasTarget = options.canvas;
      }
    }
    let encodedResult;
    try {
      if (typeof data === "string") {
        encodedResult = DataApi.encodeText(data, this.config.data.qrVersion, this.config.data.ecLevel, this.config.data.parityMode);
      } else {
        encodedResult = DataApi.encodeBytes(data, this.config.data.qrVersion, this.config.data.ecLevel, this.config.data.parityMode);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.emitError({
        code: errMsg.includes("ASCII") ? "ASCII_OUT_OF_RANGE" : "SYNTAX_ERROR",
        message: `Encoding error: ${errMsg}`,
        critical: true,
        details: err
      });
      return;
    }
    this.sendWireFrames = encodedResult.frames.map((f) => new Uint8Array(f.wireBytes));
    if (this.sendWireFrames.length === 0) {
      this.emitError({
        code: "SYNTAX_ERROR",
        message: "No frames generated from payload",
        critical: true
      });
      return;
    }
    this.sendFrameIndex = 0;
    const interval = this.config.transport.intervalMs;
    const renderCurrentFrame = () => {
      const currentFrame = this.getCurrentSendFrame();
      if (currentFrame && this.runtime) {
        try {
          const matrix = DataApi.generateQrMatrix(currentFrame, this.config.data.qrVersion, this.config.data.ecLevel);
          this.runtime.renderQrModuleMatrix(matrix, {
            canvas: this.sendCanvasTarget,
            width: this.config.browserRuntime.canvasWidth,
            height: this.config.browserRuntime.canvasHeight,
            ...options?.renderOptions
          });
        } catch {
        }
      }
    };
    renderCurrentFrame();
    this.emitSendProgress();
    this.sendTimer = setInterval(() => {
      if (this.sendWireFrames.length === 0) return;
      this.sendFrameIndex = (this.sendFrameIndex + 1) % this.sendWireFrames.length;
      renderCurrentFrame();
      this.emitSendProgress();
    }, interval);
  }
  getCurrentSendFrame() {
    if (this.sendWireFrames.length === 0) return null;
    return this.sendWireFrames[this.sendFrameIndex];
  }
  stopSend() {
    this.resetSenderState();
  }
  resetSenderState() {
    if (this.sendTimer !== null) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
    if (this.runtime) {
      this.runtime.clearCanvas(this.sendCanvasTarget);
    }
    this.sendWireFrames = [];
    this.sendFrameIndex = 0;
    this.sendCanvasTarget = void 0;
  }
  // ------------------------------------------------------------------
  // Receiver Implementation
  // ------------------------------------------------------------------
  async startReceive(options) {
    if (this.state !== "Idle" && this.state !== "Completed" && this.state !== "Error") {
      return;
    }
    if (options) {
      if (options.maxConsecutiveCrcErrors !== void 0) {
        this.config.transport.maxConsecutiveCrcErrors = options.maxConsecutiveCrcErrors;
      }
      if (options.maxPendingFramesBeforeFirst !== void 0) {
        this.config.transport.maxPendingFramesBeforeFirst = options.maxPendingFramesBeforeFirst;
      }
      if (options.useWorker !== void 0) {
        this.config.transport.useWorker = options.useWorker;
      }
    }
    this.resetReceiverState();
    this.receiveStartTime = performance.now();
    this.state = "WaitingForFirst";
    this.emitFrameProcessed();
  }
  stopReceive() {
    if (this.runtime) {
      this.runtime.stopCamera();
    }
    this.resetReceiverState();
    this.state = "Idle";
  }
  resetReceiverState() {
    this.pendingPreFirstFrames = [];
    this.storedFrames.clear();
    this.knownTotalQrCount = void 0;
    this.knownFirstFrameCrc = void 0;
    this.consecutiveCrcErrors = 0;
    this.receiveStartTime = null;
    this.totalReceivedWireBits = 0;
    this.lastQrDetected = false;
    this.emitFrameProcessed();
  }
  getPendingPreFirstQueueLength() {
    return this.pendingPreFirstFrames.length;
  }
  /**
   * Process an incoming raw wire frame array.
   */
  processFrame(wireBytes) {
    if (this.state === "Idle" || this.state === "Completed" || this.state === "Error") {
      this.lastQrDetected = false;
      return;
    }
    if (!wireBytes || wireBytes.length === 0) {
      this.lastQrDetected = false;
      this.emitFrameProcessed();
      return;
    }
    this.lastQrDetected = true;
    try {
      const isStartBitSet = (wireBytes[0] & 128) !== 0;
      if (this.state === "WaitingForFirst") {
        if (!isStartBitSet) {
          if (this.pendingPreFirstFrames.length < this.config.transport.maxPendingFramesBeforeFirst) {
            const isDuplicate = this.pendingPreFirstFrames.some((b) => b.length === wireBytes.length && b.every((val, idx) => val === wireBytes[idx]));
            if (!isDuplicate) {
              this.pendingPreFirstFrames.push(wireBytes);
            }
          }
          return;
        }
      }
      let metadata2;
      try {
        metadata2 = DataApi.parseFrame(wireBytes, this.knownTotalQrCount, this.knownFirstFrameCrc);
      } catch (err) {
        this.emitError({
          code: "SYNTAX_ERROR",
          message: `Syntax error during frame parsing: ${String(err)}`,
          critical: false
        });
        return;
      }
      if (this.knownTotalQrCount !== void 0 && metadata2.frameNumber >= this.knownTotalQrCount) {
        return;
      }
      if (metadata2.isFirst) {
        if (metadata2.version === 0) {
          this.emitError({
            code: "INVALID_VERSION",
            message: "Library Format Version 0 is invalid",
            critical: true
          });
          return;
        }
        if (metadata2.version > 1) {
          this.emitWarning({
            code: "UNKNOWN_VERSION_CONTINUED",
            message: `Unknown library format version ${metadata2.version}, continuing processing`,
            details: { version: metadata2.version }
          });
        }
      }
      if (this.state === "WaitingForFirst") {
        if (metadata2.isFirst) {
          if (metadata2.crcValid) {
            this.establishFirstQr(wireBytes, metadata2);
            this.processPendingQueue();
          } else {
            this.handleCrcError();
          }
        }
        return;
      }
      this.processPostFirstFrame(wireBytes, metadata2);
    } finally {
      this.emitFrameProcessed();
    }
  }
  establishFirstQr(wireBytes, metadata2) {
    this.knownTotalQrCount = metadata2.totalQrCount;
    this.knownFirstFrameCrc = metadata2.frameCrc;
    this.storedFrames.set(0, wireBytes);
    this.totalReceivedWireBits += wireBytes.length * 8;
    this.state = metadata2.totalQrCount === 1 ? "OverallCrcVerification" : "FirstEstablished";
    if (metadata2.totalQrCount === 1) {
      this.checkCompletion();
    }
  }
  removeSupersededPendingFrames(frameNumber) {
    if (this.pendingPreFirstFrames.length === 0) return;
    this.pendingPreFirstFrames = this.pendingPreFirstFrames.filter((wire) => {
      try {
        const meta = DataApi.parseFrame(wire, this.knownTotalQrCount, this.knownFirstFrameCrc);
        return meta.frameNumber !== frameNumber;
      } catch {
        return false;
      }
    });
  }
  processPostFirstFrame(wireBytes, metadata2) {
    if (!metadata2.crcValid) {
      this.handleCrcError();
      return;
    }
    this.consecutiveCrcErrors = 0;
    this.removeSupersededPendingFrames(metadata2.frameNumber);
    const existingWire = this.storedFrames.get(metadata2.frameNumber);
    if (existingWire) {
      let existingMeta;
      try {
        existingMeta = DataApi.parseFrame(existingWire, this.knownTotalQrCount, this.knownFirstFrameCrc);
      } catch {
      }
      if (metadata2.frameNumber === 0 && metadata2.frameCrc !== this.knownFirstFrameCrc) {
        for (const key of Array.from(this.storedFrames.keys())) {
          if (key !== 0) {
            this.storedFrames.delete(key);
          }
        }
        this.knownFirstFrameCrc = metadata2.frameCrc;
        this.knownTotalQrCount = metadata2.totalQrCount;
        this.storedFrames.set(0, wireBytes);
        this.emitWarning({
          code: "POST_FIRST_FRAMES_DISCARDED",
          message: "First Frame CRC changed. Discarded subsequent stored frames."
        });
        this.checkCompletion();
        return;
      }
      if (existingMeta && existingMeta.payloadBitLen === metadata2.payloadBitLen) {
        return;
      }
      this.storedFrames.set(metadata2.frameNumber, wireBytes);
      this.emitWarning({
        code: "FRAME_CHANGED",
        message: `Frame ${metadata2.frameNumber} payload length changed`
      });
      this.emitWarning({
        code: "FRAME_REPLACED",
        message: `Frame ${metadata2.frameNumber} replaced with updated payload`
      });
      this.checkCompletion();
      return;
    }
    this.storedFrames.set(metadata2.frameNumber, wireBytes);
    this.totalReceivedWireBits += wireBytes.length * 8;
    if (this.state === "FirstEstablished" || this.state === "Receiving" || this.state === "WaitingMissingFrames") {
      this.state = "Receiving";
    }
    this.checkCompletion();
  }
  handleCrcError() {
    this.consecutiveCrcErrors += 1;
    const maxErrors = this.config.transport.maxConsecutiveCrcErrors;
    this.emitError({
      code: "SYNTAX_ERROR",
      message: `Frame CRC check failed (Consecutive errors: ${this.consecutiveCrcErrors})`,
      critical: false
    });
    if (maxErrors > 0 && this.consecutiveCrcErrors >= maxErrors) {
      this.emitError({
        code: "MAX_CRC_ERRORS_EXCEEDED",
        message: `Consecutive CRC errors exceeded threshold (${maxErrors})`,
        critical: true
      });
    }
  }
  processPendingQueue() {
    if (this.pendingPreFirstFrames.length === 0) return;
    const queue = [...this.pendingPreFirstFrames];
    this.pendingPreFirstFrames = [];
    for (const wireBytes of queue) {
      try {
        const metadata2 = DataApi.parseFrame(wireBytes, this.knownTotalQrCount, this.knownFirstFrameCrc);
        if (this.storedFrames.has(metadata2.frameNumber)) {
          continue;
        }
        this.processPostFirstFrame(wireBytes, metadata2);
      } catch {
      }
    }
  }
  checkCompletion() {
    if (this.knownTotalQrCount === void 0) return;
    if (this.storedFrames.size < this.knownTotalQrCount) {
      this.state = "WaitingMissingFrames";
      return;
    }
    for (let i = 0; i < this.knownTotalQrCount; i++) {
      if (!this.storedFrames.has(i)) {
        this.state = "WaitingMissingFrames";
        return;
      }
    }
    this.state = "OverallCrcVerification";
    const orderedFrames = [];
    for (let i = 0; i < this.knownTotalQrCount; i++) {
      orderedFrames.push(this.storedFrames.get(i));
    }
    try {
      const decoded = DataApi.decodeFrames(orderedFrames);
      this.emitComplete(decoded);
    } catch (err) {
      this.emitError({
        code: "OVERALL_CRC_MISMATCH",
        message: `Overall CRC verification failed: ${String(err)}`,
        critical: true,
        details: err
      });
    }
  }
};

// src/utils/worker.ts
function isWorkerContext() {
  if (typeof self !== "undefined" && typeof window === "undefined") {
    return true;
  }
  const g = globalThis;
  if (g.process && g.process.versions && g.process.versions.node) {
    try {
      const req = globalThis.require;
      if (typeof req === "function") {
        const workerThreads = req("node:worker_threads");
        return !workerThreads.isMainThread;
      }
    } catch {
      return false;
    }
  }
  return false;
}
async function handleWorkerMessage(msg) {
  try {
    let result;
    switch (msg.type) {
      case "parseFrame": {
        const { wireBytes, knownTotalQrCount, knownFirstFrameCrc } = msg.payload;
        result = DataApi.parseFrame(new Uint8Array(wireBytes), knownTotalQrCount, knownFirstFrameCrc);
        break;
      }
      case "decodeFrames": {
        const frames = msg.payload.wireFrames.map((f) => new Uint8Array(f));
        result = DataApi.decodeFrames(frames);
        break;
      }
      case "encodeBytes": {
        const { data, maxFrameBits } = msg.payload;
        result = DataApi.encodeBytes(new Uint8Array(data), maxFrameBits);
        break;
      }
      case "encodeText": {
        const { text, maxFrameBits } = msg.payload;
        result = DataApi.encodeText(text, maxFrameBits);
        break;
      }
      case "decodeQrImage": {
        const { rgbaPixels, width, height } = msg.payload;
        const pixels = new Uint8Array(rgbaPixels);
        const wireBytes = DataApi.decodeQrImage(pixels, width, height);
        result = Array.from(wireBytes);
        break;
      }
      default:
        throw new Error(`Unknown worker request type: ${msg.type}`);
    }
    return {
      id: msg.id,
      type: msg.type,
      success: true,
      result
    };
  } catch (err) {
    return {
      id: msg.id,
      type: msg.type,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function setupWorkerSelfListener() {
  if (!isWorkerContext()) {
    return;
  }
  const g = globalThis;
  if (g.process && g.process.versions && g.process.versions.node) {
    try {
      const req = globalThis.require;
      if (typeof req === "function") {
        const workerThreads = req("node:worker_threads");
        if (workerThreads.parentPort) {
          workerThreads.parentPort.on("message", async (msg) => {
            const res = await handleWorkerMessage(msg);
            workerThreads.parentPort.postMessage(res);
          });
          return;
        }
      }
    } catch {
    }
  }
  if (typeof self !== "undefined") {
    self.addEventListener("message", async (event) => {
      const res = await handleWorkerMessage(event.data);
      self.postMessage(res);
    });
  }
}
function decodeQrImageInWorker(worker, rgbaPixels, width, height) {
  return new Promise((resolve, reject) => {
    const id2 = `qr-decode-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const listener = (data) => {
      if (data && data.id === id2) {
        cleanup();
        if (data.success) {
          resolve(new Uint8Array(data.result));
        } else {
          reject(new Error(data.error || "Worker decodeQrImage failed"));
        }
      }
    };
    const handleEvent = (event) => {
      const data = event && typeof event === "object" && "data" in event ? event.data : event;
      listener(data);
    };
    const cleanup = () => {
      if ("removeEventListener" in worker && typeof worker.removeEventListener === "function") {
        worker.removeEventListener("message", handleEvent);
      } else if ("off" in worker && typeof worker.off === "function") {
        worker.off("message", handleEvent);
      }
    };
    if ("addEventListener" in worker && typeof worker.addEventListener === "function") {
      worker.addEventListener("message", handleEvent);
    } else if ("on" in worker && typeof worker.on === "function") {
      worker.on("message", handleEvent);
    }
    const message = {
      id: id2,
      type: "decodeQrImage",
      payload: {
        rgbaPixels: Array.from(rgbaPixels),
        width,
        height
      }
    };
    worker.postMessage(message);
  });
}
setupWorkerSelfListener();
export {
  AppConfig,
  BrowserRuntimeApi,
  BrowserRuntimeConfig,
  DataApi,
  DataConfig,
  TransportApi,
  TransportConfig,
  decodeQrImageInWorker,
  handleWorkerMessage,
  isWorkerContext,
  protocol,
  setupWorkerSelfListener
};
//# sourceMappingURL=QrDataTransport.js.map
