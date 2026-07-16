import { Brief, FloorPlan, Opening, Project, ROOM_COLORS, Room, RoomType, PRESETS } from "./studio-types";
import { optimizeGroundFloor } from "./layout-optimizer";
import { needsWetVentilation, removeNegatedFeatures, requestedOptionalFeaturesFromText, roomMeetsMinimum, wantsAttachedBath } from "./layout-rules";
import { evaluateArchitecture } from "./architecture-validator";

const uid = () => Math.random().toString(36).slice(2, 9);
const room = (level: number, name: string, type: RoomType, x: number, y: number, width: number, depth: number): Room => ({ id: `f${level}-${type}-${uid()}`, name, type, x, y, width, depth, color: ROOM_COLORS[type] });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const nearly = (a: number, b: number) => Math.abs(a - b) < 0.03;
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1);
const feet = (brief: Brief, value: number) => brief.unit === "feet" ? value : value * 0.3048;
const target = (brief: Brief, min: number, ideal: number, max: number, available: number) => clamp(feet(brief, ideal), feet(brief, min), Math.min(feet(brief, max), available));
const wantsRoundedLiving = (brief: Brief) => /\b(round|rounded|curved|curve|semi[-\s]?circular|circular)\b.*\b(living|lounge|great room)\b|\b(living|lounge|great room)\b.*\b(round|rounded|curved|curve|semi[-\s]?circular|circular)\b/i.test(brief.prompt);
const OPTIONAL_FEATURES = ["garage", "internal_staircase", "utility", "balcony", "roof_garden", "study", "pantry", "laundry", "porch", "open_space", "prayer_room"];
const NUMBER_WORDS: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
type Direction = "north" | "south" | "east" | "west";

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

function isRoomNegated(text: string, labels: string[]) {
  return labels.some(label => {
    const phrase = label.replace(/\s+/g, "[-\\s]+");
    return new RegExp(`\\b(no|not|without|avoid|exclude|skip)\\b[^.?!;\\n]{0,35}\\b${phrase}\\b|\\b${phrase}\\b[^.?!;\\n]{0,35}\\b(not required|not needed|not necessary)\\b`, "i").test(text);
  });
}

function inferSharedRoomCount(text: string, labels: string[], defaultWhenMentioned = 1) {
  if (isRoomNegated(text, labels)) return 0;
  const labelPattern = labels.map(label => label.replace(/\s+/g, "[-\\s]+")).join("|");
  const counted = firstCount(text, new RegExp(`\\b(\\d+|one|two|three|four)\\s*(?:${labelPattern})s?\\b`));
  if (counted !== undefined) return counted;
  return new RegExp(`\\b(?:${labelPattern})\\b`, "i").test(text) ? defaultWhenMentioned : undefined;
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

function inferFacing(text: string): Direction | undefined {
  const match = text.match(/\b(north|south|east|west)[-\s]?facing\b/);
  return match?.[1] as Direction | undefined;
}

function inferRoadSide(text: string): Direction | undefined {
  const direct = text.match(/\b(?:road|main entry|entry|gate)\b[^.?!;\n]{0,45}\b(?:on|at|to|from)\s+(?:the\s+)?(north|south|east|west)\s+side\b/);
  if (direct?.[1]) return direct[1] as Direction;
  const reverse = text.match(/\b(north|south|east|west)\s+side\b[^.?!;\n]{0,45}\b(?:road|main entry|entry|gate)\b/);
  return reverse?.[1] as Direction | undefined;
}

export function parseBrief(prompt: string, form: Partial<Brief>): Brief {
  const lower = prompt.toLowerCase();
  const inferredFloors = inferFloorCount(lower);
  const inferredBedrooms = firstCount(lower, /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:bed|bedroom|bedrooms)\b/);
  const inferredBathrooms = inferBathroomCount(lower);
  const inferredLivingRooms = inferSharedRoomCount(lower, ["living room", "living", "great room", "lounge", "family room"]);
  const inferredKitchens = inferSharedRoomCount(lower, ["kitchen"]);
  const inferredDiningRooms = inferSharedRoomCount(lower, ["dining room", "dining area", "dining nook", "dining"]);
  const inferredPlot = inferPlot(lower);
  const inferredFacing = inferFacing(lower);
  const inferredRoadSide = inferRoadSide(lower);
  const inferredStyle = ["modern", "minimal", "traditional", "luxury", "industrial"].find(s => lower.includes(s)) ?? "Modern";
  const adjacency = form.adjacency || [];
  const features = removeNegatedFeatures(form.features ?? requestedOptionalFeaturesFromText(prompt, OPTIONAL_FEATURES), prompt, adjacency);
  return {
    title: form.title || "My Home Concept", prompt, floors: Math.min(3, Math.max(1, form.floors ?? inferredFloors ?? 1)),
    plotWidth: Math.max(8, form.plotWidth ?? inferredPlot?.plotWidth ?? 14), plotDepth: Math.max(8, form.plotDepth ?? inferredPlot?.plotDepth ?? 18), unit: form.unit || inferredPlot?.unit || "feet",
    bedrooms: Math.max(0, form.bedrooms ?? inferredBedrooms ?? 3), bathrooms: Math.max(0, form.bathrooms ?? inferredBathrooms ?? 2),
    livingRooms: form.livingRooms ?? inferredLivingRooms ?? 1, kitchens: form.kitchens ?? inferredKitchens ?? 1, diningRooms: form.diningRooms ?? inferredDiningRooms ?? 1,
    style: form.style || inferredStyle[0].toUpperCase() + inferredStyle.slice(1),
    facing: form.facing || inferredFacing || "unspecified", roadSide: form.roadSide || inferredRoadSide || inferredFacing || "unspecified",
    features,
    adjacency, warnings: form.warnings || [],
  };
}

