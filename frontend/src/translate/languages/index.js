import { messages as portugueseMessages } from "./pt";
import { messages as englishMessages } from "./en";
import { messages as spanishMessages } from "./es";
import { messages as turkishMessages } from "./tr"; // ✅ NOVO

const messages = {
	...portugueseMessages,
	...englishMessages,
	...spanishMessages,
	...turkishMessages, // ✅ NOVO
};

export { messages };

