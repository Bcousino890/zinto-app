import { Request, Response } from "express";
import Whatsapp from "../models/Whatsapp";
import { handleMessage } from "../services/FacebookServices/facebookMessageListener";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "whaticket";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
  }

  return res.status(403).json({ message: "Forbidden" });
};

export const webHook = async (req: Request, res: Response): Promise<Response> => {
  const { body } = req;
  // PASSO 1: Responda imediatamente para evitar timeout da plataforma.
  res.status(200).json({ message: "EVENT_RECEIVED" });

  try {
    if (body.object === "page" || body.object === "instagram") {
      const channel = body.object === "page" ? "facebook" : "instagram";

      // MUDANÇA 1: Trocando forEach por um loop for...of para lidar corretamente com async/await.
      for (const entry of body.entry) {
        try {
          const getTokenPage = await Whatsapp.findOne({
            where: {
              facebookPageUserId: entry.id,
              channel
            }
          });

          if (getTokenPage) {
            // MUDANÇA 2: Usando for...of aqui também.
            for (const data of entry.messaging) {
              // MUDANÇA 3: Adicionando try...catch para capturar erros específicos do handleMessage
              // e evitar que o servidor inteiro quebre.
              try {
                await handleMessage(getTokenPage, data, channel, getTokenPage.companyId);
              } catch (handleError) {
                console.error("Erro capturado dentro do handleMessage:", handleError);
              }
            }
          }
        } catch (dbError) {
          console.error("Erro ao consultar o Whatsapp no banco de dados:", dbError);
        }
      }
    }
  } catch (error) {
    console.error("Erro geral no processamento do webhook:", error);
  }

  // A resposta já foi enviada no início, então não retornamos nada aqui.
  return;
};