export class WorkerClient {
  constructor(url) {
    this.worker = new Worker(url, { type: "module" });
    this.pending = new Map();
    this.nextId = 1;
    this.worker.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  call(type, payload) {
    const id = this.nextId++;
    this.worker.postMessage({ id, type, payload });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  terminate() {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) {
      reject(new Error("Worker terminated."));
    }
    this.pending.clear();
  }

  handleMessage(message) {
    const deferred = this.pending.get(message.id);
    if (!deferred) {
      return;
    }
    this.pending.delete(message.id);
    if (message.ok) {
      deferred.resolve(message.payload);
    } else {
      deferred.reject(new Error(message.error ?? "Worker error"));
    }
  }
}
