import { Router } from "express";
import * as InstagramWebhookController from "../controllers/InstagramWebhookController";

const instagramWebhookRoutes = Router();

// GET - Webhook verification endpoint (no authentication required)
instagramWebhookRoutes.get(
  "/instagram",
  InstagramWebhookController.verifyInstagram
);

// POST - Webhook events endpoint
instagramWebhookRoutes.post(
  "/instagram",
  InstagramWebhookController.handleInstagramWebhook
);

export default instagramWebhookRoutes;

