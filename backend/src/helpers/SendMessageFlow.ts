import Whatsapp from "../models/Whatsapp";
import GetWhatsappWbot from "./GetWhatsappWbot";
import fs from "fs";

import { getMessageOptions } from "../services/WbotServices/SendWhatsAppMedia";
import {
  WAMessage,
  WAMessageContent,
  generateWAMessageContent,
  generateWAMessageFromContent,
  AnyMessageContent,
  WASocket,
  proto, // Certifique-se de que todas essas importações vêm de @whiskeysockets/baileys
} from "@whiskeysockets/baileys";

export type MessageData = {
  number: number | string;
  body: string;
  mediaPath?: string;
};

interface FlowTemplateButton {
  index: number;
  urlButton?: { displayText: string; url: string; };
  callButton?: { displayText: string; phoneNumber: string; };
  quickReplyButton?: { displayText: string; id: string; };
}

export const SendMessageFlow = async (
  whatsapp: Whatsapp,
  messageData: MessageData,
  isFlow: boolean = false,
  isRecord: boolean = false
): Promise<WAMessage | proto.WebMessageInfo> => {
  try {
    const wbot: WASocket = await GetWhatsappWbot(whatsapp);
    const chatId = `${messageData.number}@s.whatsapp.net`;

    let message: WAMessage;

    const templateButtons: FlowTemplateButton[] = [
      { index: 1, urlButton: { displayText: '⭐ Star Baileys on GitHub!', url: 'https://github.com/adiwajshing/Baileys' } },
      { index: 2, callButton: { displayText: 'Call me!', phoneNumber: '+1 (234) 5678-901' } },
      { index: 3, quickReplyButton: { displayText: 'This is a reply, just like normal buttons!', id: 'id-like-buttons-message' } },
    ];

    const bodyText = `\u200e${messageData.body}`;

    const interactiveButtons: proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[] = templateButtons.map(btn => {
      if (btn.urlButton) {
        return {
          name: "url",
          buttonParamsJson: JSON.stringify({
            display_text: btn.urlButton.displayText,
            url: btn.urlButton.url,
          }),
        };
      } else if (btn.callButton) {
        return {
          name: "call_action",
          buttonParamsJson: JSON.stringify({
            display_text: btn.callButton.displayText,
            phone_number: btn.callButton.phoneNumber,
          }),
        };
      } else if (btn.quickReplyButton) {
        return {
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: btn.quickReplyButton.displayText,
            id: btn.quickReplyButton.id,
          }),
        };
      }
      return {} as proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton;
    }).filter(btn => Object.keys(btn).length > 0);

    const messageContent: WAMessageContent = {
      interactiveMessage: {
        header: {
          title: "Seu Título da Mensagem",
        } as proto.Message.InteractiveMessage.IHeader,
        body: { text: bodyText },
        nativeFlowMessage: {
          buttons: interactiveButtons,
          messageParamsJson: JSON.stringify({
            // Parâmetros adicionais, se necessário.
          }),
        },
        footer: { text: " " }, // Seu rodapé
        // **CORREÇÃO**: Removido headerType completamente daqui, pois não é uma propriedade de IInteractiveMessage.
        // O Baileys deve inferir o headerType com base no conteúdo do 'header'.
      },
    };

    const generatedMessage = await generateWAMessageFromContent(
      chatId,
      messageContent,
      { userJid: wbot.user!.id }
    );

    message = (await wbot.relayMessage(chatId, generatedMessage.message!, {
      messageId: generatedMessage.key.id!,
    })) as unknown as WAMessage;

    return message;
  } catch (err: any) {
    console.error("Erro ao enviar mensagem de fluxo com botões:", err);
    throw new Error(`Erro ao enviar mensagem de fluxo com botões: ${err.message}`);
  }
};