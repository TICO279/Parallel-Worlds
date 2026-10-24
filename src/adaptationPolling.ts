import type { AdaptationData } from '../shared/characterState';
export type AdaptationView = AdaptationData & { prepared: { version: number; instructions: string; persistentInstructions?: string; triggerTurnId?: string } };
/** Serial polling includes final scores after disconnect and ignores stale sessions. */
export function pollAdaptation(options: {
  load(signal: AbortSignal): Promise<AdaptationView>; onData(data: AdaptationView): void;
  onError(): void; keepPolling(data?: AdaptationView): boolean;
  beforeLoad?(): Promise<unknown>; intervalMs?: number;
}) {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let failures = 0;
  const poll = async () => {
    let data: AdaptationView | undefined;
    try {
      await options.beforeLoad?.(); if (controller.signal.aborted) return;
      data = await options.load(controller.signal); if (controller.signal.aborted) return;
      failures = 0; options.onData(data);
    } catch { if (!controller.signal.aborted) { failures++; options.onError(); } }
    if (!controller.signal.aborted && (options.keepPolling(data) || (!data && failures < 10))) timer = setTimeout(() => void poll(), options.intervalMs ?? 500);
  };
  void poll(); return () => { controller.abort(); clearTimeout(timer); };
}
