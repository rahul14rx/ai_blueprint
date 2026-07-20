export const runtime = "nodejs";

import { readSupabaseError, supabaseAdminFetch, supabaseConfigured, type TesterRow } from "../supabase-admin";

export async function POST(request: Request) {
  try {
    if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured." }, { status: 500 });
    const body = await request.json() as { username?: string; password?: string };
    const username = body.username?.trim().toLowerCase();
    const password = body.password ?? "";
    if (!username || !password) return Response.json({ error: "Username and password are required." }, { status: 400 });

    const query = new URLSearchParams({
      username: `eq.${username}`,
      password_pin: `eq.${password}`,
      select: "id,username",
      limit: "1",
    });
    const response = await supabaseAdminFetch(`tester_profiles?${query.toString()}`);
    if (!response.ok) throw new Error(await readSupabaseError(response));
    const testers = await response.json() as TesterRow[];
    const tester = testers[0];
    if (!tester) return Response.json({ error: "Invalid tester login. Use tester1 to tester5 with password 1." }, { status: 401 });

    return Response.json({ ok: true, tester });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not sign in." }, { status: 500 });
  }
}
