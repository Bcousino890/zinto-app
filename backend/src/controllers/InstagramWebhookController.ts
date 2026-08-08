import { Request, Response } from "express";

export const verifyInstagram = async (req: Request, res: Response): Promise<Response> => {
  const VERIFY_TOKEN = "zinto_secure_webhook_token_2026";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Verify webhook
  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✓ Webhook verified");
      return res.status(200).send(String(challenge));
    }
  }

  console.log("✗ Webhook verification failed");
  return res.status(403).json({ message: "Forbidden" });
};

export const handleInstagramWebhook = async (req: Request, res: Response): Promise<Response> => {
  // Handle incoming webhook events from Instagram
  res.status(200).json({ message: "EVENT_RECEIVED" });
  
  try {
    const { body } = req;
    // Add your Instagram webhook processing logic here
    console.log("Instagram webhook event:", body);
  } catch (error) {
    console.error("Error processing Instagram webhook:", error);
  }

  return;
};