export function generatePlans(brief: Brief): FloorPlan[] {
  const W = brief.plotWidth, D = brief.plotDepth;
  return Array.from({ length: brief.floors }, (_, level) => level === 0 && W >= feet(brief, 24) && D >= feet(brief, 32)
    ? generateArchitecturalGroundFloor(brief, level)
    : generateFallbackFloor(brief, level));
}

function generateFallbackFloor(brief: Brief, level: number): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const specs = roomSpecs(brief);
  const cols = specs.length <= 4 ? 2 : 3;
  const rows = Math.ceil(specs.length / cols);
  const rowDepth = D / rows;
  const rooms: Room[] = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    const rowSpecs = specs.slice(rowIndex * cols, (rowIndex + 1) * cols);
    const cellWidth = W / rowSpecs.length;
    rowSpecs.forEach((spec, colIndex) => rooms.push(room(level, spec.name, spec.type, colIndex * cellWidth, rowIndex * rowDepth, cellWidth, rowDepth)));
  }
  return makeFloorPlan(brief, level, rooms);
}

function roomSpecs(brief: Brief): { name: string; type: RoomType }[] {
  const specs: { name: string; type: RoomType }[] = [];
  for (let i = 0; i < brief.livingRooms; i++) specs.push({ name: brief.livingRooms > 1 ? `Living room ${i + 1}` : "Living room", type: "living" });
  for (let i = 0; i < brief.kitchens; i++) specs.push({ name: brief.kitchens > 1 ? `Kitchen ${i + 1}` : "Kitchen", type: "kitchen" });
  for (let i = 0; i < brief.diningRooms; i++) specs.push({ name: brief.diningRooms > 1 ? `Dining ${i + 1}` : "Dining", type: "dining" });
  for (let i = 0; i < brief.bedrooms; i++) specs.push({ name: `Bedroom ${i + 1}`, type: "bedroom" });
  for (let i = 0; i < brief.bathrooms; i++) specs.push({ name: i === 0 && brief.bedrooms && wantsAttachedBath(brief) ? "Attached bath" : `Bathroom ${i + 1}`, type: "bathroom" });
  if (brief.features.includes("internal_staircase")) specs.push({ name: "Internal stairs", type: "stairs" });
  if (brief.features.includes("garage")) specs.push({ name: "Garage", type: "garage" });
  if (brief.features.includes("utility")) specs.push({ name: "Utility", type: "utility" });
  if (brief.features.includes("study")) specs.push({ name: "Study", type: "study" });
  if (brief.features.includes("pantry")) specs.push({ name: "Pantry", type: "pantry" });
  if (brief.features.includes("laundry")) specs.push({ name: "Laundry", type: "laundry" });
  if (brief.features.includes("porch")) specs.push({ name: "Porch", type: "porch" });
  if (brief.features.includes("open_space")) specs.push({ name: "Open flexible space", type: "open" });
  if (brief.features.includes("prayer_room")) specs.push({ name: "Prayer room", type: "living" });
  return specs.length ? specs : [{ name: "Open room", type: "living" }];
}

