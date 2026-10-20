/**
 * Sequential prompt queue with pause, resume, stop and explicit failure
 * accounting. The engine is UI-agnostic: the side panel injects a `runPrompt`
 * that talks to the Flow tab, and tests inject a deterministic fake.
 */

export const QUEUE_STATUS = Object.freeze({
  idle: 'idle',
  running: 'running',
  paused: 'paused',
  stopped: 'stopped',
  completed: 'completed',
  completedWithErrors: 'completed-with-errors',
  failed: 'failed',
});

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'el prompt falló sin detalle';
}

export class QueueEngine {
  constructor({
    prompts = [],
    runPrompt,
    delayMs = 0,
    continueOnError = false,
    sleep = defaultSleep,
    onUpdate = () => {},
  } = {}) {
    if (typeof runPrompt !== 'function') {
      throw new Error('QueueEngine necesita una función runPrompt');
    }
    this.prompts = prompts
      .map((prompt) => String(prompt ?? '').trim())
      .filter(Boolean);
    this.runPrompt = runPrompt;
    this.delayMs = Math.max(0, Number(delayMs) || 0);
    this.continueOnError = Boolean(continueOnError);
    this.sleep = sleep;
    this.onUpdate = onUpdate;
    this._status = QUEUE_STATUS.idle;
    this._items = this.prompts.map((prompt, index) => ({
      index,
      prompt,
      status: 'pending',
      error: null,
      result: null,
    }));
    this._completedCount = 0;
    this._failedCount = 0;
    this._error = null;
    this._controller = null;
    this._stopRequested = false;
    this._pauseWaiters = [];
    this._stopPromise = null;
    this._stopResolve = null;
  }

  state() {
    return {
      status: this._status,
      items: this._items.map((item) => ({ ...item })),
      completedCount: this._completedCount,
      failedCount: this._failedCount,
      error: this._error,
      results: this._items
        .filter((item) => item.status === 'done')
        .map((item) => ({
          index: item.index,
          prompt: item.prompt,
          value: item.result,
        })),
    };
  }

  async start() {
    if (this._status === QUEUE_STATUS.running || this._status === QUEUE_STATUS.paused) {
      throw new Error('la cola ya está corriendo');
    }
    if (this.prompts.length === 0) {
      throw new Error('no hay prompts para ejecutar');
    }

    this._status = QUEUE_STATUS.running;
    this._error = null;
    this._completedCount = 0;
    this._failedCount = 0;
    this._stopRequested = false;
    this._items = this.prompts.map((prompt, index) => ({
      index,
      prompt,
      status: 'pending',
      error: null,
      result: null,
    }));
    this._controller = new AbortController();
    this._stopPromise = new Promise((resolve) => {
      this._stopResolve = resolve;
    });
    this._emit();

    try {
      return await this._loop();
    } finally {
      this._controller = null;
      this._stopResolve = null;
      this._stopPromise = null;
      this._pauseWaiters = [];
    }
  }

  pause() {
    if (this._status !== QUEUE_STATUS.running) return false;
    this._status = QUEUE_STATUS.paused;
    this._emit();
    return true;
  }

  resume() {
    if (this._status !== QUEUE_STATUS.paused) return false;
    this._status = QUEUE_STATUS.running;
    const waiters = this._pauseWaiters.splice(0);
    for (const resolve of waiters) resolve();
    this._emit();
    return true;
  }

  stop() {
    if (
      this._status === QUEUE_STATUS.idle ||
      this._status === QUEUE_STATUS.completed ||
      this._status === QUEUE_STATUS.completedWithErrors ||
      this._status === QUEUE_STATUS.failed ||
      this._status === QUEUE_STATUS.stopped
    ) {
      return false;
    }
    this._stopRequested = true;
    this._status = QUEUE_STATUS.stopped;
    this._controller?.abort();
    const waiters = this._pauseWaiters.splice(0);
    for (const resolve of waiters) resolve();
    this._stopResolve?.();
    this._emit();
    return true;
  }

  async _loop() {
    for (const item of this._items) {
      if (this._stopRequested) break;
      await this._waitIfPaused();
      if (this._stopRequested) break;

      item.status = 'running';
      this._emit();

      try {
        const result = await this.runPrompt(item.prompt, item.index, {
          signal: this._controller.signal,
        });
        if (this._stopRequested) {
          item.status = 'error';
          item.error = 'Detenida por el usuario.';
          break;
        }
        item.status = 'done';
        item.result = result;
        this._completedCount += 1;
      } catch (error) {
        if (this._stopRequested) {
          item.status = 'error';
          item.error = 'Detenida por el usuario.';
          break;
        }
        item.status = 'error';
        item.error = messageOf(error);
        this._failedCount += 1;
        this._error = item.error;
        this._emit();
        if (!this.continueOnError) {
          this._status = QUEUE_STATUS.failed;
          this._emit();
          return this.state();
        }
      }

      this._emit();
      if (this._stopRequested) break;
      await this._sleepPaced();
    }

    if (this._stopRequested) {
      this._status = QUEUE_STATUS.stopped;
    } else if (this._failedCount > 0) {
      this._status = QUEUE_STATUS.completedWithErrors;
    } else {
      this._status = QUEUE_STATUS.completed;
    }
    this._emit();
    return this.state();
  }

  async _waitIfPaused() {
    while (this._status === QUEUE_STATUS.paused && !this._stopRequested) {
      await new Promise((resolve) => {
        this._pauseWaiters.push(resolve);
      });
    }
  }

  async _sleepPaced() {
    if (this.delayMs <= 0) return;
    if (!this._stopPromise) {
      await this.sleep(this.delayMs);
      return;
    }
    await Promise.race([this.sleep(this.delayMs), this._stopPromise]);
  }

  _emit() {
    try {
      this.onUpdate(this.state());
    } catch {
      // A broken observer must not stop a queue that is already running.
    }
  }
}
