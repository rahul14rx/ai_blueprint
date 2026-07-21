import type { Brief, Project } from "../studio-types";

export type TesterRow = { id: string; username: string };
export type ProjectRow = {
  id: string;
  name: string;
  house_type: "single" | "multi";
  floor_count: 1 | 2 | 3;
  created_at: string;
  updated_at: string;
  prompt?: string | null;
  brief_json?: Brief | null;
  design_project_json?: Project | null;
  version_history_json?: unknown[] | null;
  active_version_id?: string | null;
};

function supabaseBaseUrl() {
  const raw = process.env.SUPABASE_URL;
  if (!raw) throw new Error("SUPABASE_URL is missing.");
  return raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

export function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function supabaseAdminFetch(path: string, init: RequestInit = {}) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const headers = new Headers(init.headers);
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${supabaseBaseUrl()}/rest/v1/${path}`, { ...init, headers });
}

export async function readSupabaseError(response: Response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error || text;
  } catch {
    return text || `${response.status} ${response.statusText}`;
  }
}