function generateArchitecturalGroundFloor(brief: Brief, level: number): FloorPlan {
  const optimized = optimizeGroundFloor(brief, level);
  const roadSide = brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing;
  const candidates: FloorPlan[] = [];
  if (optimized) candidates.push(makeFloorPlan(brief, level, optimized.rooms));
  if ((roadSide === "north" || roadSide === "south") && brief.bedrooms === 3 && !brief.features.includes("garage") && brief.plotWidth >= feet(brief, 24) && brief.plotDepth >= feet(brief, 38)) {
    candidates.push(makeCompactThreeBedroomPlan(brief, level, roadSide));
  }
  if ((roadSide === "north" || roadSide === "south") && brief.bedrooms === 2 && !brief.features.includes("garage") && brief.plotWidth >= feet(brief, 24) && brief.plotDepth >= feet(brief, 32)) {
    candidates.push(makeCompactTwoBedroomOpenPlan(brief, level, roadSide));
  }
  candidates.push(roadSide === "north" || roadSide === "south"
    ? makeNorthSouthPlan(brief, level, roadSide)
    : makeEastWestPlan(brief, level, roadSide === "west" ? "west" : "east"));

  return candidates.find(plan => finalPlanErrors(brief, plan).length === 0) ?? candidates[0];
}

export function finalPlanErrors(brief: Brief, plan: FloorPlan) {
  return [...validatePlans([plan]), ...evaluateArchitecture(brief, plan).errors];
}

function makeCompactTwoBedroomOpenPlan(brief: Brief, level: number, roadSide: "north" | "south"): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const hasStairs = brief.features.includes("internal_staircase");
  const porchD = hasStairs ? target(brief, 9, 9.5, 10, D * 0.26) : target(brief, 6, 8, 10, D * 0.24);
  const leftW = target(brief, 10, 12, 13, W * 0.43);
  const centerW = target(brief, 7.5, 8, 9, W - leftW - feet(brief, 9.5));
  const rightW = W - leftW - centerW;
  const kitchenD = target(brief, 9, 10.5, 12, D * 0.3);
  const bathD = target(brief, 7, 7, 7.5, kitchenD);
  const frontY = D - porchD;
  const bedroomD = (frontY - bathD) / 2;
  const bathW = Math.min(feet(brief, 6.5), leftW * 0.52);
  const rooms: Room[] = [];

  rooms.push(room(level, "Common bath", "bathroom", 0, 0, bathW, bathD));
  rooms.push(room(level, "Service passage", "hallway", bathW, 0, leftW - bathW, bathD));
  rooms.push(room(level, "Kitchen", "kitchen", leftW, 0, centerW + rightW, kitchenD));
  rooms.push(room(level, "Bedroom 1", "bedroom", 0, bathD, leftW, bedroomD));
  rooms.push(room(level, "Bedroom 2", "bedroom", 0, bathD + bedroomD, leftW, bedroomD));
  rooms.push(room(level, "Front foyer", "foyer", 0, frontY, leftW, porchD));
  rooms.push(room(level, "Open dining area", "dining", leftW, kitchenD, centerW, frontY - kitchenD));
  rooms.push({ ...room(level, "Living area", "living", leftW + centerW, kitchenD, rightW, frontY - kitchenD), ...(wantsRoundedLiving(brief) ? { shape: "rounded" as const, curveSide: "east" as const } : {}) });
  rooms.push(room(level, hasStairs ? "Internal stairs" : "Entry passage", hasStairs ? "stairs" : "hallway", leftW, frontY, centerW, porchD));
  rooms.push(room(level, "Porch", "porch", leftW + centerW, frontY, rightW, porchD));

  const oriented = roadSide === "north" ? rooms.map(r => ({ ...r, y: D - r.y - r.depth })) : rooms;
  return makeFloorPlan(brief, level, oriented);
}

