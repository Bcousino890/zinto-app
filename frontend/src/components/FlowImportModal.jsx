import React, { useState, useRef } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { CircularProgress } from "@material-ui/core";
import { importFlow } from "../services/flowBuilder";
import { toast } from "react-toastify";
import { useHistory } from "react-router-dom";

const FlowImportModal = ({ open, onClose }) => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const history = useHistory();
  
  const inputFileRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleImport = async () => {
    if (!file) {
      toast.error("Selecione um arquivo .zip");
      return;
    }
    try {
      setLoading(true);
      const { flowId } = await importFlow(file);
      toast.success("Fluxo importado com sucesso!");
      onClose();
      history.push(`/flowbuilder/${flowId}`);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao importar fluxo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Importar fluxo</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography>Selecione um arquivo .zip exportado pelo Flowbuilder.</Typography>
          <Stack direction="row" alignItems="center" spacing={2}>
            {/* SOLUÇÃO: Usando a variável CSS global --primaryColor */}
            <Button
              variant="contained"
              onClick={() => inputFileRef.current.click()}
              sx={{
                backgroundColor: "var(--primaryColor)",
                "&:hover": {
                  backgroundColor: "var(--primaryColor)",
                  filter: "brightness(0.9)",
                },
              }}
            >
              Escolher arquivo
            </Button>
            <Typography variant="body2" color="textSecondary">
              {file ? file.name : "Nenhum arquivo escolhido"}
            </Typography>
            <input
              ref={inputFileRef}
              type="file"
              accept=".zip"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="outlined" color="secondary">
          Cancelar
        </Button>
        {/* SOLUÇÃO: Usando a variável CSS global --primaryColor */}
        <Button
          onClick={handleImport}
          variant="contained"
          disabled={loading || !file}
          sx={{
            backgroundColor: "var(--primaryColor)",
            "&:hover": {
              backgroundColor: "var(--primaryColor)",
              filter: "brightness(0.9)",
            },
            "&.Mui-disabled": {
              backgroundColor: 'rgba(0, 0, 0, 0.12)'
            }
          }}
        >
          {loading ? <CircularProgress size={24} color="inherit" /> : "Importar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FlowImportModal;