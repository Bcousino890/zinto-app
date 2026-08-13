# Auditoría del motor legacy compilado (CRM Zinto)

Fecha: 13 de agosto de 2026
Alcance: solo lectura. No se modificó código, ni contenedores, ni base de datos.
No se abrió ninguna conexión de WhatsApp/Baileys.

## Objeto auditado y verificación de identidad

- Artefacto inspeccionado: `/opt/zinto-integration-api/dist/index.js`
  (4 403 244 bytes, bundle de servidor minificado).
- Frontend compilado: `/opt/zinto-integration-api/dist/public/assets/index-C7DlMzz7.js`.
- El contenedor en marcha `powerchat-app-bcousinoprop` (puerto 9000) ejecuta
  **el mismo archivo**, comprobado por hash:

```text
docker exec powerchat-app-bcousinoprop md5sum /app/dist/index.js
252a2e208e05e079874f9f3123cfec98  /app/dist/index.js

md5sum /opt/zinto-integration-api/dist/index.js
252a2e208e05e079874f9f3123cfec98
```

Esto es importante: todas las conclusiones de abajo se refieren literalmente al
binario en producción, no a una copia que pudiera haber divergido. Es la razón
principal por la que varias respuestas alcanzan confianza alta pese a ser código
compilado.

Convención de lectura: el bundle está minificado sin sourcemaps, así que los
identificadores son de una o dos letras. Se citan tal cual y se anota entre
paréntesis el nombre real cuando el propio bundle lo conserva (las tablas de
exportación de esbuild sí conservan los nombres originales).

Router público: `var pX=Ui`, montado con `r.use("/api/v1",pX)`. Rutas expuestas:

```text
GET  /channels                              POST /messages/send
POST /messages/send-media                   POST /messages/send-batch
POST /messages/send-template                POST /messages/send-interactive
GET  /conversations                         GET  /contacts
POST /media/upload                          GET  /messages/:messageId/status
GET  /health                                GET  /messages/:messageId/email-attachments
```

No existe ninguna ruta `/api/v1/deals*`. Esto condiciona la respuesta práctica
de la pregunta 2.

---

## PREGUNTA 1 — Autoría de los envíos

### Respuesta directa

El runbook se queda corto. **No son "algunas rutas antiguas": son las cuatro
rutas de envío, en todos los canales.** El autor se escribe con el literal `1`
incrustado en el código. No se deriva de la API key en ningún punto, y no puede
derivarse, porque el middleware de autenticación nunca propaga el usuario aunque
lo tenga cargado en memoria.

### Evidencia

**1. La tabla `api_keys` sí tiene dueño.** El esquema declara `user_id` como
columna obligatoria con referencia a `users`:

```js
// dist/index.js ~offset 110564
Io=Ue("api_keys",{
  id:$e("id").primaryKey(),
  companyId:G("company_id").notNull().references(()=>be.id,{onDelete:"cascade"}),
  userId:G("user_id").notNull().references(()=>De.id,{onDelete:"cascade"}),
  name:j("name").notNull(), keyHash:j("key_hash").notNull().unique(), ...
```

**2. El middleware carga la fila completa pero solo propaga la empresa.**
`lX` (`authenticateApiKey`):

```js
// dist/index.js ~offset 2723300
r.apiKey=o, r.apiKeyId=o.id, r.companyId=o.companyId,
p.updateApiKeyLastUsed(o.id).catch(...), e()
```

`o` es la fila de `api_keys` y contiene `o.userId`. Nunca se asigna a la
request. Confirmación por conteo sobre el bundle completo:

```text
grep -c "apiKey.userId" dist/index.js  ->  0
grep -c "req.userId"    dist/index.js  ->  0
```

**3. Las rutas pasan solo `companyId` al servicio.** Las cuatro tienen la misma
forma:

```js
// dist/index.js ~offset 3711300-3716000
Ui.post("/messages/send",        Ju("messages:send"),             ... zp.sendMessage(r.companyId,e)
Ui.post("/messages/send-media",  Ju("messages:send"),             ... zp.sendMedia(r.companyId,e)
Ui.post("/messages/send-template",Ju("messages:send:template"),   ... zp.sendTemplateMessage(r.companyId,e)
Ui.post("/messages/send-interactive",Ju("messages:send:interactive"),... zp.sendInteractiveMessage(r.companyId,e)
```

`zp` es `new XL`, la clase de servicio del API público (offset 3699606). Su
firma no admite un identificador de usuario en ninguna de las cuatro entradas.

**4. El literal `1` aparece en el despacho por canal.** `XL.sendThroughChannel`
(offset ~3706100). `t` es la conexión de canal; el segundo argumento de cada
servicio es el `userId`:

```js
case"whatsapp_unofficial":case"whatsapp": return await Gt.sendMessage(t.id,1,e,n);
case"whatsapp_official":                  return await rr.sendMessage(t.id,1,t.companyId,e,n);
case"whatsapp_meta":                      return await Gf.sendMessage(t.id,1,e,n);
case"twilio_sms":                         return await km.sendMessage(t.id,1,e,n);
case"telegram": let o=await ro.sendMessage(t.id,e,n,1);
   ... let g={conversationId:a,senderId:1,content:n,type:"text",direction:"outbound",...}
case"instagram":                          return await i(t.id,1,t.companyId,e,n);
case"messenger":                          return await c(t.id,t.userId,t.companyId,e,n);
case"tiktok":  ...sendAndSaveMessage(t.id,t.companyId,String(a),e,1,"text",n);
case"email":   ...sendMessage(t.id,1,e,"API Message",n,{isHtml:!1});
case"webchat": ...sendMessage(t.id,e,n);
```

