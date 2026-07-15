import { Brief, FloorPlan, Opening, Room, RoomType } from "./studio-types";

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

export function needsWetVentilation(room: Room) {
  return ["bathroom", "kitchen", "utility", "laundry"].includes(room.type);
}
