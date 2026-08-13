import type { WebhookDeliveryRepository } from "./deliveries.js";
import { dispatchBatch } from "./dispatcher.js";

export function startWebhookWorker(
  repository: WebhookDeliveryRepository,
  intervalMs = 1000,
  onError: (error: unknown) => void = () => undefined
): () => void {
  let stopped = false;
  let timeout: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      await dispatchBatch(repository);
    } catch (error) {
      onError(error);
    } finally {
      if (!stopped) timeout = setTimeout(tick, intervalMs);
    }
  };
  timeout = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    if (timeout !== undefined) clearTimeout(timeout);
  };
}
