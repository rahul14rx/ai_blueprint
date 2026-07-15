import { Brief, FloorPlan, Opening, Room, RoomType, WallSide } from "./studio-types";

export type LayoutZone = "public" | "private" | "service" | "circulation" | "vehicle" | "outdoor";

export type RoomRule = {
  minWidth: number;
  minDepth: number;
  idealWidth: number;
  idealDepth: number;
  maxWidth?: number;
  maxDepth?: number;
  zone: LayoutZone;
  needsExterior?: boolean;
  needsAccess?: boolean;
  preferredExterior?: boolean;
};

export const ROOM_RULES: Record<RoomType, RoomRule> = {
  living: { minWidth: 10, minDepth: 12, idealWidth: 15, idealDepth: 16, zone: "public", needsExterior: true, needsAccess: true },
  kitchen: { minWidth: 8, minDepth: 10, idealWidth: 10, idealDepth: 12, zone: "service", needsExterior: true, needsAccess: true },
  bedroom: { minWidth: 10, minDepth: 10, idealWidth: 12, idealDepth: 13, zone: "private", needsExterior: true, needsAccess: true },
  bathroom: { minWidth: 5, minDepth: 7, idealWidth: 6, idealDepth: 8, maxWidth: 8, maxDepth: 10, zone: "service", needsAccess: true },
  dining: { minWidth: 8, minDepth: 10, idealWidth: 10, idealDepth: 12, zone: "public", needsExterior: true, needsAccess: true },
  garage: { minWidth: 10, minDepth: 16, idealWidth: 12, idealDepth: 18, zone: "vehicle", needsAccess: true },
  stairs: { minWidth: 6, minDepth: 9, idealWidth: 7, idealDepth: 11, zone: "circulation", needsAccess: true },
  foyer: { minWidth: 5, minDepth: 6, idealWidth: 7, idealDepth: 8, zone: "circulation", needsAccess: true },
  hallway: { minWidth: 3.5, minDepth: 3.5, idealWidth: 4.25, idealDepth: 8, zone: "circulation" },
  utility: { minWidth: 5, minDepth: 6, idealWidth: 7, idealDepth: 8, zone: "service", needsAccess: true },
  study: { minWidth: 8, minDepth: 8, idealWidth: 10, idealDepth: 10, zone: "private", needsExterior: true, needsAccess: true },
  pantry: { minWidth: 4, minDepth: 5, idealWidth: 5, idealDepth: 6, zone: "service", needsAccess: true },
  laundry: { minWidth: 5, minDepth: 6, idealWidth: 6, idealDepth: 7, zone: "service", needsAccess: true },
  storage: { minWidth: 3, minDepth: 3, idealWidth: 4, idealDepth: 5, zone: "service" },
  porch: { minWidth: 5, minDepth: 5, idealWidth: 8, idealDepth: 8, zone: "outdoor" },
  open: { minWidth: 4, minDepth: 4, idealWidth: 8, idealDepth: 10, zone: "circulation" },
};

export function toUnit(brief: Brief, feet: number) {
  return brief.unit === "feet" ? feet : feet * 0.3048;
}

