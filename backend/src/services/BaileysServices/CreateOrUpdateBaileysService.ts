import { Chat, Contact } from "@whiskeysockets/baileys";
import Baileys from "../../models/Baileys";

interface Request {
  whatsappId: number;
  contacts?: Contact[];
  chats?: Chat[];
}

const createOrUpdateBaileysService = async ({
  whatsappId,
  contacts,
  chats,
}: Request): Promise<Baileys> => {
  try {
    const baileysExists = await Baileys.findOne({
      where: { whatsappId }
    });

    if (baileysExists) {
      // CORREÇÃO FINAL: Verifica se o dado é uma string para fazer o parse, senão o trata como um array.
      const getChats: Chat[] = 
        typeof baileysExists.chats === 'string' 
        ? JSON.parse(baileysExists.chats) 
        : (baileysExists.chats || []);

      const getContacts: Contact[] = 
        typeof baileysExists.contacts === 'string' 
        ? JSON.parse(baileysExists.contacts) 
        : (baileysExists.contacts || []);

      if (chats) {
        getChats.push(...chats);
        const newChats = getChats.filter((v: Chat, i: number, a: Chat[]) => a.findIndex(v2 => (v2.id === v.id)) === i);
        baileysExists.chats = JSON.stringify(newChats);
        return await baileysExists.save();
      }

      if (contacts) {
        getContacts.push(...contacts);
        const newContacts = getContacts.filter((v: Contact, i: number, a: Contact[]) => a.findIndex(v2 => (v2.id === v.id)) === i);
        baileysExists.contacts = JSON.stringify(newContacts);
        return await baileysExists.save();
      }

      return baileysExists;
    }

    const baileys = await Baileys.create({
      whatsappId,
      contacts: contacts ? JSON.stringify(contacts) : JSON.stringify([]),
      chats: chats ? JSON.stringify(chats) : JSON.stringify([])
    });
    return baileys;

  } catch (error) {
    console.log('ERRO NO SERVICE DE CRIAÇÃO DO BAILEYS', error);
    throw error;
  }
};

export default createOrUpdateBaileysService;