export type DeliveryRequest =
  | { kind: "text"; bearerToken: string; channelId: number; to: string; message: string }
  | {
      kind: "media";
      bearerToken: string;
      channelId: number;
      to: string;
      mediaType: "image" | "video" | "audio" | "document";
      mediaUrl: string;
      caption?: string;
      filename?: string;
    }
  | {
      kind: "template";
      bearerToken: string;
      channelId: number;
      to: string;
      templateName: string;
      templateLanguage?: string;
      components?: unknown[];
    }
  | {
      kind: "interactive";
      bearerToken: string;
      channelId: number;
      to: string;
      interactiveType: "button" | "list";
      body: string;
      header?: string;
      footer?: string;
      action: Record<string, unknown>;
    };

export interface DeliveryResult {
  id: string;
  external_id: string | null;
  status: string;
  timestamp: string;
  channel_type: string;
  conversation_id: string;
}

export interface DeliveryClient {
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}

interface LegacyResponse {
  success?: boolean;
  data?: {
    id?: number | string;
    externalId?: string | null;
    status?: string;
    timestamp?: string;
    channelType?: string;
    conversationId?: number | string;
  };
}

export class DeliveryAdapterError extends Error {
  readonly #response: unknown;

  constructor(public readonly statusCode: number, response: unknown) {
    super("The legacy delivery engine rejected the message");
    this.name = "DeliveryAdapterError";
    this.#response = response;
  }

  /**
   * The raw legacy payload can carry customer data (phone numbers, message
   * content). It is kept behind an accessor rather than a plain enumerable
   * field so a generic `for...in` copy - which is exactly what pino's default
   * `err` serializer does when this error reaches a log call - cannot pull it
   * in. Callers that legitimately need it still can, explicitly.
   */
  get response(): unknown {
    return this.#response;
  }
}

/**
 * Node's global `fetch` (undici) reports every failure that happens before an
 * HTTP response exists - refused connection, failed DNS lookup, TLS failure,
 * etc. - as `TypeError: fetch failed` with the real cause on `error.cause`.
 * Verified directly against this Node runtime (connecting to a closed port
 * and to an unresolvable host) rather than assumed.
 */
const PRECONNECT_FAILURE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND"]);

function isPreConnectFailure(error: unknown): boolean {
  if (!(error instanceof TypeError) || error.message !== "fetch failed") return false;
  const cause = (error as { cause?: unknown }).cause;
  if (cause === null || typeof cause !== "object" || !("code" in cause)) return false;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" && PRECONNECT_FAILURE_CODES.has(code);
}

export class LegacyDeliveryClient implements DeliveryClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    const { path, body } = legacyPayload(request);
    return this.send(path, body, request.bearerToken, true);
  }

  private async send(
    path: string,
    body: Record<string, unknown>,
    bearerToken: string,
    allowRetry: boolean
  ): Promise<DeliveryResult> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearerToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      // A refused connection or a DNS lookup that never resolved means not
      // one byte of this request left the process, so the legacy engine -
      // and whatever WhatsApp/SMS/etc. account it would have relayed to -
      // never saw it. That is the one fetch-level failure a single retry
      // cannot turn into a duplicate real-world send. Anything else (a
      // timeout, a connection reset after it was established, an error we
      // don't recognize) is left untouched and propagates as-is, because we
      // can no longer prove the request never arrived.
      if (allowRetry && isPreConnectFailure(error)) {
        return this.send(path, body, bearerToken, false);
      }
      throw error;
    }
    const payload = await response.json().catch(() => ({})) as LegacyResponse;
    if (!response.ok || payload.success !== true || payload.data === undefined) {
      throw new DeliveryAdapterError(response.status, payload);
    }
    const data = payload.data;
    if (data.id === undefined || data.status === undefined || data.timestamp === undefined ||
        data.channelType === undefined || data.conversationId === undefined) {
      throw new DeliveryAdapterError(502, payload);
    }
    return {
      id: String(data.id),
      external_id: data.externalId ?? null,
      status: data.status,
      timestamp: data.timestamp,
      channel_type: data.channelType,
      conversation_id: String(data.conversationId)
    };
  }
}

function legacyPayload(request: DeliveryRequest): { path: string; body: Record<string, unknown> } {
  const common = { channelId: request.channelId, to: request.to };
  switch (request.kind) {
    case "text":
      return { path: "/api/v1/messages/send", body: { ...common, message: request.message, messageType: "text" } };
    case "media":
      return {
        path: "/api/v1/messages/send-media",
        body: {
          ...common,
          mediaType: request.mediaType,
          mediaUrl: request.mediaUrl,
          caption: request.caption,
          filename: request.filename
        }
      };
    case "template":
      return {
        path: "/api/v1/messages/send-template",
        body: {
          ...common,
          templateName: request.templateName,
          templateLanguage: request.templateLanguage,
          components: request.components
        }
      };
    case "interactive":
      return {
        path: "/api/v1/messages/send-interactive",
        body: {
          ...common,
          interactiveType: request.interactiveType,
          body: request.body,
          header: request.header,
          footer: request.footer,
          action: request.action
        }
      };
  }
}