`XL.sendMediaThroughChannel` (offset ~3709900) repite el patrón:

```js
case"whatsapp_unofficial":case"whatsapp": return await Gt.sendMedia(t.id,1,e,n,a,s,o);
case"whatsapp_official":                  return await rr.sendMedia(t.id,1,t.companyId,e,n,a,s,o,void 0,!0);
case"whatsapp_meta":                      return await Gf.sendMessage(t.id,1,e,s,a,n);
case"telegram":                           return await ro.sendMedia(t.id,e,a,l,s,1);
case"instagram":                          return await Hr.sendMedia(t.id,e,a,n,s,1);
case"messenger":                          return await Es.sendMedia(t.id,t.userId,e,a,u);
case"twilio_sms":                         return await km.sendMedia(t.id,1,e,n,a,s);
case"tiktok":   ...sendAndSaveMessage(t.id,t.companyId,String(i),e,1,g,a);
case"email":    ...sendMessage(t.id,1,e,"API Media Message",h,{isHtml:!1});
```

Y en plantillas e interactivos el literal es todavía más explícito — una
variable local inicializada a `1`:

```js
// XL.sendTemplateMessage, offset ~3701900
let a=await this.findOrCreateContact(...), s=await this.findOrCreateConversation(...), o=1, i;
...
i=await c(n.id,o,n.companyId,e.to,e.templateName,e.templateLanguage,l)

// XL.sendInteractiveMessage, offset ~3703000
let o=1, i;
...
d={conversationId:s.id,senderId:o,content:e.content.body.text,type:"interactive",
   direction:"outbound",status:u.success?"sent":"failed",externalId:u.messageId,...}
i=await p.createMessage(d)
```

**5. Confirmación de que ese segundo argumento acaba en `messages.sender_id`.**
Se verificó en las implementaciones de canal, no por analogía:

```js
// WhatsApp Official: RH(connectionId, userId, companyId, to, message, isFromBot=false)
// offset ~839719
let I=await p.createMessage({conversationId:b.id,direction:"outbound",type:"text",
  content:d[0], senderId:s?null:t, senderType:s?null:"user", isFromBot:s, ...})

// Twilio SMS: eue(connectionId, userId, to, body)   offset ~894872
let y={conversationId:g.id, senderId:t, content:n, type:"text",
       direction:"outbound", status:"sent", externalId:d, ...}

// WhatsApp Meta: QL.sendMessage(connectionId, userId, to, content, mediaUrl, mediaType)
await p.createMessage({conversationId:0, senderId:e, content:a, ...})

// WhatsApp Official plantillas: CH(connectionId, userId, companyId, to, name, lang, comps, isFromBot=false)
// offset ~822610
{... externalId:b, senderId:t, senderType:"user", sentAt:new Date}
```

Para el canal Baileys, `av` (`sendMediaMessage`) además **carga el usuario 1 de
la base de datos y comprueba sus permisos**, lo que confirma sin ambigüedad la
semántica del parámetro:

```js
// offset 481805
async function av(r,t,e,n,a,s,o,i=!1,c){
  let l=await p.getChannelConnection(r); if(!l) throw new Error("Connection not found");
  let u=await p.getUser(t); if(!u) throw new Error("User not found");
  if(!await Ty(u,l,c,r)) throw new Error("You do not have permission to access this connection");
```

### Rutas afectadas, con el detalle exacto por canal

| Ruta v1 | Canal | Valor escrito en el autor |
|---|---|---|
| `/messages/send` | whatsapp (Baileys), whatsapp_official, whatsapp_meta, twilio_sms, instagram, tiktok, email | `sender_id = 1` |
| `/messages/send` | telegram | `sender_id = 1` (literal en el `createMessage` de la propia capa v1) |
| `/messages/send` | messenger | `sender_id = channel_connections.user_id` (dueño del canal, tampoco la API key) |
| `/messages/send` | webchat | `senderId: void 0`, `senderType:"user"` — sin autor |
| `/messages/send-batch` | todos | idéntico: reutiliza `XL.sendMessage` en bucle |
| `/messages/send-media` | whatsapp (Baileys), whatsapp_meta, telegram, instagram, twilio_sms, tiktok, email | `sender_id = 1` |
| `/messages/send-media` | whatsapp_official | **`sender_id = NULL`, `sender_type = NULL`, `is_from_bot = true`** — ver nota |
| `/messages/send-media` | messenger | `channel_connections.user_id` |
| `/messages/send-template` | whatsapp_official (único soportado) | `sender_id = 1` |
| `/messages/send-interactive` | whatsapp_official (único soportado) | `sender_id = 1` |

Nota sobre el caso whatsapp_official + `send-media`: la capa v1 invoca
`rr.sendMedia(..., void 0, !0)`. Ese último `true` es el parámetro `l` de `AH`
(`sendWhatsAppBusinessMediaMessage`), que el motor usa a la vez como bandera de
simulación de tecleo (`Lv` = `simulateTyping`) y como bandera de "mensaje de
bot". Resultado en la inserción:

```js
let F={conversationId:R.id, senderId:l?null:t, senderType:l?null:"user",
       content:o||`[${a.toUpperCase()}]`, type:a, direction:"outbound",
       status:"sent", isFromBot:l, mediaUrl:oH(s)||s, ...}
```

Es decir: en el canal principal de esta empresa, un envío de media por API no se
atribuye al usuario 1 sino que **se marca como mensaje de bot sin autor**. Si el
objetivo es "cada envío atribuido a su integración", este caso y el del usuario 1
son dos problemas distintos con dos arreglos distintos.

