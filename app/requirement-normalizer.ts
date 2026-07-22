import type { Brief, BriefFurniture, RoomType } from "./studio-types";
import { removeNegatedFeatures, requestedOptionalFeaturesFromText } from "./layout-rules";

const DIRECTIONS = ["north", "south", "east", "west", "unspecified"] as const;
const FEATURES = ["garage", "internal_staircase", "utility", "balcony", "study", "pantry", "laundry", "porch", "open_space", "prayer_room", "roof_garden"] as const;
const LAYOUT_TYPES = ["compact", "open", "villa", "duplex", "courtyard", "unspecified"] as const;
const CIRCULATION_STYLES = ["central_spine", "side_spine", "loop", "foyer_split", "courtyard_ring", "unspecified"] as const;
const ZONING_PREFERENCES = ["public_front", "private_rear", "split_bedrooms", "service_side", "unspecified"] as const;
const GARAGE_MODES = ["none", "front", "side", "rear", "unspecified"] as const;
const WET_CORE_PREFERENCES = ["side", "center", "stacked", "split", "unspecified"] as const;

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

function canonicalRoomType(type: string): RoomType | undefined {
  const t = type.toLowerCase().trim().replace(/s$/, "");
  if (t === "bedroom" || t === "bed room" || t === "bed") return "bedroom";
  if (t === "living" || t === "living room" || t === "lounge" || t === "family room" || t === "family lounge") return "living";
  if (t === "dining" || t === "dining room") return "dining";
  if (t === "bathroom" || t === "bath room" || t === "bath" || t === "toilet" || t === "powder" || t === "powder room") return "bathroom";
  if (t === "kitchen") return "kitchen";
  if (t === "garage") return "garage";
  if (t === "stairs" || t === "staircase" || t === "stair") return "stairs";
  if (t === "foyer" || t === "entry" || t === "entrance") return "foyer";
  if (t === "hallway" || t === "hall" || t === "circulation") return "hallway";
  if (t === "utility" || t === "utility room") return "utility";
  if (t === "study" || t === "office" || t === "flex" || t === "flex room") return "study";
  if (t === "pantry") return "pantry";
  if (t === "laundry" || t === "laundry room") return "laundry";
  if (t === "storage" || t === "store" || t === "closet" || t === "store room" || t === "storeroom") return "storage";
  if (t === "porch" || t === "veranda" || t === "deck" || t === "balcony" || t === "sit-out" || t === "sitout") return "porch";
  if (t === "open" || t === "courtyard") return "open";

  const ROOM_TYPES: RoomType[] = [
    "living", "kitchen", "bedroom", "bathroom", "dining", "garage", "stairs",
    "foyer", "hallway", "utility", "study", "pantry", "laundry", "storage", "porch", "open"
  ];
  return ROOM_TYPES.includes(t as RoomType) ? (t as RoomType) : undefined;
}

