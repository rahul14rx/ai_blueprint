export const runtime = "nodejs";

import { readSupabaseError, supabaseAdminFetch, supabaseConfigured, type ProjectRow } from "../supabase-admin";

function mapProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    houseType: row.house_type,
    floors: row.floor_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    prompt: row.prompt ?? "",
    brief: row.brief_json ?? null,
    designProject: row.design_project_json ?? null,
    versionHistory: row.version_history_json ?? [],
    activeVersionId: row.active_version_id ?? "",
    hasDesign: Boolean(row.design_project_json),
  };
}

const BASE_PROJECT_SELECT = "id,name,house_type,floor_count,created_at,updated_at";
const DESIGN_PROJECT_SELECT = `${BASE_PROJECT_SELECT},prompt,brief_json,design_project_json,version_history_json,active_version_id`;

export async function GET(request: Request) {
  try {
    if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured." }, { status: 500 });
    const testerId = new URL(request.url).searchParams.get("testerId");
    if (!testerId) return Response.json({ error: "testerId is required." }, { status: 400 });

    const query = new URLSearchParams({
      tester_id: `eq.${testerId}`,
      select: DESIGN_PROJECT_SELECT,
      order: "updated_at.desc",
    });
    let response = await supabaseAdminFetch(`projects?${query.toString()}`);
    if (!response.ok && response.status === 400) {
      query.set("select", BASE_PROJECT_SELECT);
      response = await supabaseAdminFetch(`projects?${query.toString()}`);
    }
    if (!response.ok) throw new Error(await readSupabaseError(response));
    const rows = await response.json() as ProjectRow[];
    return Response.json({ ok: true, projects: rows.map(mapProject) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load projects." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured." }, { status: 500 });
    const body = await request.json() as { testerId?: string; name?: string; houseType?: "single" | "multi"; floors?: 1 | 2 | 3 };
    const name = body.name?.trim();
    if (!body.testerId || !name || !body.houseType || !body.floors) {
      return Response.json({ error: "testerId, name, houseType, and floors are required." }, { status: 400 });
    }

    const response = await supabaseAdminFetch("projects", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        tester_id: body.testerId,
        name,
        house_type: body.houseType,
        floor_count: body.floors,
      }),
    });
    if (!response.ok) throw new Error(await readSupabaseError(response));
    const rows = await response.json() as ProjectRow[];
    return Response.json({ ok: true, project: mapProject(rows[0]) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create project." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured." }, { status: 500 });
    const url = new URL(request.url);
    const testerId = url.searchParams.get("testerId");
    const projectId = url.searchParams.get("projectId");
    if (!testerId || !projectId) return Response.json({ error: "testerId and projectId are required." }, { status: 400 });

    const query = new URLSearchParams({
      id: `eq.${projectId}`,
      tester_id: `eq.${testerId}`,
    });
    const response = await supabaseAdminFetch(`projects?${query.toString()}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (!response.ok) throw new Error(await readSupabaseError(response));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not delete project." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured." }, { status: 500 });
    const body = await request.json() as {
      testerId?: string;
      projectId?: string;
      prompt?: string;
      brief?: unknown;
      designProject?: unknown;
      versionHistory?: unknown[];
      activeVersionId?: string;
    };
    if (!body.testerId || !body.projectId || !body.designProject) {
      return Response.json({ error: "testerId, projectId, and designProject are required." }, { status: 400 });
    }

    const query = new URLSearchParams({
      id: `eq.${body.projectId}`,
      tester_id: `eq.${body.testerId}`,
      select: DESIGN_PROJECT_SELECT,
    });
    const response = await supabaseAdminFetch(`projects?${query.toString()}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        prompt: body.prompt ?? "",
        brief_json: body.brief ?? null,
        design_project_json: body.designProject,
        version_history_json: body.versionHistory ?? [],
        active_version_id: body.activeVersionId ?? "",
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      const message = await readSupabaseError(response);
      if (message.toLowerCase().includes("column")) {
        throw new Error(`${message}. Run the project design storage SQL before saving designs.`);
      }
      throw new Error(message);
    }
    const rows = await response.json() as ProjectRow[];
    return Response.json({ ok: true, project: mapProject(rows[0]) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save project design." }, { status: 500 });
  }
}
