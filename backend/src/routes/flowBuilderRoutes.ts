import express from "express";
import isAuth from "../middleware/isAuth";

import multer from "multer";
import uploadConfig from "../config/uploadExt";

import * as FlowBuilderController from "../controllers/FlowBuilderController";

// Exportação já existente
import FlowExportController from "../controllers/FlowExportController";

// ---------- FIX: importação ----------
import FlowImportController from "../controllers/FlowImportController";
// --------------------------------------

const upload = multer(uploadConfig);
const uploadMemory = multer();        // usado para import (buffer em memória)

const flowBuilder = express.Router();

flowBuilder.post("/flowbuilder", isAuth, FlowBuilderController.createFlow);
flowBuilder.put("/flowbuilder", isAuth, FlowBuilderController.updateFlow);

flowBuilder.delete(
  "/flowbuilder/:idFlow",
  isAuth,
  FlowBuilderController.deleteFlow
);

flowBuilder.get("/flowbuilder", isAuth, FlowBuilderController.myFlows);
flowBuilder.get("/flowbuilder/:idFlow", isAuth, FlowBuilderController.flowOne);

// Rota para exportar um fluxo específico como .zip
flowBuilder.get(
  "/flowbuilder/export/:id",
  isAuth,
  FlowExportController
);

// ---------- FIX: rota de importação (.zip) ----------
flowBuilder.post(
  "/flowbuilder/import",
  isAuth,
  uploadMemory.single("file"),  // recebe o arquivo zip em buffer
  FlowImportController
);
// ----------------------------------------------------

flowBuilder.post(
  "/flowbuilder/flow",
  isAuth,
  FlowBuilderController.FlowDataUpdate
);

flowBuilder.post(
  "/flowbuilder/duplicate",
  isAuth,
  FlowBuilderController.FlowDuplicate
);

flowBuilder.get(
  "/flowbuilder/flow/:idFlow",
  isAuth,
  FlowBuilderController.FlowDataGetOne
);

flowBuilder.post(
  "/flowbuilder/img",
  isAuth,
  upload.array("medias"),
  FlowBuilderController.FlowUploadImg
);

flowBuilder.post(
  "/flowbuilder/audio",
  isAuth,
  upload.array("medias"),
  FlowBuilderController.FlowUploadAudio
);

flowBuilder.post(
  "/flowbuilder/content",
  isAuth,
  upload.array("medias"),
  FlowBuilderController.FlowUploadAll
);

export default flowBuilder;
