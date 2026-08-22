interface JoinGateOptions<T> {
  accept(state: T): boolean;
  join(): Promise<T>;
  onFailure(cause: unknown): void;
  startSync(): void;
}

export async function runJoinGate<T>({ accept, join, onFailure, startSync }: JoinGateOptions<T>) {
  try {
    const state = await join();
    if (!accept(state)) return false;
    startSync();
    return true;
  } catch (cause) {
    onFailure(cause);
    return false;
  }
}
