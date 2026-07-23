import type { Brief, RoomType } from "./studio-types";
import { removeNegatedFeatures, requestedOptionalFeaturesFromText } from "./layout-rules";

const DIRECTIONS = ["north", "south", "east", "west", "unspecified"] as const;
const FEATURES = ["garage", "internal_staircase", "utility", "balcony", "study", "pantry", "laundry", "porch", "open_space", "prayer_room", "roof_garden"] as const;
const LAYOUT_TYPES = ["compact", "open", "villa", "duplex", "courtyard", "unspecified"] as const;
const CIRCULATION_STYLES = ["central_spine", "side_spine", "loop", "foyer_split", "courtyard_ring", "unspecified"] as const;
const ZONING_PREFERENCES = ["public_front", "private_rear", "split_bedrooms", "service_side", "unspecified"] as const;
const GARAGE_MODES = ["none", "front", "side", "rear", "unspecified"] as const;
const WET_CORE_PREFERENCES = ["side", "center", "stacked", "split", "unspecified"] as const;
const FURNITURE_ROOM_TYPES: RoomType[] = ["bathroom", "kitchen", "living", "bedroom", "dining", "study", "utility", "laundry", "pantry", "garage"];
const DEFAULT_FURNITURE_REQUIREMENTS: NonNullable<Brief["furnitureRequirements"]> = [
  { roomType: "bathroom", items: [{ name: "Bathtub", width: 2.5, depth: 5.5 }, { name: "Toilet", width: 1.8, depth: 2.2 }, { name: "Sink", width: 2.4, depth: 1.8 }] },
  { roomType: "kitchen", items: [{ name: "Kitchen Counter", width: 2.2, depth: 8 }, { name: "Refrigerator", width: 2.8, depth: 2.8 }] },
  { roomType: "living", items: [{ name: "Couch", width: 7, depth: 3 }, { name: "Carpet Area Rug", width: 6, depth: 4 }, { name: "TV", width: 4, depth: 0.5 }, { name: "TV Entertainment Console", width: 5, depth: 1.5 }] },
  { roomType: "bedroom", items: [{ name: "Bed", width: 5, depth: 6.5 }, { name: "Bedside Table", width: 1.4, depth: 1.4 }] },
  { roomType: "dining", items: [{ name: "Dining Table", width: 5, depth: 3 }, { name: "Dining Chair", width: 1.4, depth: 1.4 }] },
  { roomType: "study", items: [{ name: "Desk", width: 4, depth: 2 }, { name: "Study Chair", width: 1.6, depth: 1.6 }] },
  { roomType: "utility", items: [{ name: "Utility Counter", width: 4, depth: 2 }] },
  { roomType: "laundry", items: [{ name: "Washer Dryer", width: 3, depth: 2.5 }] },
  { roomType: "pantry", items: [{ name: "Storage Shelves", width: 3.5, depth: 1.5 }] },
  { roomType: "garage", items: [{ name: "Car", width: 7, depth: 14 }] },
];

type Direction = (typeof DIRECTIONS)[number];
type Feature = (typeof FEATURES)[number];
const NUMBER_WORDS: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function numberValue(value: string | undefined) {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  const parsed = Number(lower);
  return Number.isFinite(parsed) ? parsed : NUMBER_WORDS[lower];
}

function firstCount(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return numberValue(match?.[1]);
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

function asDirectionWithFallback(value: unknown, fallback: Direction | undefined): Direction {
  const direction = asDirection(value);
  return direction === "unspecified" ? fallback ?? "unspecified" : direction;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean) : [];
}

function asFurnitureRequirements(value: unknown): NonNullable<Brief["furnitureRequirements"]> {
  if (!Array.isArray(value)) return DEFAULT_FURNITURE_REQUIREMENTS;
  const parsed = value.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const roomTypeText = String(record.roomType ?? "").toLowerCase().replaceAll(" ", "_");
    const roomType = FURNITURE_ROOM_TYPES.find(item => item === roomTypeText || item.includes(roomTypeText) || roomTypeText.includes(item));
    if (!roomType || !Array.isArray(record.items)) return [];
    const items = record.items.flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const itemRecord = item as Record<string, unknown>;
      const name = String(itemRecord.name ?? "").trim();
      const width = asNumber(itemRecord.width, 2, 0.5, 20);
      const depth = asNumber(itemRecord.depth, 2, 0.5, 20);
      return name ? [{ name, width, depth }] : [];
    });
    return items.length ? [{ roomType, items }] : [];
  });
  return parsed.length ? parsed : DEFAULT_FURNITURE_REQUIREMENTS;
}

