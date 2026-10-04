// src/wasm/protocol.js
var dv = new DataView(new ArrayBuffer());
var dataView = (mem) => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);
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
var RESOURCE_SCOPE_ID = 0;
var RESOURCE_SCOPE_TASKS = /* @__PURE__ */ new Map();
var ASYNC_TASKS_BY_COMPONENT_IDX = /* @__PURE__ */ new Map();
var ASYNC_CURRENT_TASK_IDS = [];
var ASYNC_CURRENT_COMPONENT_IDXS = [];
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
var WebAssemblyRuntimeError = WebAssembly.RuntimeError;
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
var CURRENT_TASK_MAY_BLOCK = globalThis.WebAssembly ? new globalThis.WebAssembly.Global({ value: "i32", mutable: true }, 0) : false;
var isNode = typeof process !== "undefined" && process.versions && process.versions.node;
var _fs;
async function fetchCompile(url) {
  if (isNode) {
    _fs = _fs || await import("node:fs/promises");
    return WebAssembly.compile(await _fs.readFile(url));
  }
  return fetch(url).then(WebAssembly.compileStreaming);
}
var instantiateCore = WebAssembly.instantiate;
var exports0;
var memory0;
var realloc0;
var realloc0Async;
var postReturn0;
var postReturn0Async;
var protocolDecode;
function decode(arg0) {
  const hostProvided = false;
  getOrCreateAsyncState(0).throwIfTrapped();
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    preserveFutureResult: false,
    entryFnName: "protocolDecode",
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: "none",
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
        _debugLog('[iface="snows:qr-data-transport/protocol", function="decode"][Instruction::CallWasm] enter', {
          funcName: "decode",
          paramCount: 2,
          async: false,
          postReturn: true
        });
        let ret;
        try {
          ret = _withGlobalCurrentTaskMeta({
            taskID: task.id(),
            componentIdx: task.componentIdx(),
            fn: () => protocolDecode(ptr0, len0)
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
        var ptr1 = dataView(memory0).getUint32(ret + 0, true);
        var len1 = dataView(memory0).getUint32(ret + 4, true);
        if (ptr1 % 1 !== 0) throw new TypeError(`list pointer [${ptr1}] is not aligned to 1`);
        var result1 = new Uint8Array(memory0.buffer.slice(ptr1, ptr1 + len1 * 1));
        _debugLog('[iface="snows:qr-data-transport/protocol", function="decode"][Instruction::Return]', {
          funcName: "decode",
          paramCount: 1,
          async: false,
          postReturn: true
        });
        task.resolve([result1]);
        const retCopy = result1;
        let cstate = getOrCreateAsyncState(0);
        cstate.mayLeave = false;
        postReturn0(ret);
        cstate.mayLeave = true;
        task.exit();
        return retCopy;
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
var $init = (() => {
  let gen = (function* _initGenerator() {
    const module0 = fetchCompile(new URL("./protocol.core.wasm", import.meta.url));
    ({ exports: exports0 } = yield instantiateCore(yield module0));
    memory0 = exports0.memory;
    realloc0 = exports0.cabi_realloc;
    try {
      realloc0Async = WebAssembly.promising(exports0.cabi_realloc);
    } catch (err) {
      realloc0Async = exports0.cabi_realloc;
    }
    postReturn0 = exports0["cabi_post_snows:qr-data-transport/protocol#decode"];
    try {
      postReturn0Async = WebAssembly.promising(exports0["cabi_post_snows:qr-data-transport/protocol#decode"]);
    } catch (err) {
      postReturn0Async = exports0["cabi_post_snows:qr-data-transport/protocol#decode"];
    }
    protocolDecode = exports0["snows:qr-data-transport/protocol#decode"];
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
  decode
};

// src/main.ts
var input = new Uint8Array([1, 2, 127, 128, 255]);
var output = protocol.decode(input);
export {
  input,
  output
};
//# sourceMappingURL=index.js.map