function makeCompactThreeBedroomPlan(brief: Brief, level: number, roadSide: "north" | "south"): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const hallW = clamp(W * 0.13, feet(brief, 3.5), feet(brief, 4.5));
  const hallX = clamp(W * 0.48, feet(brief, 11), W - hallW - feet(brief, 9));
  const leftW = hallX;
  const rightW = W - hallX - hallW;
  const publicD = clamp(D * 0.34, feet(brief, 13), feet(brief, 16));
  const frontY = D - publicD;
  const backD = D - publicD;
  const bathD = clamp(D * 0.18, feet(brief, 7), feet(brief, 8.5));
  const bathW = Math.min(rightW, feet(brief, 6.5));
  const hasLaundry = brief.features.includes("utility") || brief.features.includes("laundry");
  const laundryD = hasLaundry ? clamp(D * 0.12, feet(brief, 5), feet(brief, 6.5)) : 0;
  const rightBedroomD = backD - bathD * Math.min(2, brief.bathrooms) - laundryD;
  const leftBedroomD = backD / 2;
  const rooms: Room[] = [];

  rooms.push(room(level, "Central hallway", "hallway", hallX, 0, hallW, D));
  rooms.push(room(level, "Living room", "living", 0, frontY, leftW, publicD));
  if (brief.kitchens) rooms.push(room(level, "Kitchen", "kitchen", hallX + hallW, frontY, rightW, brief.diningRooms ? publicD * 0.58 : publicD));
  if (brief.diningRooms) rooms.push(room(level, "Dining area", "dining", hallX + hallW, frontY + publicD * 0.58, rightW, publicD * 0.42));
  rooms.push(room(level, "Bedroom 1", "bedroom", 0, 0, leftW, leftBedroomD));
  rooms.push(room(level, "Bedroom 2", "bedroom", 0, leftBedroomD, leftW, leftBedroomD));
  rooms.push(room(level, "Bedroom 3", "bedroom", hallX + hallW, 0, rightW, Math.max(feet(brief, 10), rightBedroomD)));
  if (brief.bathrooms >= 1) {
    const bathY = Math.max(feet(brief, 10), rightBedroomD);
    rooms.push(room(level, "Bathroom 1", "bathroom", hallX + hallW, bathY, bathW, bathD));
    if (rightW - bathW >= feet(brief, 3)) rooms.push(room(level, "Bath linen 1", "storage", hallX + hallW + bathW, bathY, rightW - bathW, bathD));
  }
  const wetTop = Math.max(feet(brief, 10), rightBedroomD) + bathD;
  const wetH = frontY - wetTop;
  if (brief.bathrooms >= 2 && hasLaundry && wetH >= feet(brief, 4)) {
    const wetRoomH = Math.min(wetH, feet(brief, 8.5));
    const halfBathW = Math.min(rightW * 0.48, feet(brief, 6.5));
    rooms.push(room(level, "Half bath", "bathroom", hallX + hallW, wetTop, halfBathW, wetRoomH));
    rooms.push(room(level, "Laundry", "laundry", hallX + hallW + halfBathW, wetTop, rightW - halfBathW, wetRoomH));
    if (wetH - wetRoomH >= feet(brief, 3.5)) rooms.push(room(level, "Service pocket", "storage", hallX + hallW, wetTop + wetRoomH, rightW, wetH - wetRoomH));
  } else {
    if (brief.bathrooms >= 2 && wetH >= feet(brief, 4)) rooms.push(room(level, "Half bath", "bathroom", hallX + hallW, wetTop, Math.min(rightW, feet(brief, 6.5)), Math.min(wetH, feet(brief, 8.5))));
    if (hasLaundry) rooms.push(room(level, "Laundry", "laundry", hallX + hallW, frontY - laundryD, rightW, laundryD));
  }

  const oriented = roadSide === "north" ? rooms.map(r => ({ ...r, y: D - r.y - r.depth })) : rooms;
  return makeFloorPlan(brief, level, oriented);
}

