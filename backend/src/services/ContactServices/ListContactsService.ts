import { Sequelize, fn, col, where, Op, Filterable } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ContactTag from "../../models/ContactTag";

import { intersection } from "lodash";
import Tag from "../../models/Tag";
import removeAccents from "remove-accents";
import Whatsapp from "../../models/Whatsapp";
import User from "../../models/User";
import ShowUserService from "../UserServices/ShowUserService";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  companyId: number;
  tagsIds?: number[];
  isGroup?: string;
  userId?: number;
  profile?: string; // <<-- ALTERAÇÃO 1: Adicionado 'profile' à interface
}

interface Response {
  contacts: Contact[];
  count: number;
  hasMore: boolean;
}

const ListContactsService = async ({
  searchParam = "",
  pageNumber = "1",
  companyId,
  tagsIds,
  isGroup,
  userId,
  profile // <<-- ALTERAÇÃO 2: 'profile' recebido como parâmetro
}: Request): Promise<Response> => {
  let whereCondition: Filterable["where"] = {}; // Começa como um objeto vazio

  // <<-- ALTERAÇÃO 3: Lógica principal de restrição de contatos
  // Se o perfil do usuário não for 'admin', aplicamos o filtro.
  if (profile !== 'admin') {
    // 1. Busca todos os 'contactId' da tabela de Tickets que pertencem ao 'userId' atual.
    const userTickets = await Ticket.findAll({
      where: { userId },
      attributes: ["contactId"], // Seleciona apenas a coluna 'contactId' para otimização
      group: ["contactId"]       // Agrupa para obter IDs de contato únicos
    });

    // 2. Mapeia o resultado para um array de números (IDs dos contatos)
    const contactIds = userTickets.map(t => t.contactId);

    // 3. Adiciona a condição à query: o ID do contato DEVE estar na lista de IDs que o usuário atendeu.
    // Se o usuário não atendeu nenhum ticket, a lista 'contactIds' será vazia e nenhum contato será retornado.
    whereCondition.id = {
      [Op.in]: contactIds
    };
  }

  if (searchParam) {
    const sanitizedSearchParam = removeAccents(searchParam.toLocaleLowerCase().trim());
    whereCondition = {
      ...whereCondition,
      [Op.or]: [
        {
          name: where(
            fn("LOWER", fn("unaccent", col("Contact.name"))),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        },
        { number: { [Op.like]: `%${sanitizedSearchParam}%` } }
      ]
    };
  }

  whereCondition = {
    ...whereCondition,
    companyId
  };

  if (Array.isArray(tagsIds) && tagsIds.length > 0) {
    const contactTagFilter: any[] | null = [];
    const contactTags = await ContactTag.findAll({
      where: { tagId: { [Op.in]: tagsIds } }
    });
    if (contactTags) {
      contactTagFilter.push(contactTags.map(t => t.contactId));
    }

    const contactTagsIntersection: number[] = intersection(...contactTagFilter);

    whereCondition = {
      ...whereCondition,
      id: {
        [Op.in]: contactTagsIntersection
      }
    };
  }

  if (isGroup === "false") {
    console.log("isGroup", isGroup)
    whereCondition = {
      ...whereCondition,
      isGroup: false
    }
  }


  const limit = 100;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: contacts } = await Contact.findAndCountAll({
    where: whereCondition,
    attributes: ["id", "name", "number", "email", "isGroup", "urlPicture", "active", "companyId", "channel"],
    limit,
    include: [
      {
        model: Tag,
        as: "tags",
        attributes: ["id", "name"]
      },
    ],
    offset,
    order: [["name", "ASC"]]
  });

  const hasMore = count > offset + contacts.length;

  return {
    contacts,
    count,
    hasMore
  };
};

export default ListContactsService;