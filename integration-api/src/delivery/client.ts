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
  constructor(public readonly statusCode: number, public readonly response: unknown) {
    super("The legacy delivery engine rejected the message");
  }
}

export class LegacyDeliveryClient implements DeliveryClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    const { path, body } = legacyPayload(request);
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.bearerToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
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
