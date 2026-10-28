import { normalizeBootstrap } from "./normalize";
// PropertyPortal mobile API client. All calls go through the PropertyPortal server.
// Auth = Supabase access token (Bearer) verified by the server.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

function endpoint(name: string, configured: string | undefined, developmentFallback: string, secureProtocol: "https:" | "wss:") {
  const value = configured || (__DEV__ ? developmentFallback : "");
  if (!value) throw new Error(`${name} is required; production builds never fall back to localhost`);
  const url = new URL(value);
  if (!__DEV__) {
    if (url.protocol !== secureProtocol) throw new Error(`${name} must use ${secureProtocol} in production`);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error(`${name} cannot point to localhost in production`);
  }
  return url.origin;
}

const API_BASE = endpoint("EXPO_PUBLIC_API_BASE", process.env.EXPO_PUBLIC_API_BASE, "http://localhost:4317", "https:");
const WS_BASE = endpoint("EXPO_PUBLIC_WS_BASE", process.env.EXPO_PUBLIC_WS_BASE, "ws://localhost:4317", "wss:");
const CLIENT_RELEASE_ID = process.env.EXPO_PUBLIC_RELEASE_ID || "development-local";

const TOKEN_KEY = "property-portal.session";

export type StoredSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tenantId?: string;
  email?: string;
};

let currentToken: string | null = null;
// Web preview keeps credentials only in memory; native builds use the device keychain.
let webSession: StoredSession | null = null;
const tokenListeners = new Set<(t: string | null) => void>();

export function setAccessToken(token: string | null) {
  currentToken = token;
  for (const fn of tokenListeners) fn(currentToken);
}
export function getAccessToken() { return currentToken; }
export function onAccessTokenChange(fn: (t: string | null) => void) {
  tokenListeners.add(fn);
  return () => tokenListeners.delete(fn);
}

export async function saveSession(session: StoredSession) {
  if (Platform.OS === "web") { webSession = session; setAccessToken(session.accessToken); return; }
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  setAccessToken(session.accessToken);
}

export async function readSession(): Promise<StoredSession | null> {
  if (Platform.OS === "web") return webSession;
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    setAccessToken(parsed.accessToken);
    return parsed;
  } catch {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return null;
  }
}

export async function clearSession() {
  webSession = null;
  if (Platform.OS !== "web") await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  setAccessToken(null);
}

async function request<T = any>(
  method: string,
  path: string,
  { body, query, headers = {} as Record<string, string>, raw = false }: any = {},
): Promise<T> {
  const url = new URL(API_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.append(k, String(v));
    }
  }
  const finalHeaders: Record<string, string> = { Accept: "application/json", "X-Property-Portal-Client": "mobile", "X-Property-Portal-Version": CLIENT_RELEASE_ID, ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (currentToken) finalHeaders["Authorization"] = `Bearer ${currentToken}`;

  const res = await fetch(url.toString(), {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (raw) return res as unknown as T;
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const message = (isJson && payload && (payload.error || payload.message)) || `HTTP ${res.status}`;
    const err: any = new Error(message);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload as T;
}

export const api = {
  // Public
  listBuildings: () => request("GET", "/api/public/buildings").then((r) => r.buildings || r),

  // Auth
  register: (payload: {
    name: string; email: string; password: string; phone?: string;
    buildingId: string; unit?: string;
  }) => request("POST", "/api/auth/tenant/register", { body: payload }),

  login: (email: string, password: string) =>
    request("POST", "/api/auth/tenant/login", { body: { email, password } }),

  refresh: (refreshToken: string) =>
    request("POST", "/api/auth/tenant/refresh", { body: { refresh_token: refreshToken } }),

  me: () => request("GET", "/api/auth/tenant/me"),
  accountDeletionStatus: () => request("GET", "/api/auth/tenant/account-deletion"),
  requestAccountDeletion: () => request("POST", "/api/auth/tenant/account-deletion", { body: { confirmation: "DELETE MY ACCOUNT" } }),
  cancelAccountDeletion: () => request("DELETE", "/api/auth/tenant/account-deletion"),

  // Mobile data
  bootstrap: () => request("GET", "/api/mobile/bootstrap").then(normalizeBootstrap),
  submitRequest: (payload: any) => request("POST", "/api/mobile/maintenance-requests", { body: payload }),
  listTickets: () => api.bootstrap().then((r) => r.tickets),
  getTicket: (id: string) => api.bootstrap().then((r) => { const ticket = r.tickets.find((t: any) => t.id === id); if (!ticket) throw new Error("Ticket not found"); return ticket; }),
  postTicketMessage: (id: string, message: string) =>
    request("POST", `/api/mobile/maintenance-requests/${id}/messages`, { body: { message } }),
  listDocuments: () => api.bootstrap().then((r) => r.documents),
  submitQualityReport: (payload: any) => request("POST", "/api/mobile/quality-reports", { body: payload }),
  listBroadcasts: () => api.bootstrap().then((r) => r.broadcasts),
  ackBroadcast: (id: string) => request("POST", `/api/mobile/broadcasts/${id}/dismiss`),
  registerPushToken: (token: string, platform: string) =>
    request("POST", "/api/mobile/push-token", { body: { token, platform } }),
};

// WebSocket for tenant chat
export function openTenantSocket(
  token: string,
  handlers: { onMessage?: (msg: any) => void; onOpen?: () => void; onClose?: () => void; onError?: (e: any) => void } = {},
) {
  const ws = new WebSocket(`${WS_BASE}/ws`);
  let alive = true;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "auth", kind: "tenant", token }));
    handlers.onOpen?.();
  };
  ws.onmessage = (evt) => {
    try { handlers.onMessage?.(JSON.parse(evt.data)); }
    catch (e) { /* ignore */ }
  };
  ws.onclose = () => { alive = false; handlers.onClose?.(); };
  ws.onerror = (e) => handlers.onError?.(e);

  return {
    socket: ws,
    subscribe(room: string) {
      if (!alive) return;
      const send = () => ws.send(JSON.stringify({ type: "subscribe", room }));
      if (ws.readyState === 1) send();
      else ws.addEventListener?.("open", send as any);
    },
    unsubscribe(room: string) {
      if (!alive) return;
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "unsubscribe", room }));
    },
    close() { alive = false; try { ws.close(); } catch {} },
  };
}

export { API_BASE, WS_BASE };