function makeEastWestPlan(brief: Brief, level: number, roadSide: "east" | "west"): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const hallW = clamp(W * 0.1, feet(brief, 3.5), feet(brief, 5));
  const leftW = clamp(W * 0.5, feet(brief, 15), W - hallW - feet(brief, 11));
  const rightW = W - leftW - hallW;
  const topH = clamp(D * 0.25, feet(brief, 13), feet(brief, 17));
  const foyerH = clamp(D * 0.11, feet(brief, 6), feet(brief, 8));
  const garageH = brief.features.includes("garage") ? clamp(D * 0.27, feet(brief, 15), feet(brief, 21)) : 0;
  const supportH = (brief.features.includes("utility") || brief.features.includes("laundry")) ? clamp(D * 0.12, feet(brief, 6), feet(brief, 8)) : 0;
  const privateTop = topH + foyerH;
  const privateBottom = D - supportH;
  const bathW = brief.bathrooms ? clamp(leftW * 0.32, feet(brief, 5.5), feet(brief, 7)) : 0;
  const bedW = leftW - bathW;
  const bedroomRows = Math.max(1, Math.min(brief.bedrooms, Math.floor((privateBottom - privateTop) / feet(brief, 8))));
  const bedH = bedroomRows ? (privateBottom - privateTop) / bedroomRows : 0;
  const bathH = brief.bathrooms ? clamp(bedH * 0.58, feet(brief, 7), feet(brief, 8.5)) : 0;
  const rooms: Room[] = [];

  rooms.push(room(level, "Central hallway", "hallway", leftW, 0, hallW, D));
  if (brief.livingRooms) rooms.push(room(level, brief.livingRooms > 1 ? "Great room 1" : "Great room", "living", leftW + hallW, 0, rightW, topH));
  if (brief.kitchens && brief.diningRooms) {
    rooms.push(room(level, "Kitchen", "kitchen", 0, 0, leftW * 0.48, topH));
    rooms.push(room(level, "Dining area", "dining", leftW * 0.48, 0, leftW * 0.52, topH));
  } else if (brief.kitchens) {
    rooms.push(room(level, "Kitchen", "kitchen", 0, 0, leftW, topH));
  } else if (brief.diningRooms) {
    rooms.push(room(level, "Dining area", "dining", 0, 0, leftW, topH));
  }
  const serviceW = clamp(leftW * 0.52, feet(brief, 9), feet(brief, 11));
  rooms.push(room(level, brief.features.includes("pantry") ? "Pantry" : "Service lobby", brief.features.includes("pantry") ? "pantry" : "hallway", leftW - serviceW, topH, serviceW, foyerH));
  if (leftW - serviceW >= feet(brief, 7)) rooms.push(room(level, "Store", "storage", 0, topH, leftW - serviceW, foyerH));
  rooms.push(room(level, "Foyer", "foyer", leftW + hallW, topH, rightW, foyerH));

  const stairTop = topH + foyerH;
  const stairH = clamp(D * 0.18, feet(brief, 10), feet(brief, 13));
  if (brief.features.includes("internal_staircase")) rooms.push(room(level, "Internal stairs", "stairs", leftW + hallW, stairTop, rightW, Math.min(stairH, Math.max(feet(brief, 6), D - garageH - stairTop))));
  const lobbyTop = stairTop + (brief.features.includes("internal_staircase") ? Math.min(stairH, Math.max(feet(brief, 6), D - garageH - stairTop)) : 0);
  const lobbyH = D - garageH - lobbyTop;
  if (lobbyH >= feet(brief, 4)) {
    const requestedStudy = brief.features.includes("study") && lobbyH >= feet(brief, 8);
    rooms.push(room(level, requestedStudy ? "Study" : brief.features.includes("garage") ? "Mudroom / garage lobby" : "Service pocket", requestedStudy ? "study" : "storage", leftW + hallW, lobbyTop, rightW, lobbyH));
  }
  if (brief.features.includes("garage")) rooms.push(room(level, "Garage", "garage", leftW + hallW, D - garageH, rightW, garageH));

  for (let i = 0; i < bedroomRows; i++) {
    const y = privateTop + i * bedH;
    if (i < brief.bedrooms) rooms.push(room(level, `Bedroom ${i + 1}`, "bedroom", 0, y, bedW || leftW, bedH));
    if (i < brief.bathrooms) {
      const entryH = Math.min(feet(brief, 4.5), Math.max(feet(brief, 3.5), bedH - bathH));
      rooms.push(room(level, i === 0 && wantsAttachedBath(brief) ? "Attached bath" : `Bathroom ${i + 1}`, "bathroom", bedW, y, bathW, bathH));
      if (i === 0) {
        const closetH = bedH - bathH;
        if (closetH >= feet(brief, 3)) rooms.push(room(level, "Wardrobe niche", "storage", bedW, y + bathH, bathW, closetH));
      } else {
        const closetH = bedH - bathH - entryH;
        if (closetH >= feet(brief, 3)) rooms.push(room(level, `Linen ${i + 1}`, "storage", bedW, y + bathH, bathW, closetH));
        if (entryH >= feet(brief, 3)) rooms.push(room(level, `Bedroom ${i + 1} entry`, "hallway", bedW, y + bedH - entryH, bathW, entryH));
      }
    }
  }

  if (brief.features.includes("utility")) rooms.push(room(level, "Utility", "utility", 0, D - supportH, clamp(leftW * 0.48, feet(brief, 8), feet(brief, 10)), supportH));
  if (brief.features.includes("laundry")) rooms.push(room(level, "Laundry", "laundry", leftW * 0.58, D - supportH, leftW * 0.42, supportH));

  const placed = roadSide === "east" ? rooms : rooms.map(r => ({ ...r, x: W - r.x - r.width }));
  return makeFloorPlan(brief, level, placed);
}

