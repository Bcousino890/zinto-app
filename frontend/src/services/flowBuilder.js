import api from "./api";
import FileSaver from "file-saver";

// Exporta fluxo como .zip
export const exportFlow = async (flowId) => {
  const { data } = await api.get(`/flowbuilder/export/${flowId}`, {
    responseType: "blob"
  });
  const blob = new Blob([data], { type: "application/zip" });
  FileSaver.saveAs(blob, `flow-${flowId}.zip`);
};

// Importa fluxo .zip e retorna flowId novo
export const importFlow = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post("/flowbuilder/import", formData);
  return data; // { flowId: "..." }
};
