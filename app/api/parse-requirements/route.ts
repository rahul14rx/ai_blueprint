export const runtime = "nodejs";

import type { Brief } from "../../studio-types";

const DIRECTIONS = ["north", "south", "east", "west", "unspecified"] as const;
const FEATURES = ["garage", "internal_staircase", "utility", "balcony", "study", "pantry", "laundry", "porch", "open_space", "prayer_room", "roof_garden"] as const;
const LAYOUT_TYPES = ["compact", "open", "villa", "duplex", "courtyard", "unspecified"] as const;
const CIRCULATION_STYLES = ["central_spine", "side_spine", "loop", "foyer_split", "courtyard_ring", "unspecified"] as const;
const ZONING_PREFERENCES = ["public_front", "private_rear", "split_bedrooms", "service_side", "unspecified"] as const;
const GARAGE_MODES = ["none", "front", "side", "rear", "unspecified"] as const;
const WET_CORE_PREFERENCES = ["side", "center", "stacked", "split", "unspecified"] as const;

type Direction = (typeof DIRECTIONS)[number];
type Feature = (typeof FEATURES)[number];
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
  if (!text.trim()) {
    throw new Error(`Gemini returned an empty response${candidate?.finishReason ? ` with finish reason ${candidate.finishReason}` : ""}.`);
  }
  return JSON.parse(cleanJsonText(text));
}

function asNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function asInteger(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(asNumber(value, fallback, min, max));
}

function asDirection(value: unknown): Direction {
  const lower = String(value ?? "unspecified").toLowerCase();
  return DIRECTIONS.includes(lower as Direction) ? lower as Direction : "unspecified";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean) : [];
}

function asFeatures(value: unknown): Feature[] {
  return asStringArray(value).map(item => item.toLowerCase().replaceAll(" ", "_")).filter((item): item is Feature => FEATURES.includes(item as Feature));
}

function asEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const normalized = String(value ?? fallback).toLowerCase().replaceAll(" ", "_");
  return allowed.includes(normalized) ? normalized as T[number] : fallback;
}

function normalizeBrief(value: Record<string, unknown>, prompt: string): Brief {
  const style = typeof value.style === "string" && value.style.trim() ? value.style.trim() : "Modern";
  const rawIntent = typeof value.layoutIntent === "object" && value.layoutIntent ? value.layoutIntent as Record<string, unknown> : {};
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Custom Home Concept",
    prompt,
    plotWidth: asNumber(value.plotWidth, 40, 8, 1000),
    plotDepth: asNumber(value.plotDepth, 60, 8, 1000),
    unit: String(value.unit).toLowerCase().startsWith("met") ? "metres" : "feet",
    floors: asInteger(value.floors, 1, 1, 3),
    bedrooms: asInteger(value.bedrooms, 0, 0, 12),
    bathrooms: asInteger(value.bathrooms, 0, 0, 12),
    livingRooms: asInteger(value.livingRooms, 1, 0, 4),
    kitchens: asInteger(value.kitchens, 1, 0, 4),
    diningRooms: asInteger(value.diningRooms, 1, 0, 4),
    style: style[0].toUpperCase() + style.slice(1),
    facing: asDirection(value.facing),
    roadSide: asDirection(value.roadSide),
    features: asFeatures(value.features),
    adjacency: asStringArray(value.adjacency),
    warnings: asStringArray(value.warnings),
    layoutIntent: {
      layoutType: asEnum(rawIntent.layoutType, LAYOUT_TYPES, "unspecified"),
      circulationStyle: asEnum(rawIntent.circulationStyle, CIRCULATION_STYLES, "unspecified"),
      zoningPreference: asEnum(rawIntent.zoningPreference, ZONING_PREFERENCES, "unspecified"),
      garageMode: asEnum(rawIntent.garageMode, GARAGE_MODES, "unspecified"),
      wetCorePreference: asEnum(rawIntent.wetCorePreference, WET_CORE_PREFERENCES, "unspecified"),
    },
  };
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
  return "Could not understand the prompt. Please retry.";
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.includes("paste_your")) return Response.json({ error: "GEMINI_API_KEY is not configured in .env.local." }, { status: 503 });
    const { prompt } = await request.json();
    if (typeof prompt !== "string" || prompt.trim().length < 20) return Response.json({ error: "Please describe the plot and required rooms in more detail." }, { status: 400 });

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
          parts: [{ text: "You extract residential floor-plan requirements. Return only valid JSON. Do not design the floor plan." }],
        },
        contents: [{
          role: "user",
          parts: [{ text: [
            "Extract this prompt into this exact JSON shape:",
            `{"title":"string","plotWidth":number,"plotDepth":number,"unit":"feet|metres","floors":1,"bedrooms":0,"bathrooms":0,"livingRooms":0,"kitchens":0,"diningRooms":0,"style":"string","facing":"north|south|east|west|unspecified","roadSide":"north|south|east|west|unspecified","features":["garage|internal_staircase|utility|balcony|study|pantry|laundry|porch|open_space|prayer_room|roof_garden"],"adjacency":["string"],"warnings":["string"],"layoutIntent":{"layoutType":"compact|open|villa|duplex|courtyard|unspecified","circulationStyle":"central_spine|side_spine|loop|foyer_split|courtyard_ring|unspecified","zoningPreference":"public_front|private_rear|split_bedrooms|service_side|unspecified","garageMode":"none|front|side|rear|unspecified","wetCorePreference":"side|center|stacked|split|unspecified"}}`,
            "Never invent dimensions, room counts, plot facing, or road direction.",
            "Count half baths, powder rooms, and toilet rooms as bathrooms in the bathrooms number.",
            "If the prompt asks for laundry, include \"laundry\" in features. If it asks for utility, include \"utility\" in features. If it asks for porch, veranda, or front sit-out, include \"porch\" in features. If it asks for open plan or open dining, include \"open_space\" in features.",
            "Preserve important placement requirements like front-left, front-right, center-right, near kitchen, near bath, and opens to hallway in adjacency.",
            "Extract layout intent: round/circular hallway means circulationStyle loop; courtyard means layoutType courtyard and circulationStyle courtyard_ring; open plan means layoutType open; duplex means layoutType duplex; garage side/front/rear should set garageMode.",
            "Use \"unspecified\" when orientation or road side is missing.",
            "Put contradictions, missing critical facts, and likely infeasible requests in warnings.",
            `User prompt: ${prompt.trim()}`,
          ].join("\n") }],
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    const data = (await response.json()) as GeminiGenerateResponse;
    if (!response.ok) throw new Error(data.error?.message || `Gemini request failed with status ${response.status}.`);

    const parsed = readGeminiJson(data);
    return Response.json(normalizeBrief(parsed as Record<string, unknown>, prompt.trim()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI request failed.";
    console.error("Requirement parser failed:", message);
    return Response.json({ error: toFriendlyError(message) }, { status: 502 });
  }
}
