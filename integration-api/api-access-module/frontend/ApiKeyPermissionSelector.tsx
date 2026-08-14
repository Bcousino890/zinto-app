import { useMemo, useState, type FormEvent } from "react";

import { CATALOG } from "./catalog.js";
import { buildCreateRequest, permissionGroups } from "./permission-model.js";
import type {
  ApiKeyCreateRequest,
  ApiKeyCreateResponse,
  PermissionId,
  PermissionProfileId
} from "./types.js";

export interface ApiKeyPermissionSelectorProps {
  createApiKey: (request: ApiKeyCreateRequest) => Promise<ApiKeyCreateResponse>;
  onCreated?: (response: ApiKeyCreateResponse) => void;
}

export function ApiKeyPermissionSelector({ createApiKey, onCreated }: ApiKeyPermissionSelectorProps) {
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<PermissionProfileId | "">("");
  const [selected, setSelected] = useState<PermissionId[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiKeyCreateResponse | null>(null);
  const groups = useMemo(() => permissionGroups(), []);

  function toggle(permission: PermissionId) {
    setProfile("");
    setSelected((current) => current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const response = await createApiKey(buildCreateRequest(name, {
        profile: profile || undefined,
        permissions: selected
      }));
      setCreated(response);
      onCreated?.(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la clave");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Crear clave API">
      <label>
        Nombre de la clave
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>

      <fieldset>
        <legend>Perfil predefinido</legend>
        <select value={profile} onChange={(event) => {
          const next = event.target.value as PermissionProfileId | "";
          setProfile(next);
          setSelected([]);
        }}>
          <option value="">Personalizado</option>
          {CATALOG.profiles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </fieldset>

      <fieldset disabled={Boolean(profile)}>
        <legend>Permisos personalizados</legend>
        {groups.map((group) => (
          <section key={group} aria-labelledby={`permission-group-${group}`}>
            <h3 id={`permission-group-${group}`}>{group}</h3>
            {CATALOG.permissions.filter((item) => item.group === group).map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={() => toggle(item.id)}
                />
                {item.label}
                <small>{item.description}</small>
              </label>
            ))}
          </section>
        ))}
      </fieldset>

      <p aria-live="polite">{profile ? `Perfil seleccionado: ${profile}` : `${selected.length} permisos seleccionados`}</p>
      {error && <p role="alert">{error}</p>}
      {created && <p role="status">Clave creada. Copia el secreto ahora; no se volverá a mostrar.</p>}
      <button type="submit" disabled={busy}>{busy ? "Creando..." : "Crear clave API"}</button>
    </form>
  );
}

export function createApiKeyRequest(baseUrl: string, request: ApiKeyCreateRequest, fetchImpl = fetch) {
  return fetchImpl(`${baseUrl}/api/settings/api-keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  }).then(async (response) => {
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`No se pudo crear la clave (HTTP ${response.status})`);
    return body as ApiKeyCreateResponse;
  });
}