function makeNorthSouthPlan(brief: Brief, level: number, roadSide: "north" | "south"): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const hallD = clamp(D * 0.09, feet(brief, 3.5), feet(brief, 4.5));
  const frontD = clamp(D * 0.27, feet(brief, 12), feet(brief, 15));
  const serviceD = (brief.features.includes("utility") || brief.features.includes("laundry")) ? clamp(D * 0.18, brief.kitchens || brief.diningRooms ? feet(brief, 10) : feet(brief, 7), feet(brief, 12)) : 0;
  const privateD = D - frontD - hallD - serviceD;
  const publicW = clamp(W * 0.58, feet(brief, 16), W - feet(brief, 9));
  const foyerW = W - publicW;
  const bathW = brief.bathrooms ? clamp(W * 0.22, feet(brief, 5.5), feet(brief, 7)) : 0;
  const bedW = (W - bathW) / 2;
  const bathD = brief.bathrooms ? clamp(privateD * 0.45, feet(brief, 7), feet(brief, 8.5)) : 0;
  const serviceW = brief.features.includes("garage") ? clamp(W * 0.44, feet(brief, 12), feet(brief, 16)) : 0;
  const rooms: Room[] = [];

  rooms.push(room(level, "Foyer", "foyer", publicW, 0, foyerW, frontD));
  if (brief.livingRooms) rooms.push(room(level, brief.livingRooms > 1 ? "Great room 1" : "Great room", "living", 0, 0, publicW, frontD));
  rooms.push(room(level, "Central hallway", "hallway", 0, frontD, W, hallD));

  const privateTop = frontD + hallD;
  const bedroomCount = Math.min(brief.bedrooms, 2);
  if (bedroomCount >= 1) rooms.push(room(level, "Bedroom 1", "bedroom", 0, privateTop, bedW, privateD));
  if (bedroomCount >= 2) rooms.push(room(level, "Bedroom 2", "bedroom", bedW, privateTop, bedW, privateD));
  if (brief.bathrooms >= 1) {
    rooms.push(room(level, wantsAttachedBath(brief) ? "Attached bath" : "Bathroom 1", "bathroom", bedW * 2, privateTop, bathW, bathD));
    if (brief.bathrooms >= 2) rooms.push(room(level, "Bathroom 2", "bathroom", bedW * 2, privateTop + bathD, bathW, bathD));
    const usedBathD = brief.bathrooms >= 2 ? bathD * 2 : bathD;
    const storageD = privateD - usedBathD;
    if (storageD >= feet(brief, 4)) rooms.push(room(level, "Wardrobe niche", "storage", bedW * 2, privateTop + usedBathD, bathW, storageD));
  }

  const serviceTop = frontD + hallD + privateD;
  if (serviceD > 0) {
    const leftServiceW = serviceW ? W - serviceW : W;
    const utilityW = brief.features.includes("utility") ? clamp(leftServiceW * 0.3, feet(brief, 7), feet(brief, 9)) : 0;
    const kitchenDiningW = leftServiceW - utilityW;
    if (brief.kitchens) rooms.push(room(level, "Kitchen", "kitchen", 0, serviceTop, kitchenDiningW * 0.48, serviceD));
    if (brief.diningRooms) rooms.push(room(level, "Dining area", "dining", kitchenDiningW * 0.48, serviceTop, kitchenDiningW * 0.52, serviceD));
    if (brief.features.includes("utility")) rooms.push(room(level, "Utility", "utility", kitchenDiningW, serviceTop, utilityW, serviceD));
    if (brief.features.includes("garage")) rooms.push(room(level, "Garage", "garage", W - serviceW, serviceTop, serviceW, serviceD));
  } else {
    const backTop = frontD + hallD + privateD;
    if (brief.kitchens) rooms.push(room(level, "Kitchen", "kitchen", 0, backTop, W * 0.48, D - backTop));
    if (brief.diningRooms) rooms.push(room(level, "Dining area", "dining", W * 0.48, backTop, W * 0.52, D - backTop));
  }
  if (brief.features.includes("internal_staircase") && privateD >= feet(brief, 11)) rooms.push(room(level, "Internal stairs", "stairs", W - clamp(W * 0.25, feet(brief, 7), feet(brief, 9)), privateTop, clamp(W * 0.25, feet(brief, 7), feet(brief, 9)), clamp(privateD * 0.45, feet(brief, 10), feet(brief, 13))));

  const placed = roadSide === "south" ? rooms : rooms.map(r => ({ ...r, y: D - r.y - r.depth }));
  return makeFloorPlan(brief, level, placed);
}