Para contraste, las rutas internas de sesión sí atribuyen bien
(`w.user.id`, offsets ~4136762, ~4150686, ~4153486). El defecto es exclusivo de
la capa `/api/v1`.

### Qué haría falta para la reparación (fuera del alcance de esta auditoría)

El arreglo es pequeño y localizado: `lX` ya tiene `o.userId` en la mano; bastaría
propagarlo (`r.userId=o.userId`), aceptarlo en los cuatro métodos de `XL` y
sustituir los literales. Son ~14 puntos de sustitución en dos métodos más las dos
variables `o=1`. No lo hemos tocado: el archivo es un bundle minificado en
producción y esta auditoría es de solo observación.

### Confianza: **ALTA**

El código es explícito, el bundle coincide byte a byte con producción, y las dos
comprobaciones negativas (`apiKey.userId` y `req.userId` con cero apariciones en
4,4 MB) descartan la existencia de una ruta alternativa que sí derive el autor.

Lo único no verificado empíricamente: que el usuario `1` exista y sea el que se
ve en la interfaz. Para elevar eso haría falta una consulta de solo lectura a
`users` — no se hizo por la restricción de no tocar la base de datos.

---

## PREGUNTA 2 — Semántica de etapas (`stage` vs `stage_id`)

### Respuesta directa

El CRM **lee `stage_id` y prácticamente no lee `stage`**. El texto `stage` es una
columna heredada que se escribe casi siempre, se consulta casi nunca, y se
alimenta de un mapeo por subcadenas que con los nombres de etapa reales de esta
empresa ("Arrived", "Envio prop") colapsa todo a `"lead"`. Sí existe lógica de
mapeo, en dos variantes distintas e incoherentes entre sí.

**Conclusión práctica: nuestra API debe escribir `stage_id` y `stage` a la vez,
replicando literalmente el mapeador del motor, y no debe escribir `stage` nunca
por su cuenta.** El detalle está al final de esta sección.

### El esquema

```js
// dist/index.js ~offset 183628
nt=Ue("deals",{
  id:$e("id").primaryKey(),
  pipelineId:G("pipeline_id").notNull().references(()=>An.id,{onDelete:"restrict"}),
  companyId:G("company_id").references(()=>be.id),
  contactId:G("contact_id").notNull().references(()=>V.id),
  title:j("title").notNull(),
  stageId:G("stage_id").references(()=>hn.id),
  stage:j("stage",{enum:["lead","qualified","contacted","demo_scheduled","proposal",
                         "negotiation","closed_won","closed_lost"]}).notNull().default("lead"),
  ...
},r=>[vr("idx_deals_company_pipeline_status").on(r.companyId,r.pipelineId,r.status),
      vr("idx_deals_company_pipeline_stage").on(r.companyId,r.pipelineId,r.stageId)])
```

Dos señales ya aquí: `stage_id` es anulable pero es lo que está indexado (el
índice llamado `..._stage` indexa `stageId`), y `stage` es `NOT NULL DEFAULT
'lead'` con restricción de valores (el manejador de errores del alta menciona
`deals_stage_check`, la comprobación equivalente en la base de datos).

### Qué se lee

En 4,4 MB de bundle, la columna de texto `nt.stage` aparece en **dos** sitios:

```js
// 1) offset ~2183100 — el único filtro por texto que existe
async getDealsByStage(t){ return D.select().from(nt).where(C(nt.stage,t)).orderBy(st(nt.lastActivityAt)) }

// 2) offset ~2207700 — proyección de getDeals; solo se devuelve al cliente
async getDeals(t){ ... D.select({id:nt.id,...,stageId:nt.stageId,stage:nt.stage,...})
```

El primero lo usa exclusivamente `GET /api/deals/stage/:stage`. En el frontend
compilado esa URL aparece **una sola vez y como clave de caché de React Query**
(`d.invalidateQueries({queryKey:[\`/api/deals/stage/${e.stage}\`]})`), nunca como
`fetch`. La ruta está efectivamente muerta en la interfaz actual.

El filtrado real de deals es solo por `stage_id`:

```js
// buildDealFilterConditions, offset ~2204896
if(t.stageIds&&t.stageIds.length>0&&e.push(Rn(nt.stageId,t.stageIds)), ...
```

`Rn` es `inArray`. No hay ninguna condición sobre `nt.stage` en todo el
constructor de filtros.

El tablero kanban se arma por `stage_id` de principio a fin:

```js
// storage, offset ~2209887
async getDealsForPipelineBoard(t,e,n,a={}){
  let s={},o={}, i=await this.getPipelineBoardStageSummaries(t,e);
  return await Promise.all(e.map(async c=>{
    let u=await this.getDeals({...t,stageIds:[c],limit:n,offset:l}); s[c]=u; ...
  })), {dealsByStageId:s,stagePagination:o,stageSummaries:i}
}

// frontend, offset ~5795309 — fallback de agrupación en cliente
function Upt(e,t){ const a={}; for(const n of t) a[n.id]=[];
  for(const n of e) null!=n.stageId&&a[n.stageId]&&a[n.stageId].push(n); return a }
```

Consecuencia operativa que conviene tener presente: un deal con `stage_id` nulo o
apuntando a una etapa de otro pipeline **desaparece del tablero**, tenga el
`stage` de texto que tenga.

El único punto donde el texto se muestra al usuario es una línea secundaria de
resumen (`$valor • stage`) en un panel de detalle, offset ~5735622 del frontend.

### Qué se escribe cuando el usuario mueve un deal

