/**
 * Guarda o token de sessão no navegador e o anexa às chamadas da API.
 *
 * Por que não depender só de cookies? Quando o app é exibido dentro de um
 * iframe (como no painel de prévia), o navegador considera as requisições
 * "cross-site" e descarta cookies SameSite=Lax — o login parece funcionar,
 * mas a chamada seguinte volta 401. O cabeçalho Authorization não sofre
 * dessa restrição.
 *
 * Ordem de armazenamento: localStorage → sessionStorage → memória.
 */

const STORAGE_KEY = "fluxo.session.token";
let memoryToken: string | null = null;

function availableStorages(): Storage[] {
  if (typeof window === "undefined") return [];
  const list: Storage[] = [];
  try {
    if (window.localStorage) list.push(window.localStorage);
  } catch {
    /* acesso bloqueado */
  }
  try {
    if (window.sessionStorage) list.push(window.sessionStorage);
  } catch {
    /* acesso bloqueado */
  }
  return list;
}

export function getSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  for (const storage of availableStorages()) {
    try {
      const value = storage.getItem(STORAGE_KEY);
      if (value) {
        memoryToken = value;
        return value;
      }
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

export function setSessionToken(token: string) {
  memoryToken = token;
  for (const storage of availableStorages()) {
    try {
      storage.setItem(STORAGE_KEY, token);
      return;
    } catch {
      /* tenta o próximo */
    }
  }
}

export function clearSessionToken() {
  memoryToken = null;
  for (const storage of availableStorages()) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignora */
    }
  }
}

/** `fetch` autenticado; o token explícito em memória tem prioridade sobre storage. */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}, tokenOverride?: string | null) {
  const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
  const token = tokenOverride ?? getSessionToken();
  if (token && !requestHeaders.has("Authorization")) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }
  // Headers não possui propriedades enumeráveis. Um objeto simples preserva os
  // cabeçalhos também em integrações de prévia que serializam RequestInit.
  const serializableHeaders: Record<string, string> = {};
  requestHeaders.forEach((value, key) => { serializableHeaders[key] = value; });
  return fetch(input, { ...init, headers: serializableHeaders, credentials: "include" });
}