function normalizeWarnings(value: unknown, prompt: string) {
  const warnings = asStringArray(value);
  const lowerPrompt = prompt.toLowerCase();
  const groundFloorWithStairs = /\b(ground[-\s]?floor|single[-\s]?floor)\b/.test(lowerPrompt) && /\b(stair|stairs|staircase|internal staircase)\b/.test(lowerPrompt);
  const duplexStyleGroundFloor = /\bduplex[-\s]?style\b/.test(lowerPrompt) && /\bground[-\s]?floor\b/.test(lowerPrompt);
  return warnings.filter(warning => {
    const lower = warning.toLowerCase();
    if ((groundFloorWithStairs || duplexStyleGroundFloor) && /contradiction|conflict|conflicts|duplex|staircase|multiple levels|single level|ground-floor/.test(lower)) {
      return false;
    }
    return true;
  });
}

function asFeatures(value: unknown): Feature[] {
  return asStringArray(value).map(item => item.toLowerCase().replaceAll(" ", "_")).filter((item): item is Feature => FEATURES.includes(item as Feature));
}

function mergedFeatures(value: unknown, prompt: string, adjacency: string[]) {
  const parsed = asFeatures(value);
  const inferred = requestedOptionalFeaturesFromText(prompt, [...FEATURES]);
  return removeNegatedFeatures([...new Set([...parsed, ...inferred])], prompt, adjacency);
}

function asEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const normalized = String(value ?? fallback).toLowerCase().replaceAll(" ", "_");
  return allowed.includes(normalized) ? normalized as T[number] : fallback;
}

function sharedRoomNegated(prompt: string, labels: string[]) {
  return labels.some(label => {
    const phrase = label.replace(/\s+/g, "[-\\s]+");
    return new RegExp(`\\b(no|not|without|avoid|exclude|skip)\\b[^.?!;\\n]{0,35}\\b${phrase}\\b|\\b${phrase}\\b[^.?!;\\n]{0,35}\\b(not required|not needed|not necessary)\\b`, "i").test(prompt);
  });
}

function asSharedRoomCount(value: unknown, prompt: string, labels: string[], fallback: number) {
  if (sharedRoomNegated(prompt, labels)) return 0;
  const labelPattern = labels.map(label => label.replace(/\s+/g, "[-\\s]+")).join("|");
  const mentioned = new RegExp(`\\b(?:${labelPattern})\\b`, "i").test(prompt);
  const count = asInteger(value, fallback, 0, 4);
  if (count < fallback && mentioned) return fallback;
  if (count <= fallback) return count;
  const explicitCount = new RegExp(`\\b(\\d+|one|two|three|four)\\s*(?:${labelPattern})s?\\b`, "i").test(prompt);
  const doubleHeightOnly = /\bdouble[-\s]?height\b[^.?!;\n]{0,40}\b(living|great room|lounge)\b|\b(living|great room|lounge)\b[^.?!;\n]{0,40}\bdouble[-\s]?height\b/i.test(prompt);
  return explicitCount || !doubleHeightOnly ? count : fallback;
}

function asLivingRoomCount(value: unknown, prompt: string) {
  const count = asSharedRoomCount(value, prompt, ["living room", "living", "great room", "lounge", "family lounge", "family room"], 1);
  if (count !== 1) return count;
  const hasFormalLiving = /\bformal\s+living(?:\s+room)?\b/i.test(prompt);
  const hasFamilyLounge = /\bfamily\s+(?:lounge|room)\b/i.test(prompt);
  const doubleHeightOnly = /\bdouble[-\s]?height\b[^.?!;\n]{0,40}\b(living|great room|lounge)\b|\b(living|great room|lounge)\b[^.?!;\n]{0,40}\bdouble[-\s]?height\b/i.test(prompt);
  return hasFormalLiving && hasFamilyLounge && !doubleHeightOnly ? 2 : count;
}

function inferFloorCount(text: string) {
  if (/\b(single|one)[-\s]?(floor|storey|story)\b|\bground[-\s]?floor\b|\bsingle[-\s]?floor\b/.test(text)) return 1;
  return firstCount(text, /\b(\d+|one|two|three)\s*(?:floor|storey|story)\b/);
}

function inferBathroomCount(text: string) {
  const generic = firstCount(text, /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:bathrooms?|baths?)\b/);
  const specific = [...text.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:full|common|attached|ensuite|en-suite|half|powder|toilet)\s*(?:bathrooms?|baths?|toilets?|rooms?)\b/g)]
    .reduce((sum, match) => sum + (numberValue(match[1]) ?? 0), 0);
  if (specific > 0) return Math.max(generic ?? 0, specific);
  if (/\b(half bath|powder room|toilet room)\b/.test(text)) return Math.max(generic ?? 0, 1);
  return generic;
}