La interfaz arrastra tarjetas contra **una sola ruta**:

```js
// frontend, offset ~5801587
ge=fb({mutationFn:async({dealId:e,stageId:t})=>
        (await VE("PATCH",`/api/deals/${e}/stageId`,{stageId:t})).json(), ...})
```

Y el diálogo de edición contra `PATCH /api/deals/${id}` con el formulario
completo (que incluye `stageId`), offset ~1145074. Búsqueda exhaustiva de
endpoints de deals en el bundle de frontend: aparece `/api/deals/${e}/stageId`,
`/api/deals/${e}/move-pipeline` y `/api/deals/${e}`; **no aparece nunca**
`PATCH /api/deals/:id/stage`.

Esa ruta `stageId` escribe **las dos columnas**, dentro de una transacción:

```js
// storage.updateDealStageId, offset ~2210165
async updateDealStageId(t,e){ return await D.transaction(async n=>{
  let[a]=await n.select().from(hn).where(C(hn.id,e));   if(!a) throw ...
  let[s]=await n.select().from(nt).where(C(nt.id,t));   if(!s) throw ...
  let o=s.stageId;
  if(a.pipelineId!==s.pipelineId) throw new Error(`Pipeline stage ${e} does not belong to deal's pipeline ${s.pipelineId}`);
  let i=this.mapPipelineStageToEnum(a.name),
     [c]=await n.update(nt).set({stageId:e, stage:i, updatedAt:new Date, lastActivityAt:new Date})
                 .where(C(nt.id,t)).returning();
  ...
  await n.insert(Uc).values({dealId:t, userId:c.assignedToUserId||1, type:"stage_change",
    content:`Deal moved to ${a.name} stage`,
    metadata:{previousStageId:o,newStageId:e,pipelineId:s.pipelineId}, createdAt:new Date});
  return c })}
