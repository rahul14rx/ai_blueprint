export const runtime = "nodejs";

import { normalizeParsedRequirements } from "../../requirement-normalizer";

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

function toFriendlyError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("api key") || lower.includes("permission") || lower.includes("unauthenticated") || lower.includes("403") || lower.includes("401")) {
    return "The Gemini API key was rejected. Check .env.local and restart the app.";
  }
  if (lower.includes("not found") || lower.includes("404") || lower.includes("model name") || lower.includes("models/")) return "The Gemini model name is invalid. Use GEMINI_MODEL=gemini-2.5-flash in .env.local and restart the app.";
  if (lower.includes("internal error") || lower.includes("internal") || lower.includes("reference =")) return "Gemini had a temporary internal error. Using the local parser fallback.";
  if (lower.includes("quota") || lower.includes("rate") || lower.includes("limit") || lower.includes("429")) {
    return "Gemini free limit was reached. Using the local parser fallback so testing can continue.";
  }
  return "Could not understand the prompt. Please retry.";
}

export async function POST(request: Request) {
  let promptText = "";
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const { prompt } = await request.json();
    if (typeof prompt !== "string" || prompt.trim().length < 20) return Response.json({ error: "Please describe the plot and required rooms in more detail." }, { status: 400 });
    promptText = prompt.trim();
    if (!apiKey || apiKey.includes("paste_your")) return Response.json(normalizeParsedRequirements({}, promptText));

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
            "Never include a feature that the user negates. For example, \"no study\", \"do not add a flex room\", \"without garage\", or \"pantry not required\" must exclude that feature.",
            "Count half baths, powder rooms, and toilet rooms as bathrooms in the bathrooms number.",
            "If the prompt asks for laundry, include \"laundry\" in features. If it asks for utility, include \"utility\" in features. If it asks for porch, veranda, or front sit-out, include \"porch\" in features. If it asks for open plan or open dining, include \"open_space\" in features.",
            "Preserve important placement requirements like front-left, front-right, center-right, near kitchen, near bath, and opens to hallway in adjacency.",
            "Extract layout intent: round/circular hallway means circulationStyle loop; courtyard means layoutType courtyard and circulationStyle courtyard_ring; open plan means layoutType open; duplex means layoutType duplex; garage side/front/rear should set garageMode.",
            "A ground-floor plan with an internal staircase is valid: interpret it as the ground-floor level with stair access for a future/upper floor. Do not mark this as a contradiction.",
            "A duplex-style ground-floor prompt is valid when the user is asking to draw only the ground-floor plan with duplex-style layout intent.",
            "Use \"unspecified\" when orientation or road side is missing.",
            "Put contradictions, missing critical facts, and likely infeasible requests in warnings.",
            `User prompt: ${promptText}`,
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
    return Response.json(normalizeParsedRequirements(parsed as Record<string, unknown>, promptText));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI request failed.";
    console.error("Requirement parser failed:", message);
    if (promptText) {
      const fallback = normalizeParsedRequirements({}, promptText);
      fallback.warnings = [...fallback.warnings, toFriendlyError(message)];
      return Response.json(fallback);
    }
    return Response.json({ error: toFriendlyError(message) }, { status: 502 });
  }
}