export function fromFeet(unit: Brief["unit"], feet: number) {
  return unit === "feet" ? feet : feet * 0.3048;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function targetSize(brief: Brief, min: number, ideal: number, max: number, available: number) {
  return clamp(toUnit(brief, ideal), toUnit(brief, min), Math.min(toUnit(brief, max), available));
}

export function roomRule(type: RoomType) {
  return ROOM_RULES[type];
}

export function roomMeetsMinimum(room: Room, brief: Brief) {
  const rule = roomRule(room.type);
  const minWidth = toUnit(brief, rule.minWidth);
  const minDepth = toUnit(brief, rule.minDepth);
  const shortSide = Math.min(room.width, room.depth);
  const longSide = Math.max(room.width, room.depth);
  return shortSide >= Math.min(minWidth, minDepth) && longSide >= Math.max(minWidth, minDepth);
}

export function roomExceedsMaximum(room: Room, brief: Brief) {
  const rule = roomRule(room.type);
  if (!rule.maxWidth && !rule.maxDepth) return false;
  const maxWidth = rule.maxWidth ? toUnit(brief, rule.maxWidth) : Number.POSITIVE_INFINITY;
  const maxDepth = rule.maxDepth ? toUnit(brief, rule.maxDepth) : Number.POSITIVE_INFINITY;
  const shortSide = Math.min(room.width, room.depth);
  const longSide = Math.max(room.width, room.depth);
  return shortSide > Math.min(maxWidth, maxDepth) + 0.01 || longSide > Math.max(maxWidth, maxDepth) + 0.01;
}

export function nearly(a: number, b: number) {
  return Math.abs(a - b) < 0.03;
}

export function intervalOverlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

export function sharedWall(a: Room, b: Room): Opening["wall"] | null {
  if (nearly(a.x + a.width, b.x) && intervalOverlap(a.y, a.y + a.depth, b.y, b.y + b.depth) > 1) return "east";
  if (nearly(a.x, b.x + b.width) && intervalOverlap(a.y, a.y + a.depth, b.y, b.y + b.depth) > 1) return "west";
  if (nearly(a.y + a.depth, b.y) && intervalOverlap(a.x, a.x + a.width, b.x, b.x + b.width) > 1) return "south";
  if (nearly(a.y, b.y + b.depth) && intervalOverlap(a.x, a.x + a.width, b.x, b.x + b.width) > 1) return "north";
  return null;
}

export function roomsTouch(a: Room, b: Room) {
  return sharedWall(a, b) !== null;
}

export function exteriorWalls(room: Room, plan: Pick<FloorPlan, "width" | "depth">): Opening["wall"][] {
  const walls: Opening["wall"][] = [];
  if (nearly(room.y, 0)) walls.push("north");
  if (nearly(room.x + room.width, plan.width)) walls.push("east");
  if (nearly(room.y + room.depth, plan.depth)) walls.push("south");
  if (nearly(room.x, 0)) walls.push("west");
  return walls;
}

export function resolvedRoadSide(brief: Brief) {
  return brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing;
}

export function isCirculationLike(room: Room) {
  const name = room.name.toLowerCase();
  return ["hallway", "foyer", "porch", "open"].includes(room.type) || name.includes("open dining") || name.includes("lobby") || name.includes("passage");
}

export function roomMatches(room: Room, type: RoomType) {
  return room.type === type || (type === "dining" && room.name.toLowerCase().includes("dining"));
}

export function requiresDirectKitchenDining(brief: Brief) {
  const text = `${brief.prompt} ${brief.adjacency.join(" ")}`.toLowerCase();
  return /kitchen[^.]{0,50}(beside|adjacent|next to|directly|connected|open to)[^.]{0,50}dining|dining[^.]{0,50}(beside|adjacent|next to|directly|connected|open to)[^.]{0,50}kitchen/.test(text);
}

export function wantsAttachedBath(brief: Brief) {
  const text = `${brief.prompt} ${brief.adjacency.join(" ")}`.toLowerCase();
  if (/\b(no|not|without|avoid)\b[^.]{0,45}\b(attached bath|attached bathroom|ensuite|en-suite|en suite)\b|\b(do not|don't)\b[^.]{0,45}\b(attached bath|attached bathroom|ensuite|en-suite|en suite)\b/.test(text)) return false;
  return /\b(attached bath|attached bathroom|ensuite|en-suite|en suite)\b/.test(text) || /\bbath(room)?\b[^.]{0,40}\battached\b|\battached\b[^.]{0,40}\bbath(room)?\b/.test(text);
}

export function needsWetVentilation(room: Room) {
  return ["bathroom", "kitchen", "utility", "laundry"].includes(room.type);
}

export type PlacementSide = WallSide | "center";
export type PlacementIntent = { type: RoomType; sides: PlacementSide[]; source: string };

const oppositeSide: Record<WallSide, WallSide> = { north: "south", south: "north", east: "west", west: "east" };

const ROOM_ALIASES: Array<{ type: RoomType; pattern: RegExp }> = [
  { type: "living", pattern: /\b(living|great room|lounge|family room)\b/i },
  { type: "kitchen", pattern: /\bkitchen\b/i },
  { type: "dining", pattern: /\b(dining|dining area|dining room)\b/i },
  { type: "bedroom", pattern: /\b(bedroom|bedrooms|bed)\b/i },
  { type: "bathroom", pattern: /\b(bathroom|bath|toilet|powder|half bath|full bathroom)\b/i },
  { type: "laundry", pattern: /\blaundry\b/i },
  { type: "utility", pattern: /\butility\b/i },
  { type: "garage", pattern: /\bgarage\b/i },
  { type: "stairs", pattern: /\b(stair|stairs|staircase)\b/i },
  { type: "foyer", pattern: /\b(foyer|entry|entrance)\b/i },
  { type: "porch", pattern: /\b(porch|veranda|sit-out|sitout)\b/i },
  { type: "study", pattern: /\b(study|office|flex room)\b/i },
  { type: "pantry", pattern: /\bpantry\b/i },
];

function sideFromRelative(word: "front" | "rear" | "back" | "left" | "right", roadSide: WallSide): WallSide {
  if (word === "front") return roadSide;
  if (word === "rear" || word === "back") return oppositeSide[roadSide];
  if (word === "left") return "west";
  return "east";
}

function placementSides(text: string, roadSide: WallSide): PlacementSide[] {
  const lower = text.toLowerCase().replace(/\b(north|south|east|west)[-\s]?facing\b/g, "");
  const sides = new Set<PlacementSide>();
  if (/\bfront\b/.test(lower)) sides.add(sideFromRelative("front", roadSide));
  if (/\b(rear|back)\b/.test(lower)) sides.add(sideFromRelative("rear", roadSide));
  if (/\bleft\b/.test(lower)) sides.add(sideFromRelative("left", roadSide));
  if (/\bright\b/.test(lower)) sides.add(sideFromRelative("right", roadSide));
  if (/\b(top|north)\b/.test(lower)) sides.add("north");
  if (/\b(bottom|south)\b/.test(lower)) sides.add("south");
  if (/\beast\b/.test(lower)) sides.add("east");
  if (/\bwest\b/.test(lower)) sides.add("west");
  if (/\b(center|central|middle)\b/.test(lower)) sides.add("center");
  return [...sides];
}

export function explicitPlacementIntents(brief: Brief): PlacementIntent[] {
  const roadSide = resolvedRoadSide(brief);
  if (roadSide === "unspecified") return [];
  const text = `${brief.prompt}. ${brief.adjacency.join(". ")}`;
  return text.split(/[.;,\n]+/).flatMap(part => {
    const sides = placementSides(part, roadSide);
    if (!sides.length) return [];
    return ROOM_ALIASES.filter(alias => alias.pattern.test(part)).map(alias => ({ type: alias.type, sides, source: part.trim() }));
  });
}

export function placementDistance(room: Room, plan: Pick<FloorPlan, "width" | "depth">, side: PlacementSide) {
  const cx = room.x + room.width / 2;
  const cy = room.y + room.depth / 2;
  if (side === "center") return Math.abs(cx - plan.width / 2) / Math.max(1, plan.width / 2) + Math.abs(cy - plan.depth / 2) / Math.max(1, plan.depth / 2);
  if (side === "north") return cy / Math.max(1, plan.depth);
  if (side === "south") return (plan.depth - cy) / Math.max(1, plan.depth);
  if (side === "east") return (plan.width - cx) / Math.max(1, plan.width);
  return cx / Math.max(1, plan.width);
}
