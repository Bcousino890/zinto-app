import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class WebhookSecretCipher {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    this.key = Buffer.from(hexKey, "hex");
    if (this.key.length !== 32) throw new Error("WEBHOOK_ENCRYPTION_KEY must contain 64 hexadecimal characters");
  }

  encrypt(secret: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return [nonce, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
  }

  decrypt(value: string): string {
    const [nonceValue, tagValue, ciphertextValue] = value.split(".");
    if (!nonceValue || !tagValue || !ciphertextValue) throw new Error("Invalid encrypted webhook secret");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(nonceValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  }
}
