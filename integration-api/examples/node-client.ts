const baseUrl = process.env.ZINTO_API_URL ?? "https://crm.zinto.app/_integration-api";
const apiKey = process.env.ZINTO_API_KEY;

if (!apiKey) throw new Error("ZINTO_API_KEY is required");

async function zinto<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Zinto ${response.status}: ${JSON.stringify(body)}`);
  return body as T;
}

const identity = await zinto("/api/v1/me");
console.log("identity", identity);

const contact = await zinto("/api/v1/contacts", {
  method: "POST",
  headers: { "idempotency-key": crypto.randomUUID() },
  body: JSON.stringify({
    name: "Contacto de ejemplo",
    phone: "+34600000000",
    source: "partner-api"
  })
});
console.log("contact", contact);

const channels = await zinto<{ data: Array<{ id: string; capabilities: string[] }> }>(
  "/api/v1/channels"
);
const textChannel = channels.data.find((channel) => channel.capabilities.includes("text"));

if (textChannel) {
  const message = await zinto("/api/v1/messages/send", {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      channel_id: textChannel.id,
      to: "+34600000000",
      message: "Mensaje de prueba desde la API de Zinto"
    })
  });
  console.log("message", message);
}