function makeFloorPlan(brief: Brief, level: number, rooms: Room[]): FloorPlan {
  const plan = { id: `floor-${level}-${uid()}`, level, elevation: level * (brief.unit === "feet" ? 10 : 3.05), width: brief.plotWidth, depth: brief.plotDepth, unit: brief.unit, facing: brief.facing, roadSide: brief.roadSide, rooms, openings: [] as Opening[] };
  plan.openings = generateOpenings(plan, brief);
  return plan;
}

function generateOpenings(plan: FloorPlan, brief: Brief): Opening[] {
  const roadSide = brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing;
  const doorWidth = feet(brief, 3);
  const openings: Opening[] = [];

  plan.rooms.forEach(r => {
    if (isMainEntryRoom(r) && roadSide !== "unspecified" && touchesExteriorWall(r, plan, roadSide)) openings.push({ id: `main-door-${r.id}`, kind: "door", wall: roadSide, roomId: r.id, offset: 0.5, width: Math.min(doorWidth, roadSide === "north" || roadSide === "south" ? r.width * 0.8 : r.depth * 0.8) });
    if (r.type === "garage" && roadSide !== "unspecified") openings.push({ id: `garage-door-${r.id}`, kind: "door", wall: roadSide, roomId: r.id, offset: 0.5, width: Math.min(feet(brief, 9), roadSide === "north" || roadSide === "south" ? r.width * 0.7 : r.depth * 0.7) });
    const directBedroomBath = r.type === "bathroom" && r.name.toLowerCase().includes("attached")
      ? plan.rooms.find(other => other.type === "bedroom" && other.name === "Bedroom 1" && sharedWall(r, other))
      : null;
    const accessRoom = directBedroomBath ?? plan.rooms.find(other => other.id !== r.id && isDoorTarget(r, other) && sharedWall(r, other));
    const doorWall = accessRoom ? sharedWall(r, accessRoom) : null;
    if (doorWall && accessRoom && !isDoorlessCirculation(r)) {
      const width = Math.min(doorWidth, doorWall === "north" || doorWall === "south" ? r.width * 0.35 : r.depth * 0.35);
      openings.push({ id: `door-${r.id}`, kind: "door", wall: doorWall, roomId: r.id, offset: doorOffset(r, accessRoom, doorWall, width), width });
    }
    if (r.type === "stairs") {
      plan.rooms.filter(other => other.id !== r.id && other.id !== accessRoom?.id && isDoorTarget(r, other) && sharedWall(r, other)).forEach((target, index) => {
        const wall = sharedWall(r, target);
        if (!wall) return;
        const width = Math.min(doorWidth, wall === "north" || wall === "south" ? r.width * 0.35 : r.depth * 0.35);
        openings.push({ id: `door-${r.id}-${index + 2}`, kind: "door", wall, roomId: r.id, offset: doorOffset(r, target, wall, width), width });
      });
    }
    const exterior = exteriorWall(r, plan);
    if (exterior && !["hallway", "foyer", "stairs", "garage", "porch", "open"].includes(r.type)) openings.push({ id: `window-${r.id}`, kind: "window", wall: exterior, roomId: r.id, offset: 0.5, width: Math.min(feet(brief, 5), exterior === "north" || exterior === "south" ? r.width * 0.55 : r.depth * 0.55) });
    if (!exterior && needsWetVentilation(r)) {
      const ventWall = ventWallForRoom(r, plan);
      openings.push({ id: `vent-${r.id}`, kind: "vent", wall: ventWall, roomId: r.id, offset: 0.5, width: Math.min(feet(brief, 2), ventWall === "north" || ventWall === "south" ? r.width * 0.45 : r.depth * 0.45) });
    }
  });
  return openings;
}

function isAccessRoom(room: Room) {
  const name = room.name.toLowerCase();
  return ["hallway", "foyer", "porch", "open"].includes(room.type) || name.includes("open dining") || name.includes("lobby") || name.includes("passage");
}

function isDoorTarget(room: Room, target: Room) {
  if (isAccessRoom(target)) return true;
  if (room.type === "garage" && target.type === "storage") return true;
  return [
    "utility:kitchen", "utility:bathroom",
    "laundry:kitchen", "laundry:bathroom",
    "pantry:kitchen",
    "kitchen:dining",
    "dining:kitchen",
  ].includes(`${room.type}:${target.type}`);
}

