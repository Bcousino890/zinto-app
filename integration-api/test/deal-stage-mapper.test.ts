import { describe, expect, it } from "vitest";

import { mapPipelineStageToEnum } from "../src/resources/pipeline-mutations.js";

/**
 * El mapeador es una replica literal del motor compilado, fallo incluido. Este
 * archivo fija ese comportamiento para que nadie lo "arregle" sin darse cuenta
 * de que arreglarlo aqui solo nos separaria mas del CRM.
 */
describe("legacy stage mapper", () => {
  it("reproduces the Closed Lost inversion of the legacy engine on purpose", () => {
    // "closed" se comprueba antes que "lost": el motor registra la etapa como
    // ganada. Corregirlo aqui sin corregirlo en el motor seria divergir.
    expect(mapPipelineStageToEnum("Closed Lost")).toBe("closed_won");
  });

  it("falls back to lead for stage names outside the English vocabulary", () => {
    expect(mapPipelineStageToEnum("Arrived")).toBe("lead");
    // "proposal" no es subcadena de "envio prop": no coincide ninguna rama.
    expect(mapPipelineStageToEnum("Envio prop")).toBe("lead");
    expect(mapPipelineStageToEnum("")).toBe("lead");
  });

  it("maps one name per branch, in the order the engine checks them", () => {
    expect(mapPipelineStageToEnum("New Lead")).toBe("lead");
    expect(mapPipelineStageToEnum("Nuevo")).toBe("lead");
    expect(mapPipelineStageToEnum("Qualified")).toBe("qualified");
    expect(mapPipelineStageToEnum("Qualify first")).toBe("qualified");
    expect(mapPipelineStageToEnum("Contacted")).toBe("contacted");
    expect(mapPipelineStageToEnum("Reach out")).toBe("contacted");
    expect(mapPipelineStageToEnum("Demo")).toBe("demo_scheduled");
    expect(mapPipelineStageToEnum("Presentation booked")).toBe("demo_scheduled");
    expect(mapPipelineStageToEnum("Proposal sent")).toBe("proposal");
    expect(mapPipelineStageToEnum("Quote sent")).toBe("proposal");
    expect(mapPipelineStageToEnum("Negotiation")).toBe("negotiation");
    expect(mapPipelineStageToEnum("Discussing terms")).toBe("negotiation");
    expect(mapPipelineStageToEnum("Won")).toBe("closed_won");
    expect(mapPipelineStageToEnum("Success")).toBe("closed_won");
    expect(mapPipelineStageToEnum("Lost")).toBe("closed_lost");
    expect(mapPipelineStageToEnum("Rejected")).toBe("closed_lost");
  });

  it("keeps the earlier branch when a name matches two of them", () => {
    // "Lead qualified" contiene "lead" y "qualified": gana la primera rama.
    expect(mapPipelineStageToEnum("Lead qualified")).toBe("lead");
    // "Demo proposal" contiene "demo" y "proposal": gana "demo".
    expect(mapPipelineStageToEnum("Demo proposal")).toBe("demo_scheduled");
  });

  it("is case insensitive", () => {
    expect(mapPipelineStageToEnum("CLOSED LOST")).toBe("closed_won");
    expect(mapPipelineStageToEnum("nEgOtIaTiNg")).toBe("negotiation");
    expect(mapPipelineStageToEnum("LOST")).toBe(mapPipelineStageToEnum("lost"));
  });
});