function inferPlot(text: string): Pick<Brief, "plotWidth" | "plotDepth" | "unit"> | null {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|m|meter|metre|meters|metres)?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(ft|feet|foot|m|meter|metre|meters|metres)\b/);
  if (!match) return null;
  return {
    plotWidth: Number(match[1]),
    plotDepth: Number(match[2]),
    unit: /^m|met/i.test(match[3]) ? "metres" : "feet",
  };
}

function inferFacing(text: string): Exclude<Direction, "unspecified"> | undefined {
  const match = text.match(/\b(north|south|east|west)[-\s]?facing\b/);
  return match?.[1] as Exclude<Direction, "unspecified"> | undefined;
}

function inferRoadSide(text: string): Exclude<Direction, "unspecified"> | undefined {
  const direct = text.match(/\b(?:road|main entry|entry|gate)\b[^.?!;\n]{0,45}\b(?:on|at|to|from)\s+(?:the\s+)?(north|south|east|west)\s+side\b/);
  if (direct?.[1]) return direct[1] as Exclude<Direction, "unspecified">;
  const reverse = text.match(/\b(north|south|east|west)\s+side\b[^.?!;\n]{0,45}\b(?:road|main entry|entry|gate)\b/);
  return reverse?.[1] as Exclude<Direction, "unspecified"> | undefined;
}

export function normalizeParsedRequirements(value: Record<string, unknown>, prompt: string): Brief {
  const normalizedPrompt = prompt.toLowerCase();
  const inferredPlot = inferPlot(normalizedPrompt);
  const inferredFloors = inferFloorCount(normalizedPrompt);
  const inferredBedrooms = firstCount(normalizedPrompt, /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:bed|bedroom|bedrooms)\b/);
  const inferredBathrooms = inferBathroomCount(normalizedPrompt);
  const inferredFacing = inferFacing(normalizedPrompt);
  const inferredRoadSide = inferRoadSide(normalizedPrompt);
  const style = typeof value.style === "string" && value.style.trim() ? value.style.trim() : "Modern";
  const rawIntent = typeof value.layoutIntent === "object" && value.layoutIntent ? value.layoutIntent as Record<string, unknown> : {};
  const adjacency = asStringArray(value.adjacency);
  const unit = typeof value.unit === "string" && value.unit.trim() ? value.unit : inferredPlot?.unit;
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Custom Home Concept",
    prompt,
    plotWidth: asNumber(value.plotWidth, inferredPlot?.plotWidth ?? 40, 8, 1000),
    plotDepth: asNumber(value.plotDepth, inferredPlot?.plotDepth ?? 60, 8, 1000),
    unit: String(unit).toLowerCase().startsWith("met") ? "metres" : "feet",
    floors: asInteger(value.floors, inferredFloors ?? 1, 1, 3),
    bedrooms: asInteger(value.bedrooms, inferredBedrooms ?? 0, 0, 12),
    bathrooms: asInteger(value.bathrooms, inferredBathrooms ?? 0, 0, 12),
    livingRooms: asLivingRoomCount(value.livingRooms, prompt),
    kitchens: asSharedRoomCount(value.kitchens, prompt, ["kitchen"], 1),
    diningRooms: asSharedRoomCount(value.diningRooms, prompt, ["dining room", "dining area", "dining nook", "dining"], 1),
    style: style[0].toUpperCase() + style.slice(1),
    facing: asDirectionWithFallback(value.facing, inferredFacing),
    roadSide: asDirectionWithFallback(value.roadSide, inferredRoadSide ?? inferredFacing),
    features: mergedFeatures(value.features, prompt, adjacency),
    adjacency,
    warnings: normalizeWarnings(value.warnings, prompt),
    furnitureRequirements: asFurnitureRequirements(value.furnitureRequirements),
    layoutIntent: {
      layoutType: asEnum(rawIntent.layoutType, LAYOUT_TYPES, "unspecified"),
      circulationStyle: asEnum(rawIntent.circulationStyle, CIRCULATION_STYLES, "unspecified"),
      zoningPreference: asEnum(rawIntent.zoningPreference, ZONING_PREFERENCES, "unspecified"),
      garageMode: asEnum(rawIntent.garageMode, GARAGE_MODES, "unspecified"),
      wetCorePreference: asEnum(rawIntent.wetCorePreference, WET_CORE_PREFERENCES, "unspecified"),
    },
  };
}
