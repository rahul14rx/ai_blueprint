import { Brief, RoomType, WallSide } from "./studio-types";
import { ROOM_RULES, toUnit, wantsAttachedBath } from "./layout-rules";

export type PlacementHint =
  | "front"
  | "rear"
  | "left"
  | "right"
  | "center"
  | "near_kitchen"
  | "near_bath"
  | "near_bedrooms"
  | "road_side"
  | "exterior";

export type RoomRequirement = {
  key: string;
  name: string;
  type: RoomType;
  minWidth: number;
  minDepth: number;
  idealWidth: number;
  idealDepth: number;
  zone: "public" | "private" | "service" | "circulation" | "vehicle" | "outdoor";
  hints: PlacementHint[];
  shape?: "rect" | "rounded";
  curveSide?: WallSide;
  attachedTo?: string;
};

export type ProgramEdge = {
  from: string;
  to: string;
  kind: "required_access" | "preferred_adjacent" | "service_near" | "avoid";
  weight: number;
};

export type LayoutProgram = {
  rooms: RoomRequirement[];
  edges: ProgramEdge[];
};

const wantsRoundedLiving = (brief: Brief) => /\b(round|rounded|curved|curve|semi[-\s]?circular|circular)\b.*\b(living|lounge|great room)\b|\b(living|lounge|great room)\b.*\b(round|rounded|curved|curve|semi[-\s]?circular|circular)\b/i.test(brief.prompt);

function req(brief: Brief, key: string, name: string, type: RoomType, hints: PlacementHint[] = [], extra: Partial<RoomRequirement> = {}): RoomRequirement {
  const rule = ROOM_RULES[type];
  return {
    key,
    name,
    type,
    minWidth: toUnit(brief, rule.minWidth),
    minDepth: toUnit(brief, rule.minDepth),
    idealWidth: toUnit(brief, rule.idealWidth),
    idealDepth: toUnit(brief, rule.idealDepth),
    zone: rule.zone,
    hints,
    ...extra,
  };
}

export function buildLayoutProgram(brief: Brief): LayoutProgram {
  const rooms: RoomRequirement[] = [];
  const edges: ProgramEdge[] = [];
  const roundedLiving = wantsRoundedLiving(brief);

  for (let i = 0; i < brief.livingRooms; i++) {
    rooms.push(req(brief, `living-${i + 1}`, brief.livingRooms > 1 ? `Living room ${i + 1}` : "Living room", "living", ["front", "road_side", "exterior"], roundedLiving && i === 0 ? { shape: "rounded" } : {}));
  }
  for (let i = 0; i < brief.kitchens; i++) rooms.push(req(brief, `kitchen-${i + 1}`, brief.kitchens > 1 ? `Kitchen ${i + 1}` : "Kitchen", "kitchen", ["rear", "exterior"]));
  for (let i = 0; i < brief.diningRooms; i++) rooms.push(req(brief, `dining-${i + 1}`, brief.diningRooms > 1 ? `Dining area ${i + 1}` : "Dining area", "dining", ["center", "near_kitchen"]));
  for (let i = 0; i < brief.bedrooms; i++) rooms.push(req(brief, `bedroom-${i + 1}`, `Bedroom ${i + 1}`, "bedroom", ["rear", "exterior", "near_bath"]));
  for (let i = 0; i < brief.bathrooms; i++) {
    const attached = i === 0 && wantsAttachedBath(brief);
    rooms.push(req(brief, `bathroom-${i + 1}`, attached ? "Attached bath" : /half bath|powder|toilet/i.test(brief.prompt) && i === brief.bathrooms - 1 ? "Half bath" : `Bathroom ${i + 1}`, "bathroom", ["near_bedrooms", "near_bath"], attached ? { attachedTo: "bedroom-1" } : {}));
  }
  if (brief.features.includes("garage")) rooms.push(req(brief, "garage-1", "Garage", "garage", ["front", "road_side"]));
  if (brief.features.includes("internal_staircase")) rooms.push(req(brief, "stairs-1", "Internal stairs", "stairs", ["front", "center"]));
  if (brief.features.includes("utility")) rooms.push(req(brief, "utility-1", "Utility", "utility", ["rear", "near_kitchen"]));
  if (brief.features.includes("laundry")) rooms.push(req(brief, "laundry-1", "Laundry", "laundry", ["near_kitchen", "near_bath"]));
  if (brief.features.includes("pantry")) rooms.push(req(brief, "pantry-1", "Pantry", "pantry", ["near_kitchen"]));
  if (brief.features.includes("study")) rooms.push(req(brief, "study-1", "Study", "study", ["exterior"]));
  if (brief.features.includes("porch")) rooms.push(req(brief, "porch-1", "Porch", "porch", ["front", "road_side"]));

  const accessKeys = rooms.filter(room => room.zone !== "outdoor").map(room => room.key);
  accessKeys.forEach(key => edges.push({ from: "entry", to: key, kind: "required_access", weight: 100 }));
  rooms.filter(room => room.type === "kitchen").forEach(kitchen => rooms.filter(room => room.type === "dining").forEach(dining => edges.push({ from: kitchen.key, to: dining.key, kind: "preferred_adjacent", weight: 35 })));
  rooms.filter(room => room.type === "bedroom").forEach(bedroom => rooms.filter(room => room.type === "bathroom").forEach(bath => edges.push({ from: bedroom.key, to: bath.key, kind: "service_near", weight: 18 })));
  rooms.filter(room => room.type === "utility" || room.type === "laundry" || room.type === "pantry").forEach(service => rooms.filter(room => room.type === "kitchen").forEach(kitchen => edges.push({ from: service.key, to: kitchen.key, kind: "service_near", weight: 20 })));

  return { rooms, edges };
}
