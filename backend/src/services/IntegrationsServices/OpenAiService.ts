import { MessageUpsertType, proto, WASocket } from "@whiskeysockets/baileys";
import {
  convertTextToSpeechAndSaveToFile,
  getBodyMessage,
  keepOnlySpecifiedChars,
  transferQueue,
  verifyMediaMessage,
  verifyMessage,
} from "../WbotServices/wbotMessageListener";
import { isNil } from "lodash";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { GoogleGenerativeAI, Part, Content } from "@google/generative-ai"; // Importação adicionada
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import TicketTraking from "../../models/TicketTraking";

type Session = WASocket & {
  id?: number;
};

interface ImessageUpsert {
  messages: proto.IWebMessageInfo[];
  type: MessageUpsertType;
}

interface IOpenAi {
  name: string;
  prompt: string;
  voice: string;
  voiceKey: string;
  voiceRegion: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
  queueId: number;
  maxMessages: number;
  model: string;
  openAiApiKey?: string;
}

interface SessionOpenAi extends OpenAI {
  id?: number;
}

interface SessionGemini extends GoogleGenerativeAI {
  id?: number;
}

const sessionsOpenAi: SessionOpenAi[] = [];
const sessionsGemini: SessionGemini[] = [];

const deleteFileSync = (path: string): void => {
  try {
    fs.unlinkSync(path);
  } catch (error) {
    console.error("Erro ao deletar o arquivo:", error);
  }
};

const sanitizeName = (name: string): string => {
  let sanitized = name.split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

// Prepares the AI messages from past messages
const prepareMessagesAI = (pastMessages: Message[], isGeminiModel: boolean, promptSystem: string): any[] => {
  const messagesAI: any[] = [];

  // For OpenAI, include the system prompt as a 'system' role
  // For Gemini, we pass the system prompt separately, so we don't add it here.
  if (!isGeminiModel) {
    messagesAI.push({ role: "system", content: promptSystem });
  }

  // Map past messages to AI message format
  for (const message of pastMessages) {
    // We only consider text messages for the history
    if (message.mediaType === "conversation" || message.mediaType === "extendedTextMessage") {
      if (message.fromMe) {
        // Messages from the bot are 'assistant' (or 'model' for Gemini)
        messagesAI.push({ role: "assistant", content: message.body });
      } else {
        // Messages from the user are 'user'
        messagesAI.push({ role: "user", content: message.body });
      }
    }
  }

  return messagesAI;
};

// Processes the AI response (text or audio)
const processResponse = async (
  responseText: string,
  wbot: Session,
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact,
  openAiSettings: IOpenAi,
  ticketTraking: TicketTraking
): Promise<void> => {
  let response = responseText;

  // Check for transfer action trigger
  if (response?.toLowerCase().includes("ação: transferir para o setor de atendimento")) {
    await transferQueue(openAiSettings.queueId, ticket, contact);
    response = response.replace(/ação: transferir para o setor de atendimento/i, "").trim();
  }

  // If after removing the action, the response is empty, do nothing further.
  if (!response) {
    return;
  }

  const publicFolder: string = path.resolve(__dirname, "..", "..", "..", "public", `company${ticket.companyId}`);

  // Send response based on preferred format (text or voice)
  if (openAiSettings.voice === "texto") {
    const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
      text: `\u200e ${response}`,
    });
    await verifyMessage(sentMessage!, ticket, contact);
  } else {
    const fileNameWithOutExtension = `${ticket.id}_${Date.now()}`;
    try {
      await convertTextToSpeechAndSaveToFile(
        keepOnlySpecifiedChars(response),
        `${publicFolder}/${fileNameWithOutExtension}`,
        openAiSettings.voiceKey,
        openAiSettings.voiceRegion,
        openAiSettings.voice,
        "mp3"
      );
      const sendMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        audio: { url: `${publicFolder}/${fileNameWithOutExtension}.mp3` },
        mimetype: "audio/mpeg",
        ptt: true,
      });
      await verifyMediaMessage(sendMessage!, ticket, contact, ticketTraking, false, false, wbot);
      deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.mp3`);
      deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.wav`);
    } catch (error) {
      console.error(`Erro para responder com audio: ${error}`);
      // Fallback to text response
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `\u200e ${response}`,
      });
      await verifyMessage(sentMessage!, ticket, contact);
    }
  }
};

