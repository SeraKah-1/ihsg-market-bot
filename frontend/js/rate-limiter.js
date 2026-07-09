/**
 * rate-limiter.js — AbortSignal-aware request spacing limiter.
 * Pure module; single instance is owned by ai.js.
 */

export class RateLimiter {
  /**
   * @param {number} requestsPerMinute
   */
  constructor(requestsPerMinute = 25) {
    this.minDelay = (60 / requestsPerMinute) * 1000;
    this.lastRequestTime = 0;
    this.queue = [];
    this.processing = false;
  }

  /**
   * Wait until a request slot is available.
   * @param {AbortSignal|null} signal
   * @param {{ skip?: boolean }} [opts] - if skip=true, resolve immediately
   * @returns {Promise<void>}
   */
  async acquire(signal = null, opts = {}) {
    if (signal && signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (opts.skip) {
      return;
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: null };

      const onAbort = () => {
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        entry.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.queue.push(entry);
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;
      const waitTime = Math.max(0, this.minDelay - timeSinceLast);

      if (waitTime > 0) {
        await new Promise((r) => setTimeout(r, waitTime));
      }

      // Drop entries already aborted while waiting
      while (this.queue.length > 0 && this.queue[0].signal && this.queue[0].signal.aborted) {
        this.queue.shift();
      }
      if (this.queue.length === 0) break;

      const entry = this.queue.shift();
      if (entry.signal && entry.onAbort) {
        try {
          entry.signal.removeEventListener("abort", entry.onAbort);
        } catch (_) {}
      }
      this.lastRequestTime = Date.now();
      entry.resolve();
    }

    this.processing = false;
    // New entries may have arrived while processing finished
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }
}
