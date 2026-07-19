export const runtime = "nodejs";

import { applyBriefRevision, buildLocalRevisionPatch, normalizeRevisionPatch, type BriefRevisionPatch } from "../../brief-revision";
import { evaluateArchitecture } from "../../architecture-validator";
import { createProject, validatePlans } from "../../plan-generator";
import type { Brief } from "../../studio-types";

type GeminiGenerateResponse = {
  error?: { message?: string; status?: string; code?: number };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

function cleanJsonText(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function readGeminiJson(response: GeminiGenerateResponse) {
  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts?.map(part => part.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error(`Gemini returned an empty revision response${candidate?.finishReason ? ` with finish reason ${candidate.finishReason}` : ""}.`);
  return JSON.parse(cleanJsonText(text));
}

function toFriendlyError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("api key") || lower.includes("permission") || lower.includes("unauthenticated") || lower.includes("403") || lower.includes("401")) {
    return "The Gemini API key was rejected. Check .env.local and restart the app.";
  }
  if (lower.includes("not found") || lower.includes("404") || lower.includes("model")) return "The Gemini model name is invalid. Use GEMINI_MODEL=gemini-2.5-flash in .env.local and restart the app.";
  if (lower.includes("quota") || lower.includes("rate") || lower.includes("limit") || lower.includes("429")) {
    return "The Gemini free limit was reached. Wait a bit, switch model, or use another key.";
  }
  return "Could not revise the prompt safely. Please try a more specific change.";
}

function isBrief(value: unknown): value is Brief {
  const brief = value as Partial<Brief> | null;
  return Boolean(brief && typeof brief === "object" && typeof brief.prompt === "string" && typeof brief.plotWidth === "number" && typeof brief.plotDepth === "number" && Array.isArray(brief.features) && Array.isArray(brief.adjacency));
}

async function requestGeminiPatch(currentBrief: Brief, correction: string): Promise<BriefRevisionPatch> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("paste_your")) return buildLocalRevisionPatch(currentBrief, correction);

  const configuredModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const model = configuredModel === "gemini-3.5-flash" ? "gemini-2.5-flash" : configuredModel;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: "You create safe structured patches to an existing residential floor-plan brief. Return only valid JSON. Never return coordinates or room rectangles." }],
      },
      contents: [{
        role: "user",
        parts: [{ text: [
          "Return this exact JSON shape:",
          `{"changeSummary":"string","rejected":false,"rejectionReason":"","set":{"plotWidth":number,"plotDepth":number,"unit":"feet|metres","floors":number,"bedrooms":number,"bathrooms":number,"livingRooms":number,"kitchens":number,"diningRooms":number,"style":"string","facing":"north|south|east|west|unspecified","roadSide":"north|south|east|west|unspecified","layoutIntent":{"layoutType":"compact|open|villa|duplex|courtyard|unspecified","circulationStyle":"central_spine|side_spine|loop|foyer_split|courtyard_ring|unspecified","zoningPreference":"public_front|private_rear|split_bedrooms|service_side|unspecified","garageMode":"none|front|side|rear|unspecified","wetCorePreference":"side|center|stacked|split|unspecified"}},"addFeatures":["garage|internal_staircase|utility|balcony|study|pantry|laundry|porch|open_space|prayer_room|roof_garden"],"removeFeatures":["same enum"],"addAdjacency":["string"],"removeAdjacency":["string"],"warnings":["string"]}`,
          "Important safety rules:",
          "Return a patch only. Do not redesign the plan and do not invent dimensions or coordinates.",
          "Leave fields out unless the correction explicitly asks to change them.",
          "For vague requests like 'make it better', set rejected true and explain rejectionReason.",
          "For 'move kitchen near dining', add an adjacency instruction; do not change room counts.",
          "For 'make hallway wider', add an adjacency/circulation instruction and optionally set layoutIntent.circulationStyle.",
          "For feature requests, use addFeatures/removeFeatures instead of rewriting all features.",
          "Never remove bedrooms, bathrooms, orientation, road side, plot size, or room counts unless explicitly requested.",
          `Current structured brief:\n${JSON.stringify(currentBrief)}`,
          `Correction request:\n${correction.trim()}`,
        ].join("\n") }],
      }],
      generationConfig: {
        temperature: 0.05,
        responseMimeType: "application/json",
      },
    }),
  });

  const data = (await response.json()) as GeminiGenerateResponse;
  if (!response.ok) throw new Error(data.error?.message || `Gemini revision request failed with status ${response.status}.`);
  return normalizeRevisionPatch(readGeminiJson(data));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const currentBrief = body.currentBrief;
    const correction = body.correction;

    if (!isBrief(currentBrief)) return Response.json({ error: "Current structured requirements are missing or invalid." }, { status: 400 });
    if (typeof correction !== "string" || correction.trim().length < 5) return Response.json({ error: "Please describe a concrete revision." }, { status: 400 });

    let patch: BriefRevisionPatch;
    try {
      patch = await requestGeminiPatch(currentBrief, correction.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Revision AI request failed.";
      console.error("Revision parser failed, using local fallback:", message);
      patch = buildLocalRevisionPatch(currentBrief, correction.trim());
    }

    const result = applyBriefRevision(currentBrief, patch, correction.trim());
    if (!result.ok) return Response.json(result, { status: 422 });
    const candidate = createProject(result.brief);
    const architecture = evaluateArchitecture(result.brief, candidate.plans[0]);
    const geometryErrors = [...validatePlans(candidate.plans), ...architecture.errors];
    if (geometryErrors.length) {
      return Response.json({
        ...result,
        ok: false,
        brief: currentBrief,
        changeSummary: "Revision was not applied because it created geometry issues.",
        errors: geometryErrors,
        warnings: [...result.warnings, ...architecture.warnings],
      }, { status: 422 });
    }
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The revision request failed.";
    console.error("Requirement revision failed:", message);
    return Response.json({ error: toFriendlyError(message) }, { status: 502 });
  }
}