function isMainEntryRoom(room: Room) {
  return ["foyer", "porch", "open"].includes(room.type) || room.type === "hallway";
}

function isDoorlessCirculation(room: Room) {
  return isAccessRoom(room) && room.type !== "stairs";
}

function sharedWall(room: Room, target: Room): Opening["wall"] | null {
  if (nearly(room.x + room.width, target.x) && overlap(room.y, room.y + room.depth, target.y, target.y + target.depth) > 1) return "east";
  if (nearly(room.x, target.x + target.width) && overlap(room.y, room.y + room.depth, target.y, target.y + target.depth) > 1) return "west";
  if (nearly(room.y + room.depth, target.y) && overlap(room.x, room.x + room.width, target.x, target.x + target.width) > 1) return "south";
  if (nearly(room.y, target.y + target.depth) && overlap(room.x, room.x + room.width, target.x, target.x + target.width) > 1) return "north";
  return null;
}

function doorOffset(room: Room, target: Room, wall: Opening["wall"], width: number) {
  const horizontal = wall === "north" || wall === "south";
  const start = horizontal ? Math.max(room.x, target.x) : Math.max(room.y, target.y);
  const end = horizontal ? Math.min(room.x + room.width, target.x + target.width) : Math.min(room.y + room.depth, target.y + target.depth);
  const roomStart = horizontal ? room.x : room.y;
  const roomLength = horizontal ? room.width : room.depth;
  const usable = Math.max(0.01, roomLength - width);
  const centered = (start + end) / 2 - roomStart - width / 2;
  return clamp(centered / usable, 0.08, 0.92);
}

function ventWallForRoom(room: Room, plan: FloorPlan): Opening["wall"] {
  const preferred = (["north", "east", "south", "west"] as Opening["wall"][]).find(wall =>
    plan.rooms.some(other => other.id !== room.id && ["hallway", "storage", "open"].includes(other.type) && sharedWall(room, other) === wall));
  if (preferred) return preferred;
  return (["north", "east", "south", "west"] as Opening["wall"][]).find(wall =>
    plan.rooms.some(other => other.id !== room.id && sharedWall(room, other) === wall)) ?? "north";
}

function exteriorWall(room: Room, plan: FloorPlan): Opening["wall"] | null {
  if (nearly(room.y, 0)) return "north";
  if (nearly(room.x + room.width, plan.width)) return "east";
  if (nearly(room.y + room.depth, plan.depth)) return "south";
  if (nearly(room.x, 0)) return "west";
  return null;
}

function touchesExteriorWall(room: Room, plan: FloorPlan, wall: Opening["wall"]) {
  if (wall === "north") return nearly(room.y, 0);
  if (wall === "east") return nearly(room.x + room.width, plan.width);
  if (wall === "south") return nearly(room.y + room.depth, plan.depth);
  return nearly(room.x, 0);
}

export function validatePlans(plans: FloorPlan[]): string[] {
  const errors: string[] = [];
  plans.forEach(plan => {
    const briefLike: Brief = { title: "", prompt: "", floors: 1, plotWidth: plan.width, plotDepth: plan.depth, unit: plan.unit, bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0, diningRooms: 0, style: "", facing: plan.facing, roadSide: plan.roadSide, features: [], adjacency: [], warnings: [] };
    plan.rooms.forEach((room, i) => {
      if (!roomMeetsMinimum(room, briefLike)) errors.push(`${room.name} is smaller than the recommended minimum.`);
      if (room.x < 0 || room.y < 0 || room.x + room.width > plan.width + .01 || room.y + room.depth > plan.depth + .01) errors.push(`${room.name} extends outside the plot.`);
      plan.rooms.slice(i + 1).forEach(other => {
        const overlap = room.x < other.x + other.width - .02 && room.x + room.width > other.x + .02 && room.y < other.y + other.depth - .02 && room.y + room.depth > other.y + .02;
        if (overlap) errors.push(`${room.name} overlaps ${other.name}.`);
      });
    });
  });
  return [...new Set(errors)];
}

export function createProject(brief: Brief): Project {
  const plans = generatePlans(brief); const base = PRESETS[brief.style] || PRESETS.Modern;
  return { id: uid(), version: 1, state: "plan_editing", brief, plans, materials: Object.fromEntries(plans.flatMap(p => p.rooms.map(r => [r.id, { ...base }]))), updatedAt: new Date().toISOString() };
}
