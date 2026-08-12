from pathlib import Path

file_path = Path(__file__).resolve().parent.parent / "dist" / "index.js"
source = file_path.read_text()

old = (
    'let T=await p.getOrCreateContact(v);await Lu({companyId:w.user.companyId,contactId:T.id,'
    'userId:w.user.id,actionType:"created",actionCategory:"contact",description:`Contact created: '
    '${T.name}`,newValues:{name:T.name,email:T.email,phone:T.phone,company:T.company},ipAddress:w.ip,'
    'userAgent:w.get("User-Agent")});try{if(await Xs(w.user.companyId,"autoAddContactToPipeline"))'
    '{let N=await ko(w.user.companyId);if(N&&!await p.getActiveDealByContact(T.id,w.user.companyId,'
    'N.pipelineId)){let L=await p.createDeal({companyId:w.user.companyId,contactId:T.id,title:`New '
    'Lead - ${T.name}`,pipelineId:N.pipelineId,stageId:N.id,stage:"lead"});await '
    'p.createDealActivity({dealId:L.id,userId:w.user.id,type:"create",content:"Deal automatically '
    'created when contact was added"})}}}catch(_){console.error("Error auto-adding contact to '
    'pipeline:",_)}if(!w.user.isSuperAdmin&&(await ln(w.user))[ce.VIEW_CONTACT_PHONE]!==!0)return '
    'm.status(201).json({...T,phone:null,identifier:null});m.status(201).json(T)}catch(f){'
    'm.status(400).json({message:f.message})}});'
)

new = (
    'let T=await p.getOrCreateContact(v);try{if(!T.avatarUrl){let N=T.identifier||T.phone||null,'
    'M=T.identifierType==="whatsapp"||T.identifierType==="whatsapp_unofficial"||T.source==="whatsapp";'
    'if(M&&N){let L=(await p.getChannelConnections(w.user.companyId)).filter(q=>(q.channelType==='
    '"whatsapp"||q.channelType==="whatsapp_unofficial")&&q.status==="active").sort((q,K)=>'
    '(K.userId===w.user.id?1:0)-(q.userId===w.user.id?1:0)),q=L.find(K=>Gt.isConnectionActive(K.id));'
    'if(q){let K=await Gt.fetchProfilePicture(q.id,N,!0);K&&(T=await p.updateContact(T.id,{avatarUrl:K}))'
    '}}}}catch(N){console.error("Error auto-syncing contact profile picture:",N)}await Lu({companyId:'
    'w.user.companyId,contactId:T.id,userId:w.user.id,actionType:"created",actionCategory:"contact",'
    'description:`Contact created: ${T.name}`,newValues:{name:T.name,email:T.email,phone:T.phone,'
    'company:T.company},ipAddress:w.ip,userAgent:w.get("User-Agent")});try{if(await '
    'Xs(w.user.companyId,"autoAddContactToPipeline")){let N=await ko(w.user.companyId);if(N&&!await '
    'p.getActiveDealByContact(T.id,w.user.companyId,N.pipelineId)){let L=await p.createDeal({companyId:'
    'w.user.companyId,contactId:T.id,title:`New Lead - ${T.name}`,pipelineId:N.pipelineId,stageId:N.id,'
    'stage:"lead"});await p.createDealActivity({dealId:L.id,userId:w.user.id,type:"create",content:'
    '"Deal automatically created when contact was added"})}}}catch(_){console.error("Error auto-adding '
    'contact to pipeline:",_)}if(!w.user.isSuperAdmin&&(await ln(w.user))[ce.VIEW_CONTACT_PHONE]!==!0)'
    'return m.status(201).json({...T,phone:null,identifier:null});m.status(201).json(T)}catch(f){'
    'm.status(400).json({message:f.message})}});'
)

if old not in source:
    raise SystemExit("target block not found")

file_path.write_text(source.replace(old, new, 1))
print("patched")
