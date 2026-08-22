export interface HoldScheduler {
  clear(handle: unknown): void;
  set(callback: () => void, delay: number): unknown;
}

const defaultScheduler: HoldScheduler = {
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  set: (callback, delay) => setTimeout(callback, delay),
};

export class HoldAttemptGate {
  private busy = false;
  private finishing: Promise<void> | null = null;

  begin() {
    if (this.busy) return false;
    this.busy = true;
    return true;
  }

  finish(
    started: Promise<void>,
    sendStop: () => Promise<void>,
    scheduler: HoldScheduler = defaultScheduler,
  ) {
    if (this.finishing) return this.finishing;
    const safeStop = () => sendStop().catch(() => undefined);
    void safeStop();
    const firstRetry = scheduler.set(() => void safeStop(), 750);
    const secondRetry = scheduler.set(() => void safeStop(), 2_500);
    this.finishing = started
      .catch(() => undefined)
      .then(safeStop)
      .finally(() => {
        scheduler.clear(firstRetry);
        scheduler.clear(secondRetry);
        this.busy = false;
        this.finishing = null;
      });
    return this.finishing;
  }

  isBusy() {
    return this.busy;
  }
}