// Handles OpenAI request
const handleOpenAIRequest = async (openai: SessionOpenAi, messagesAI: any[], openAiSettings: IOpenAi): Promise<string> => {
  try {
    const chat = await openai.chat.completions.create({
      model: openAiSettings.model,
      messages: messagesAI as any, // Cast to any to match OpenAI's expected type
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature,
    });
    return chat.choices[0].message?.content || "";
  } catch (error) {
    console.error("OpenAI request error:", error);
    throw error;
  }
};

// Handles Gemini request
// CORREÇÃO: A função foi reestruturada para usar o histórico corretamente.
const handleGeminiRequest = async (
  gemini: SessionGemini,
  messagesAI: any[], // O histórico já vem preparado
  openAiSettings: IOpenAi,
  newMessage: string, // A nova mensagem do usuário
  promptSystem: string
): Promise<string> => {
  try {
    const model = gemini.getGenerativeModel({
      model: openAiSettings.model,
      systemInstruction: promptSystem,
    });

    // Converte o histórico para o formato do Gemini
    const geminiHistory: Content[] = messagesAI.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(newMessage);
    return result.response.text();
  } catch (error) {
    console.error("Gemini request error:", error);
    throw error;
  }
};


// Main function to handle AI interactions
export const handleOpenAi = async (
  openAiSettings: IOpenAi,
  msg: proto.IWebMessageInfo,
  wbot: Session,
  ticket: Ticket,
  contact: Contact,
  mediaSent: Message | undefined,
  ticketTraking: TicketTraking
): Promise<void> => {
  if (contact.disableBot) {
    return;
  }

  const bodyMessage = getBodyMessage(msg);
  // We should not proceed if there is no text and no audio message.
  if (!bodyMessage && !msg.message?.audioMessage) return;

  if (!openAiSettings || !openAiSettings.model) {
    console.error("AI settings or model is not defined.");
    return;
  }

  if (msg.messageStubType) return;

  const publicFolder: string = path.resolve(__dirname, "..", "..", "..", "public", `company${ticket.companyId}`);

  // CORREÇÃO: Definição de modelos mais clara e robusta.
  const isOpenAIModel = openAiSettings.model.startsWith('gpt-');
  const isGeminiModel = openAiSettings.model.startsWith('gemini-');

  // CORREÇÃO: Adicionada verificação para modelo não suportado.
  if (!isOpenAIModel && !isGeminiModel) {
    console.error(`Unsupported model: ${openAiSettings.model}. The system will not proceed.`);
    // Opcional: enviar uma mensagem de erro para o usuário final.
    // await wbot.sendMessage(msg.key.remoteJid!, { text: "O modelo de IA configurado não é suportado." });
    return;
  }

  let openai: SessionOpenAi | null = null;
  let gemini: SessionGemini | null = null;

  // Initialize AI provider based on model
  if (isOpenAIModel) {
    const openAiIndex = sessionsOpenAi.findIndex(s => s.id === ticket.id);
    if (openAiIndex === -1) {
      // Use openAiApiKey if available (for transcription), otherwise use the main apiKey
      const key = openAiSettings.openAiApiKey || openAiSettings.apiKey;
      openai = new OpenAI({ apiKey: key }) as SessionOpenAi;
      openai.id = ticket.id;
      sessionsOpenAi.push(openai);
    } else {
      openai = sessionsOpenAi[openAiIndex];
    }
  } else if (isGeminiModel) {
    const geminiIndex = sessionsGemini.findIndex(s => s.id === ticket.id);
    if (geminiIndex === -1) {
      gemini = new GoogleGenerativeAI(openAiSettings.apiKey) as SessionGemini;
      gemini.id = ticket.id;
      sessionsGemini.push(gemini);
    } else {
      gemini = sessionsGemini[geminiIndex];
    }
  }

  // Fetch past messages
  const messages = await Message.findAll({
    where: { ticketId: ticket.id },
    order: [["createdAt", "ASC"]],
    limit: openAiSettings.maxMessages > 0 ? openAiSettings.maxMessages : undefined
  });

  // Format system prompt
  const clientName = sanitizeName(contact.name || "Amigo(a)");
  const promptSystem = `Instruções do Sistema:
  - Use o nome ${clientName} nas respostas para que o cliente se sinta mais próximo e acolhido.
  - Certifique-se de que a resposta tenha até ${openAiSettings.maxTokens} tokens e termine de forma completa, sem cortes.
  - Sempre que der, inclua o nome do cliente para tornar o atendimento mais pessoal e gentil. se não souber o nome pergunte
  - Se for preciso transferir para outro setor, comece a resposta com 'Ação: Transferir para o setor de atendimento'.
  
  Prompt Específico:
  ${openAiSettings.prompt}
  
  Siga essas instruções com cuidado para garantir um atendimento claro e amigável em todas as respostas.`;

  // Handle text message
  if (bodyMessage) {
    // Prepare history once
    const messagesAI = prepareMessagesAI(messages, isGeminiModel, promptSystem);

    try {
      let responseText: string | null = null;

      if (isOpenAIModel && openai) {
        // Add current user message to history for OpenAI
        messagesAI.push({ role: "user", content: bodyMessage });
        responseText = await handleOpenAIRequest(openai, messagesAI, openAiSettings);
      } else if (isGeminiModel && gemini) {
        // Pass the history and the new message separately to the Gemini handler
        responseText = await handleGeminiRequest(gemini, messagesAI, openAiSettings, bodyMessage, promptSystem);
      }

      if (isNil(responseText)) {
        console.error("No response from AI provider");
        return;
      }

      await processResponse(responseText, wbot, msg, ticket, contact, openAiSettings, ticketTraking);
    } catch (error: any) {
      console.error("AI request failed:", error);
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: "Desculpe, estou com dificuldades técnicas para processar sua solicitação no momento. Por favor, tente novamente mais tarde.",
      });
      await verifyMessage(sentMessage!, ticket, contact);
    }
  }
  // Handle audio message
  else if (msg.message?.audioMessage && mediaSent) {
    if (!openai) {
      console.error("OpenAI session is required for transcription but is not initialized.");
      await wbot.sendMessage(msg.key.remoteJid!, { text: "Desculpe, a transcrição de áudio não está configurada corretamente." });
      return;
    }

    try {
      const mediaUrl = mediaSent.mediaUrl!.split("/").pop();
      const audioFilePath = `${publicFolder}/${mediaUrl}`;

      if (!fs.existsSync(audioFilePath)) {
        console.error(`Audio file not found: ${audioFilePath}`);
        await wbot.sendMessage(msg.key.remoteJid!, { text: "Desculpe, não foi possível processar seu áudio. Por favor, tente novamente." });
        return;
      }

      const file = fs.createReadStream(audioFilePath);
      const transcriptionResult = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file: file,
      });

      const transcription = transcriptionResult.text;

      if (!transcription) {
        console.warn("Empty transcription received.");
        await wbot.sendMessage(msg.key.remoteJid!, { text: "Desculpe, não consegui entender o áudio. Tente novamente ou envie uma mensagem de texto." });
        return;
      }

      // Send transcription to user
      const sentTranscriptMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `🎤 *Sua mensagem de voz:* ${transcription}`,
      });
      await verifyMessage(sentTranscriptMessage!, ticket, contact);

      // Now, get the AI response for the transcription
      const messagesAI = prepareMessagesAI(messages, isGeminiModel, promptSystem);
      let responseText: string | null = null;
      
      if (isOpenAIModel) {
          messagesAI.push({ role: "user", content: transcription });
          responseText = await handleOpenAIRequest(openai, messagesAI, openAiSettings);
      } else if (isGeminiModel && gemini) {
          responseText = await handleGeminiRequest(gemini, messagesAI, openAiSettings, transcription, promptSystem);
      }
      
      if(responseText){
        await processResponse(responseText, wbot, msg, ticket, contact, openAiSettings, ticketTraking);
      }

    } catch (error: any) {
      console.error("Audio processing error:", error);
      const errorMessage = error?.response?.error?.message || error.message || "Unknown error";
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `Desculpe, houve um erro ao processar seu áudio: ${errorMessage}`,
      });
      await verifyMessage(sentMessage!, ticket, contact);
    }
  }
};

export default handleOpenAi;