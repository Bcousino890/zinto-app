const configuredBaseUrl = process.env.ZINTO_API_URL ??
  "https://crm.zinto.app/_integration-api/api/v1";
const apiKey = process.env.ZINTO_API_KEY;

if (!apiKey) throw new Error("ZINTO_API_KEY is required");

const serviceOrApiBase = configuredBaseUrl.replace(/\/+$/, "");
const apiBaseUrl = serviceOrApiBase.endsWith("/api/v1")
  ? serviceOrApiBase
  : `${serviceOrApiBase}/api/v1`;

async function zinto<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
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

const identity = await zinto("/me");
console.log("identity", identity);

const existingContacts = await zinto("/contacts?limit=50");
console.log("contacts", existingContacts);

const contact = await zinto("/contacts", {
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
  "/channels"
);
const textChannel = channels.data.find((channel) => channel.capabilities.includes("text"));

if (textChannel) {
  const message = await zinto("/messages/send", {
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

export {};