function asFurnitureRequirements(value: unknown): BriefFurniture[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const normalized: BriefFurniture[] = [];

  for (const group of value) {
    if (typeof group !== "object" || !group) continue;
    const rawType = String((group as any).roomType || "");
    const roomType = canonicalRoomType(rawType);
    if (!roomType) continue;

    const rawItems = (group as any).items;
    if (!Array.isArray(rawItems)) continue;

    const items: { name: string; width: number; depth: number }[] = [];
    for (const item of rawItems) {
      if (typeof item !== "object" || !item) continue;
      const name = String((item as any).name || "").trim();
      const width = Number((item as any).width);
      const depth = Number((item as any).depth);

      if (name && Number.isFinite(width) && Number.isFinite(depth)) {
        items.push({
          name,
          width: Math.max(0.1, width),
          depth: Math.max(0.1, depth)
        });
      }
    }

    if (items.length > 0) {
      normalized.push({ roomType, items });
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}

function ensureMandatedFurniture(
  furniture: BriefFurniture[] | undefined,
  bedrooms: number,
  bathrooms: number,
  livingRooms: number,
  kitchens: number
): BriefFurniture[] {
  const list = furniture ? [...furniture] : [];
  
  const ensureRoomItems = (roomType: RoomType, defaultItems: { name: string; width: number; depth: number }[]) => {
    let existing = list.find(f => f.roomType === roomType);
    if (!existing) {
      existing = { roomType, items: [] };
      list.push(existing);
    }
    defaultItems.forEach(defItem => {
      const lowerDef = defItem.name.toLowerCase();
      const hasItem = existing!.items.some(item => {
        const itemLower = item.name.toLowerCase();
        return itemLower.includes(lowerDef) || lowerDef.includes(itemLower);
      });
      if (!hasItem) {
        existing!.items.push({ ...defItem });
      }
    });
  };

  if (bedrooms > 0) {
    ensureRoomItems("bedroom", [
      { name: "Bed", width: 5.5, depth: 6.5 },
      { name: "Bedside Table 1", width: 1.5, depth: 1.5 },
      { name: "Bedside Table 2", width: 1.5, depth: 1.5 }
    ]);
  }
  if (bathrooms > 0) {
    ensureRoomItems("bathroom", [
      { name: "Bathtub", width: 5.0, depth: 2.5 },
      { name: "Toilet", width: 1.8, depth: 2.2 },
      { name: "Sink", width: 2.0, depth: 1.8 }
    ]);
  }
  if (livingRooms > 0) {
    ensureRoomItems("living", [
      { name: "Couch", width: 6.5, depth: 3.0 },
      { name: "Carpet Area Rug", width: 8.0, depth: 6.0 },
      { name: "TV", width: 4.0, depth: 0.5 },
      { name: "TV Entertainment Console", width: 4.5, depth: 1.5 }
    ]);
  }
  if (kitchens > 0) {
    ensureRoomItems("kitchen", [
      { name: "Kitchen Counter", width: 6.0, depth: 2.0 },
      { name: "Refrigerator", width: 2.8, depth: 2.8 }
    ]);
  }

  return list;
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

  const bedrooms = asInteger(value.bedrooms, inferredBedrooms ?? 0, 0, 12);
  const bathrooms = asInteger(value.bathrooms, inferredBathrooms ?? 0, 0, 12);
  const livingRooms = asLivingRoomCount(value.livingRooms, prompt);
  const kitchens = asSharedRoomCount(value.kitchens, prompt, ["kitchen"], 1);

  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Custom Home Concept",
    prompt,
    plotWidth: asNumber(value.plotWidth, inferredPlot?.plotWidth ?? 40, 8, 1000),
    plotDepth: asNumber(value.plotDepth, inferredPlot?.plotDepth ?? 60, 8, 1000),
    unit: String(unit).toLowerCase().startsWith("met") ? "metres" : "feet",
    floors: asInteger(value.floors, inferredFloors ?? 1, 1, 3),
    bedrooms,
    bathrooms,
    livingRooms,
    kitchens,
    diningRooms: asSharedRoomCount(value.diningRooms, prompt, ["dining room", "dining area", "dining nook", "dining"], 1),
    style: style[0].toUpperCase() + style.slice(1),
    facing: asDirectionWithFallback(value.facing, inferredFacing),
    roadSide: asDirectionWithFallback(value.roadSide, inferredRoadSide ?? inferredFacing),
    features: mergedFeatures(value.features, prompt, adjacency),
    adjacency,
    warnings: normalizeWarnings(value.warnings, prompt),
    layoutIntent: {
      layoutType: asEnum(rawIntent.layoutType, LAYOUT_TYPES, "unspecified"),
      circulationStyle: asEnum(rawIntent.circulationStyle, CIRCULATION_STYLES, "unspecified"),
      zoningPreference: asEnum(rawIntent.zoningPreference, ZONING_PREFERENCES, "unspecified"),
      garageMode: asEnum(rawIntent.garageMode, GARAGE_MODES, "unspecified"),
      wetCorePreference: asEnum(rawIntent.wetCorePreference, WET_CORE_PREFERENCES, "unspecified"),
    },
    furnitureRequirements: ensureMandatedFurniture(
      asFurnitureRequirements(value.furnitureRequirements),
      bedrooms,
      bathrooms,
      livingRooms,
      kitchens
    ),
  };
}