```

`PATCH /api/deals/:id` también termina ahí: `storage.updateDeal` **delega** los
cambios de etapa en los métodos transaccionales en lugar de escribir la columna
directamente:

```js
// storage.updateDeal, offset ~2190583
if(e.pipelineId!==void 0||e.stageId!==void 0){
  let o=e.pipelineId??n.pipelineId, i=e.stageId??n.stageId,
      c=e.pipelineId!==void 0&&e.pipelineId!==n.pipelineId;
  if(c&&e.stageId===void 0&&o){ let[g]=await D.select().from(hn)
      .where(C(hn.pipelineId,o)).orderBy(hn.order).limit(1); g&&(i=g.id) }
  let l={...e}; delete l.pipelineId, delete l.stageId;
  let u=null;
  if(c&&o&&i ? u=await this.updateDealPipelineAndStage(t,o,i)
             : e.stageId!==void 0&&e.stageId!==null&&e.stageId!==n.stageId
               && (u=await this.updateDealStageId(t,e.stageId)), Object.keys(l).length>0){
    ...  // el resto de campos se aplica en un UPDATE posterior
```

`updateDealPipelineAndStage` (offset ~2211500) hace lo mismo para movimientos
entre pipelines: `set({pipelineId:e, stageId:n, stage:i, updatedAt, lastActivityAt})`.

### Sí hay lógica de mapeo — y hay dos, distintas

**Mapeador A**, el del motor de almacenamiento, por subcadenas y en orden:

```js
// storage.mapPipelineStageToEnum, offset ~2211100
mapPipelineStageToEnum(t){ let e=t.toLowerCase();
  return e.includes("lead")||e.includes("new")            ? "lead"
       : e.includes("qualified")||e.includes("qualify")   ? "qualified"
       : e.includes("contact")||e.includes("reach")       ? "contacted"
       : e.includes("demo")||e.includes("presentation")   ? "demo_scheduled"
       : e.includes("proposal")||e.includes("quote")      ? "proposal"
       : e.includes("negotiat")||e.includes("discuss")    ? "negotiation"
       : e.includes("won")||e.includes("closed")||e.includes("success") ? "closed_won"
       : e.includes("lost")||e.includes("reject")         ? "closed_lost"
       : "lead" }
```

**Mapeador B**, el del alta de deals, por diccionario de coincidencia exacta:

```js
// POST /api/deals, offset ~4301300
let T=q=>{ let K=q.toLowerCase().trim();
  return {lead:"lead",leads:"lead",qualified:"qualified",qualify:"qualified",
          contacted:"contacted",contact:"contacted","demo scheduled":"demo_scheduled",
          demo:"demo_scheduled",scheduled:"demo_scheduled",proposal:"proposal",
          proposals:"proposal",negotiation:"negotiation",negotiate:"negotiation",
          neg:"negotiation","closed won":"closed_won",won:"closed_won",closed:"closed_won",
          "closed lost":"closed_lost",lost:"closed_lost"}[K]||"lead" }
```

Obsérvese además que en esa ruta el campo del cuerpo llamado `stage` **no es
texto, es un identificador numérico de etapa**:

```js
let _=null, N="lead";
if(w.body.stage){ let q=parseInt(w.body.stage);
  if(!isNaN(q)){ let K=await p.getPipelineStageById(q); ... _=q; N=T(K.name) } }
let M={...w.body, companyId:f.companyId, stageId:_, stage:N, ...}
```

Si `body.stage` falta o no es numérico, el deal nace con `stage_id = NULL` y
`stage = 'lead'`.

Aplicando los dos mapeadores a los nombres reales de esta instalación:

| Nombre de etapa | Mapeador A (movimientos) | Mapeador B (alta) |
|---|---|---|
| `Arrived` | `lead` (ninguna subcadena coincide → rama por defecto) | `lead` (no está en el diccionario) |
| `Envio prop` | `lead` (`"proposal"` no es subcadena de `"envio prop"`) | `lead` |

Ahí está el mecanismo de la divergencia que se observa en los 513 deals: con
nombres de etapa en español o fuera del vocabulario inglés previsto, el texto
`stage` **no transporta información**. Colapsa a `lead` y se queda ahí.

### De dónde salen los `lead` y los `closed_won` que se ven en la tabla

Dos orígenes distintos, ambos localizados:

**a) Alta automática de oportunidades desde canal.** Nueve puntos del bundle
crean el deal con el texto fijado a mano, no mapeado:

```js
// offsets 461018, 550540, 582804, 614943, 830067, 838201, 904277, 2651914, 4065231
await p.createDeal({companyId:e, contactId:a.id, title:`New Lead - ${a.name}`,
                    pipelineId:c.pipelineId, stageId:c.id, stage:"lead"})
```

`stageId` toma la etapa configurada del pipeline, `stage` toma el literal
`"lead"` pase lo que pase. Todo deal que entra por WhatsApp, Instagram,
Messenger, Telegram, Twilio o TikTok nace ya desalineado si la primera etapa no
se llama "lead".

**b) Un fallo real en el mapeador A.** El orden de las comprobaciones hace que
`"closed"` se evalúe antes que `"lost"`:

```text
"Closed Lost"  ->  no contiene "won", pero sí contiene "closed"  ->  closed_won
```

Una etapa llamada `Closed Lost` se registra como **ganada**. Cualquier informe
que se construya sobre el texto `stage` heredará esa inversión. No es
especulación sobre el pasado: es lo que hará el código la próxima vez que alguien
mueva un deal a una etapa así.

### Inventario completo de escritores de etapa

| Escritor | `stage_id` | `stage` | Notas |
|---|---|---|---|
| `PATCH /api/deals/:id/stageId` → `updateDealStageId` | sí | sí (mapeador A) | ruta del kanban; transaccional; valida pipeline |
| `PATCH /api/deals/:id` → `updateDeal` | sí | sí (delega) | ruta del diálogo de edición |
| `POST /api/deals/:id/move-pipeline` → `updateDealPipelineAndStage` | sí | sí (mapeador A) | también `pipeline_id` |
| `POST /api/deals/bulk-move-pipeline` | sí | sí (mapeador A) | |
| `POST /api/deals/bulk-move` → `updateDealStageId` | sí | sí (mapeador A) | |
| Motor de reglas `deal-automation` (offset ~3788427) | sí | sí | usa los mismos dos métodos |
| Motor de flows (offsets ~1738765, ~1944701) | sí | sí | vía `updateDeal` / `updateDealPipelineAndStage` |
| `POST /api/deals` | sí (o `NULL`) | sí (mapeador B) | `body.stage` es un id numérico |
| Alta automática desde canal (9 sitios) | sí | **`"lead"` fijo** | origen principal del desajuste |
| **`PATCH /api/deals/:id/stage`** → `updateDealStage` | **no** | sí (crudo) | **único desincronizador; no lo usa la interfaz** |

El desincronizador aislado:

```js
// storage.updateDealStage, offset ~2192237
async updateDealStage(t,e){
  let[n]=await D.update(nt).set({stage:e, lastActivityAt:new Date, updatedAt:new Date})
                 .where(C(nt.id,t)).returning(); ... }
```

Escribe el texto y deja `stage_id` intacto. Es la ruta que hay que tratar como
prohibida.

### Conclusión práctica para nuestra API

No hay endpoint público de deals (`/api/v1` no expone ninguno) y las rutas
internas `/api/deals/*` van tras el middleware de sesión `J`, no tras API key.
Es decir: nuestra integración escribirá contra Postgres directamente, y por tanto
tiene que reproducir a mano lo que hace el motor. La recomendación es replicar
`updateDealStageId` exactamente:

1. **Validar antes de escribir.** Cargar la etapa destino y comprobar que
   `pipeline_stages.pipeline_id = deals.pipeline_id` del deal. Si difieren, el
   motor lo trata como error, no como movimiento entre pipelines. Para cambiar de
   pipeline hay que escribir también `pipeline_id`, replicando
   `updateDealPipelineAndStage`.

2. **Escribir siempre las dos columnas, en la misma transacción:**

```sql
UPDATE deals
   SET stage_id         = :stage_id,
       stage            = :stage_enum,   -- mapeador A aplicado a pipeline_stages.name
       updated_at       = now(),
       last_activity_at = now()
 WHERE id = :deal_id;
```

3. **`:stage_enum` se obtiene replicando el mapeador A literalmente**, incluido
   el orden de las comprobaciones y el caso por defecto `"lead"`. Es feo y tiene
   el fallo de `Closed Lost` descrito arriba, pero replicarlo es lo que hace que
   nuestras escrituras sean indistinguibles de las del CRM. Si en algún momento
   se decide corregir la inversión, hay que corregirla en el motor y en nuestro
   lado a la vez, nunca solo en uno.

4. **Registrar la actividad**, o el historial del deal quedará con huecos que la
   interfaz sí muestra:

```sql
INSERT INTO deal_activities (deal_id, user_id, type, content, metadata, created_at)
VALUES (:deal_id, :user_id, 'stage_change',
        'Deal moved to ' || :stage_name || ' stage',
        :json, now());
```

   El motor usa `deals.assigned_to_user_id || 1` como autor. Nosotros deberíamos
   usar el usuario real de la integración, no ese respaldo.

5. **Nunca escribir `stage` sin `stage_id`.** Es exactamente lo que hace
   `PATCH /api/deals/:id/stage` y es la única operación del sistema capaz de
   desincronizar más las dos columnas.

6. **Cuidado con enviar las dos cosas por `PATCH /api/deals/:id`**, si alguna vez
   se usa esa ruta: `updateDeal` aplica primero `stageId` (que fija el `stage`
   mapeado) y **después** escribe el resto del cuerpo, de modo que un `stage` de
   texto en el mismo `PATCH` pisa el valor mapeado. Enviar solo `stageId`.

7. **Regla de negocio adyacente que conviene respetar:** el motor impone un único
   deal activo por contacto y pipeline (`getActiveDealByContact`; `PATCH` responde
   `409` si se viola). Nuestras escrituras deberían comprobarlo antes de mover un
   deal a otro pipeline.

Sobre "no descuadrar la interfaz": escribir solo `stage_id` no descuadraría nada
visible hoy, porque el tablero, los filtros y la paginación son 100 % `stage_id`.
Pero dejaría el texto más obsoleto de lo que ya está y divergiría del
comportamiento del motor. La recomendación es escribir las dos.

### Confianza

- **ALTA** sobre qué lee el CRM, qué escribe cada ruta, cuál es la ruta del
  kanban, y qué debe escribir nuestra API. Es lectura directa de código, con las
  rutas del frontend cruzadas contra las del backend.
- **MEDIA** sobre la reconstrucción histórica de por qué los 513 deals divergen.
  El mecanismo está identificado y es suficiente para explicarlo (alta automática
  con `stage:"lead"` fijo, más dos mapeadores que colapsan a `lead` con nombres
  en español), pero no se ha verificado contra los datos.

  Para elevarlo a alta bastaría una consulta de solo lectura, que **no se ejecutó**
  por la restricción de no tocar la base de datos:

```sql
SELECT d.stage, s.name AS stage_name, count(*)
  FROM deals d LEFT JOIN pipeline_stages s ON s.id = d.stage_id
 GROUP BY 1,2 ORDER BY 3 DESC;
```

  Si la hipótesis es correcta, casi todo debería agruparse en `stage='lead'`
  repartido entre varios `stage_name`, y las filas `closed_won` deberían
  corresponder a etapas cuyo nombre contenga "closed", "won" o "success".

---

## PREGUNTA 3 — Media: ¿descarga el CRM la `mediaUrl`?

### Respuesta directa

**Depende del canal, y en los dos canales de WhatsApp la respuesta es sí.** El
motor descarga con `axios`, sigue redirecciones y **no valida la dirección de
destino en ninguna forma**. No hay resolución previa de DNS, ni fijación de
socket, ni lista de bloqueo de rangos privados, ni límite de tamaño, en la ruta
de envío.

Esto confirma —y precisa— la sospecha ya registrada en
`docs/api/MEDIA-PROXY-2026-08-13.md`. La ventana de DNS rebinding descrita allí
existe, y además el motor es más permisivo de lo que ese documento asumía: no es
solo que la descarga no sea nuestra, es que la suya no tiene ninguna defensa.

Lo único que valida la capa v1 es la forma de la cadena:

```js
// dist/index.js ~offset 3712900
nEe=sn.object({ channelId:sn.number().int().positive(), to:sn.string().min(1).max(20),
  mediaType:sn.enum(["image","video","audio","document"]),
  mediaUrl:sn.string().url(),        // <- toda la validación que existe
  caption:sn.string().max(1024).optional(), filename:sn.string().max(255).optional() })
```

`z.string().url()` acepta `http://169.254.169.254/...`, `http://10.0.0.5/...` y
cualquier nombre público con TTL bajo.

### Detalle por canal

**WhatsApp no oficial (Baileys) — descarga el motor.** `av`, offset 481805:

```js
let b=ioe(a), I;
if(b.startsWith("http://")||b.startsWith("https://"))
  try{ let z=await coe(b);
       if(z) I=z;
       else { let Y=await LN.get(b,{responseType:"arraybuffer"}); I=Buffer.from(Y.data) } }
  catch(z){ throw new Error(`Failed to download media from URL: ${b}. Error: ${z.message}`) }
```

`LN` es axios (`import LN from"axios"`, offset 414992). La llamada no lleva
`timeout`, ni `maxRedirects`, ni `maxContentLength`, ni agente con `lookup`
fijado. Se descarga a memoria completa (`arraybuffer`), sin techo de tamaño.

**WhatsApp Official — descarga el motor.** `AH`, offset 823279:

```js
if(s.startsWith("http://")||s.startsWith("https://")){ let P;
  if((()=>{try{let O=new URL(s); return O.hostname==="localhost"||O.hostname==="127.0.0.1"}catch{return!1}})()){
      let O=new URL(s).pathname||"", U=O.replace(/^\//,""),
          $=sf.resolve(process.cwd(),U), W=sf.resolve(process.cwd());
      if(!$.startsWith(W)||!await Tm.pathExists($)) throw new Error(`Local media path not allowed or file not found: ${O}`);
      P=Cle.createReadStream($) }
  else P=(await Yi.get(s,{responseType:"stream",timeout:3e4})).data;
  let R=new Ale; R.append("messaging_product","whatsapp");
  R.append("file",P,{filename:i||`media.${yM(a)}`,contentType:c||xle(a)});
  let F=await Yi.post(`${jl}/${Ul}/${h}/media`,R,{...})
```

`Yi` es axios (offset 806511). Aquí sí hay `timeout: 30000`, pero sigue sin haber
`maxRedirects`, ni validación de destino, ni límite de tamaño. El caso
`localhost`/`127.0.0.1` no es una defensa: es un atajo para leer del disco local
en vez de por red (con comprobación de prefijo de ruta, eso sí).

**Redirecciones.** En ninguna de las dos llamadas se fija `maxRedirects`. El
adaptador HTTP de axios delega en `follow-redirects` salvo que se pase
`maxRedirects === 0`:

```text
docker exec powerchat-app-bcousinoprop grep -n "maxRedirects" /app/node_modules/axios/lib/adapters/http.js
  943:  } else if (config.maxRedirects === 0) {
  947:    if (config.maxRedirects) {
  948:      options.maxRedirects = config.maxRedirects;
```

Versión instalada en el contenedor: axios `1.16.1` (el manifiesto declara
`^1.7.9`). Con `maxRedirects` sin definir se aplica el límite por defecto de
`follow-redirects`, 21 saltos. **Sí sigue redirecciones**, y por tanto un destino
que valide como público puede responder `302` hacia una dirección interna.

Que el motor *sí sabe* protegerse cuando quiere se ve en sus rutas de **entrada**
de media, que están endurecidas correctamente:

```js
// descarga de media entrante de Instagram, offset ~537342
let a=await Hoe(r), s=Goe(a.hostname,a.addresses),
    o=await Jc.get(a.parsedUrl.toString(),{responseType:"arraybuffer",
       headers:{Authorization:`Bearer ${t}`}, timeout:3e4, maxRedirects:0,
       httpAgent:new Moe.Agent({lookup:s}), httpsAgent:new Ooe.Agent({lookup:s})})

// análisis de imagen, offset ~1168779
n=await $me.get(r,{responseType:"arraybuffer", timeout:3e4,
   maxContentLength:25*1024*1024, maxBodyLength:25*1024*1024, maxRedirects:0,
   httpAgent:new Vme.Agent({lookup:e}), httpsAgent:new Wme.Agent({lookup:e}), ...})
```

Resolución previa, `lookup` fijado al conjunto validado, `maxRedirects: 0`,
límite de tamaño. Es exactamente el patrón que falta en la ruta de salida. El
endurecimiento existe en el código; simplemente no se aplicó a `send-media`.

**Canales que NO descargan** (la URL se entrega al proveedor, que descarga él):

| Canal | Comportamiento |
|---|---|
| Instagram (`pR`, offset 538143) | `message:{attachment:{type:n,payload:{url:e,is_reusable:!0}}}` — descarga Meta |
| Twilio SMS/MMS (`tue`, offset 895421) | `d.append("MediaUrl",a)` — descarga Twilio |
| Telegram (`yie`, offset 573890) | si `_G(url)` resuelve a un fichero local, lo sube; si no, manda la URL cruda a `sendPhoto`/`sendVideo`/… y descarga Telegram |
| Messenger (`HG` → `Bie`, offset 607616) | `Bie` exige `n.existsSync(t)`, es decir **una ruta de fichero local**. Como `XL` le pasa la `mediaUrl` tal cual y el esquema exige una URL, este canal **siempre falla** con "File not found" para media por API |
| Email | la `mediaUrl` acaba como texto del cuerpo (`h=s||\`Media: ${a}\``) |
| WebChat | se guarda como `mediaUrl` del mensaje |

**Detalle adicional: atajos a fichero local que ignoran el nombre de host.**
Tanto Baileys como Telegram deciden leer del disco mirando solo el *path* de la
URL, no el host:

```js
// coe (Baileys), offset 438604 — con protección de traversal
async function coe(r){ try{ let e=new URL(r).pathname;
  if(!e.startsWith("/media/")) return null;
  let n=e.split("/").filter(Boolean);
  if(n.some(c=>c==="."||c==="..")) return null;
  let a=In.join(process.cwd(),"public",...n), s=In.resolve(process.cwd(),"public"), o=In.resolve(a);
  return !o.startsWith(s+In.sep)&&o!==s || !(await fs.stat(o).catch(()=>null))?.isFile()
       ? null : await fs.readFile(o) }catch{return null} }

// _G (Telegram), offset 565113 — sin comprobación explícita de traversal
function _G(r){ let t=""; try{ r.startsWith("/")?t=new URL(r,"http://localhost").pathname:t=new URL(r).pathname }catch{return null}
  let e=null;
  if(t.startsWith("/media/flow-media/")){ ... e=ud.join(process.cwd(),"uploads","flow-media",n) }
  else if(t.startsWith("/uploads/")){ let n=t.slice(9); ... e=ud.join(process.cwd(),"uploads",n) }
  else if(t.startsWith("/media/")){ let n=t.slice(7); ... e=ud.join(process.cwd(),"public","media",n) }
  return !e||!Pw.existsSync(e)?null:e }
```

Consecuencia: `https://cdn.de-un-tercero.example/media/loquesea.png` no se
descarga de ese CDN; se busca en el disco del CRM. Es más una fuente de
confusión que de riesgo. En `_G` no hay filtro de `..` explícito; la
normalización del parser WHATWG de `URL` colapsa los `..` literales antes de
llegar al `join`, así que **no** se ha podido construir un caso de traversal
sobre el papel, pero el contraste con `coe` (que sí filtra) sugiere que la
protección aquí es accidental y no deliberada. No se ha probado en ejecución.

**Contexto útil para el diseño de nuestro proxy:** `POST /api/v1/media/upload`
devuelve una URL propia del CRM:

```js
// offset 3717721
let e=`${jo(r)}/uploads/api/${kh.basename(r.file.path)}`
```

Ese path (`/uploads/...`) activa el atajo local de Telegram pero **no** el de
Baileys (que solo reconoce `/media/`), de modo que en Baileys el CRM se descarga
a sí mismo por HTTP. Vale la pena tenerlo en cuenta si se decide alojar la media
bajo un prefijo concreto.

### Confianza: **ALTA**

Las llamadas de descarga están citadas literalmente, la versión de axios se
comprobó dentro del contenedor en marcha, y el comportamiento de redirección se
verificó leyendo el adaptador instalado en lugar de asumir el valor por defecto
de la librería.

Queda sin verificar empíricamente el comportamiento extremo (qué ocurre
exactamente con una cadena de 21 redirecciones, o con un cuerpo de varios GB).
Eso requeriría ejercitar `send-media` contra un destino controlado en staging.
No se hizo: hacerlo aquí habría implicado abrir un canal de WhatsApp, que está
explícitamente excluido de esta auditoría.

---

## PREGUNTA 4 — Hash de la API key

### Respuesta directa

**Solo los 64 caracteres posteriores a `pcp_`.** Coincide exactamente con
`sha256(rawKey.slice(4))`. Confirmado.

### Evidencia

Las tres funciones están juntas, offset ~2722030:

```js
import BC from "crypto";

// generación
function cX(){
  let r=BC.randomBytes(32).toString("hex"),          // 64 caracteres hex
      t=BC.createHash("sha256").update(r).digest("hex"),  // hash SOBRE r, sin prefijo
      e=r.substring(0,8);
  return {key:`pcp_${r}`, hash:t, prefix:e} }

// verificación
function QTe(r){
  let t=r.startsWith("pcp_")?r.substring(4):r;
  return BC.createHash("sha256").update(t).digest("hex") }

// formato
function ZTe(r){ return /^pcp_[a-f0-9]{64}$/.test(r) }
```

Los dos lados son coherentes entre sí: `cX` produce el hash del cuerpo sin
prefijo, y `QTe` lo retira antes de calcular. `substring(4)` es literalmente
`slice(4)` para una cadena que ya pasó el `test` de formato.

Uso en el middleware, offset ~2722700:

```js
let a=n.substring(7);                        // quita "Bearer "
if(!ZTe(a)) return t.status(401).json({error:"API_KEY_INVALID_FORMAT",...});
let s=QTe(a), o=await p.getApiKeyByHash(s);
if(!o) return t.status(401).json({error:"API_KEY_NOT_FOUND",...});
```

Tres detalles secundarios que conviene registrar porque afectan a cualquier
generador de claves compatible que escribamos:

- `QTe` degrada silenciosamente: sin el prefijo, hashea la cadena entera. En el
  camino de autenticación eso es inalcanzable porque `ZTe` ya rechazó lo que no
  encaje en `^pcp_[a-f0-9]{64}$`, pero no hay que apoyarse en ese fallback.
- El `key_prefix` que se almacena son los **8 primeros caracteres del hex**, no
  `"pcp_"` ni `"pcp_" + 4`. Es decir, `rawKey.slice(4, 12)`.
- Codificación: `update(t)` sin segundo argumento, que en Node es UTF-8. Como la
  cadena es hex ASCII, UTF-8 y ASCII coinciden byte a byte; no hay ambigüedad.

Comprobación equivalente en una línea, para quien quiera reproducirla con una
clave de prueba propia (nunca con una real):

```js
crypto.createHash('sha256').update(rawKey.slice(4)).digest('hex') === storedKeyHash
```

### Confianza: **ALTA**

Generación y verificación son visibles y mutuamente consistentes, y la ruta de
autenticación completa está trazada desde la cabecera `Authorization` hasta la
consulta `getApiKeyByHash`. No queda nada por elevar.

---

## Resumen de confianza

| Pregunta | Respuesta | Confianza |
|---|---|---|
| 1. Autoría de envíos | Literal `1` incrustado; las 4 rutas y todos los canales; nunca se deriva de la API key | Alta |
| 2. Semántica de etapas | Se lee `stage_id`; `stage` es texto heredado con dos mapeadores incoherentes; escribir ambas replicando el mapeador A | Alta (código) / Media (causa histórica en los 513 deals) |
| 3. Media | Sí descarga en ambos WhatsApp, con axios, sigue redirecciones, sin validar destino | Alta |
| 4. Hash de API key | `sha256(rawKey.slice(4))`, confirmado | Alta |

## Anexo: hallazgos colaterales

No se buscaban, pero salieron al paso y están documentados arriba con su cita:

1. `mapPipelineStageToEnum` traduce una etapa llamada `Closed Lost` a
   `closed_won`, porque comprueba `"closed"` antes que `"lost"`.
2. `send-media` sobre whatsapp_official marca el mensaje como de bot
   (`sender_id = NULL`, `is_from_bot = true`) en lugar de atribuirlo.
3. `send-media` sobre messenger no puede funcionar: la capa de subida exige una
   ruta de fichero local y el esquema v1 exige una URL.
4. `QL.sendMessage` (whatsapp_meta) inserta el mensaje con `conversationId: 0`.
5. `updateDealStageId` registra la actividad con `assigned_to_user_id || 1`, otro
   uso del usuario 1 como respaldo.
6. Las descargas de media del motor de flows (offset ~1508569,
   `vc.get(a,{responseType:"arraybuffer"})`) comparten la falta de validación
   descrita en la pregunta 3.

Ninguno se corrigió. Esta auditoría no modificó nada fuera de este documento, y
no se hizo commit.
