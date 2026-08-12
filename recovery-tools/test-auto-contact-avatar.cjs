const fs = require("fs");
const path = require("path");
const assert = require("assert");

const filePath = path.resolve(__dirname, "..", "dist", "index.js");
const source = fs.readFileSync(filePath, "utf8");

assert(
  source.includes('r.post("/api/contacts",J,rs,Bt(ce.CREATE_CONTACTS),async(w,m)=>{try{'),
  "create contact route not found"
);

assert(
  source.includes("Error auto-syncing contact profile picture:"),
  "automatic contact avatar sync block is missing"
);

assert(
  source.includes("await p.getChannelConnections(w.user.companyId)"),
  "company WhatsApp connection lookup is missing"
);

assert(
  source.includes("await Gt.fetchProfilePicture(q.id,N,!0)"),
  "WhatsApp profile picture fetch is missing"
);

console.log("auto contact avatar sync regression check passed");
