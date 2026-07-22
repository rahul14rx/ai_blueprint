import { Brief, FloorPlan, Opening, Room, RoomType } from "./studio-types";
import { ROOM_RULES, exteriorWalls, isCirculationLike, needsWetVentilation, requiresDirectKitchenDining, requiresPassableKitchenDining, roomExceedsMaximum, roomMatches, roomMeetsMinimum, roomsTouch, sharedWall, toUnit } from "./layout-rules";

export type ArchitectureIssue = {
  severity: "error" | "warning";
  category: "size" | "access" | "adjacency" | "light" | "road" | "brief";
  message: string;
};

export type ArchitectureReport = {
  score: number;
  issues: ArchitectureIssue[];
  errors: string[];
  warnings: string[];
};

function add(issues: ArchitectureIssue[], severity: ArchitectureIssue["severity"], category: ArchitectureIssue["category"], message: string) {
  issues.push({ severity, category, message });
}

function hasWindow(room: Room, plan: FloorPlan) {
  return plan.openings.some(opening => opening.roomId === room.id && opening.kind === "window");
}

function hasVent(room: Room, plan: FloorPlan) {
  return plan.openings.some(opening => opening.roomId === room.id && opening.kind === "vent");
}

function hasVentilation(room: Room, plan: FloorPlan) {
  return hasWindow(room, plan) || hasVent(room, plan);
}

function hasBorrowedLight(room: Room, plan: FloorPlan) {
  if (room.type !== "dining" || !room.name.toLowerCase().includes("open")) return false;
  return plan.rooms.some(other =>
    ["kitchen", "living", "foyer"].includes(other.type) &&
    roomsTouch(room, other) &&
    (hasWindow(other, plan) || exteriorWalls(other, plan).length > 0)
  );
}

function roomHasRoadDoor(room: Room, plan: FloorPlan, brief: Brief) {
  const roadSide = brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing;
  return roadSide !== "unspecified" && exteriorWalls(room, plan).includes(roadSide) && plan.openings.some(opening => opening.roomId === room.id && opening.kind === "door" && opening.wall === roadSide);
}

function planHasMainEntryDoor(plan: FloorPlan, brief: Brief) {
  return plan.rooms.some(room => isCirculationLike(room) && roomHasRoadDoor(room, plan, brief));
}

function openingSpan(owner: Room, opening: Opening) {
  const horizontal = opening.wall === "north" || opening.wall === "south";
  const roomStart = horizontal ? owner.x : owner.y;
  const roomLength = horizontal ? owner.width : owner.depth;
  const start = roomStart + (roomLength - opening.width) * opening.offset;
  return { horizontal, start, end: start + opening.width };
}

function openingTargetRoom(plan: FloorPlan, owner: Room, opening: Opening) {
  const span = openingSpan(owner, opening);
  const matches = plan.rooms.filter(other => other.id !== owner.id && sharedWall(owner, other) === opening.wall);
  return matches.find(other => {
    const start = span.horizontal ? other.x : other.y;
    const end = span.horizontal ? other.x + other.width : other.y + other.depth;
    return overlapAmount(span.start, span.end, start, end) > Math.min(planFeet(plan, 1), opening.width * 0.45);
  }) ?? matches[0] ?? null;
}

function doorTargetsForRoom(room: Room, plan: FloorPlan) {
  const targets: Room[] = [];
  plan.openings.filter(opening => opening.kind === "door").forEach(opening => {
    const owner = plan.rooms.find(candidate => candidate.id === opening.roomId);
    if (!owner) return;
    if (owner.id === room.id) {
      const target = openingTargetRoom(plan, owner, opening);
      if (target) targets.push(target);
      return;
    }
    const target = openingTargetRoom(plan, owner, opening);
    if (target?.id === room.id) targets.push(owner);
  });
  return targets;
}

function roomHasUsableDoor(room: Room, plan: FloorPlan, brief: Brief) {
  return doorTargetsForRoom(room, plan).length > 0 || roomHasRoadDoor(room, plan, brief);
}

function roomNeedsExplicitDoor(room: Room) {
  return ["bedroom", "bathroom", "garage", "stairs", "utility", "laundry", "pantry", "study", "storage", "balcony"].includes(room.type);
}

function roomHasDoorToCirculation(room: Room, plan: FloorPlan) {
  return doorTargetsForRoom(room, plan).some(isCirculationLike);
}

function roomHasDoorToAny(room: Room, plan: FloorPlan, types: RoomType[]) {
  return doorTargetsForRoom(room, plan).some(target => types.includes(target.type) || isCirculationLike(target));
}

function garageHasInternalAccess(room: Room, plan: FloorPlan) {
  return doorTargetsForRoom(room, plan).some(target => isCirculationLike(target) || ["utility", "storage", "living"].includes(target.type));
}

function bathroomHasValidDoor(room: Room, plan: FloorPlan) {
  const attached = room.name.toLowerCase().includes("attached");
  return doorTargetsForRoom(room, plan).some(target => attached ? target.type === "bedroom" : isCirculationLike(target));
}

function buildAccessGraph(plan: FloorPlan) {
  const graph = new Map<string, Set<string>>();
  plan.rooms.forEach(room => graph.set(room.id, new Set()));

  plan.openings.filter(opening => opening.kind === "door").forEach(opening => {
    const owner = plan.rooms.find(room => room.id === opening.roomId);
    if (!owner) return;
    const target = openingTargetRoom(plan, owner, opening);
    if (!target) return;
    graph.get(owner.id)?.add(target.id);
    graph.get(target.id)?.add(owner.id);
  });

  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const a = plan.rooms[i];
      const b = plan.rooms[j];
      if (!roomsTouch(a, b)) continue;
      const circulation = (isCirculationLike(a) && !roomNeedsExplicitDoor(b)) || (isCirculationLike(b) && !roomNeedsExplicitDoor(a));
      const directRoomPair = [
        "kitchen:dining", "dining:kitchen",
        "living:dining", "dining:living",
      ].includes(`${a.type}:${b.type}`);
      if (circulation || directRoomPair) {
        graph.get(a.id)?.add(b.id);
        graph.get(b.id)?.add(a.id);
      }
    }
  }

  return graph;
}

function reachableRooms(plan: FloorPlan, brief: Brief) {
  const graph = buildAccessGraph(plan);
  const start = plan.rooms.find(room => isCirculationLike(room) && roomHasRoadDoor(room, plan, brief)) ?? plan.rooms.find(room => room.type === "foyer") ?? plan.rooms.find(room => isCirculationLike(room));
  const seen = new Set<string>();
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    graph.get(id)?.forEach(next => { if (!seen.has(next)) queue.push(next); });
  }
  return seen;
}

function countRooms(plan: FloorPlan, type: RoomType) {
  if (type === "dining") return plan.rooms.filter(room => room.type === "dining" || room.name.toLowerCase().includes("dining")).length;
  return plan.rooms.filter(room => room.type === type).length;
}

function anyAdjacent(plan: FloorPlan, first: RoomType, second: RoomType) {
  return plan.rooms.some(a => roomMatches(a, first) && plan.rooms.some(b => roomMatches(b, second) && roomsTouch(a, b)));
}

function anyPassableConnection(plan: FloorPlan, first: RoomType, second: RoomType) {
  return plan.rooms.some(a => roomMatches(a, first) && plan.rooms.some(b => {
    if (!roomMatches(b, second) || !roomsTouch(a, b)) return false;
    if (a.name.toLowerCase().includes("open") || b.name.toLowerCase().includes("open")) return true;
    return doorTargetsForRoom(a, plan).some(target => target.id === b.id) || doorTargetsForRoom(b, plan).some(target => target.id === a.id);
  }));
}

function overlapAmount(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

function gapBetween(a1: number, a2: number, b1: number, b2: number) {
  if (a2 < b1) return b1 - a2;
  if (b2 < a1) return a1 - b2;
  return 0;
}

function planFeet(plan: FloorPlan, feet: number) {
  return plan.unit === "feet" ? feet : feet * 0.3048;
}

function anyNearAcrossHall(plan: FloorPlan, first: RoomType, second: RoomType) {
  return plan.rooms.some(a => roomMatches(a, first) && plan.rooms.some(b => {
    if (!roomMatches(b, second)) return false;
    const horizontalHallGap = gapBetween(a.x, a.x + a.width, b.x, b.x + b.width);
    const verticalHallGap = gapBetween(a.y, a.y + a.depth, b.y, b.y + b.depth);
    const verticalOverlap = overlapAmount(a.y, a.y + a.depth, b.y, b.y + b.depth);
    const horizontalOverlap = overlapAmount(a.x, a.x + a.width, b.x, b.x + b.width);
    return (horizontalHallGap <= planFeet(plan, 5) && verticalOverlap > planFeet(plan, 3)) ||
      (verticalHallGap <= planFeet(plan, 5) && horizontalOverlap > planFeet(plan, 3));
  }));
}

export function evaluateArchitecture(brief: Brief, plan: FloorPlan): ArchitectureReport {
  const issues: ArchitectureIssue[] = [];
  const graph = buildAccessGraph(plan);
  const reachable = reachableRooms(plan, brief);

  if (countRooms(plan, "bedroom") < brief.bedrooms) add(issues, "error", "brief", `Plan has fewer bedrooms than requested (${countRooms(plan, "bedroom")} of ${brief.bedrooms}).`);
  if (countRooms(plan, "bathroom") < brief.bathrooms) add(issues, "error", "brief", `Plan has fewer bathrooms than requested (${countRooms(plan, "bathroom")} of ${brief.bathrooms}).`);
  if (brief.kitchens > 0 && countRooms(plan, "kitchen") < brief.kitchens) add(issues, "error", "brief", "Plan is missing the requested kitchen.");
  if (brief.diningRooms > 0 && countRooms(plan, "dining") < brief.diningRooms) add(issues, "error", "brief", "Plan is missing the requested dining area.");
  if (brief.livingRooms > 0 && countRooms(plan, "living") < brief.livingRooms) add(issues, "error", "brief", "Plan is missing the requested living/great room.");

  if ((brief.roadSide !== "unspecified" || brief.facing !== "unspecified") && !planHasMainEntryDoor(plan, brief)) {
    add(issues, "error", "road", "Main entry/gate must be shown on the road-facing side.");
  }

  plan.rooms.forEach(room => {
    const rule = ROOM_RULES[room.type];
    if (!rule) return;
    if (!roomMeetsMinimum(room, brief)) {
      add(issues, "error", "size", `${room.name} is below the recommended ${rule.minWidth} ft x ${rule.minDepth} ft minimum.`);
    }
    if (roomExceedsMaximum(room, brief)) {
      add(issues, "warning", "size", `${room.name} is larger than the recommended functional range for a ${room.type}.`);
    }

    if (room.type === "hallway") {
      const clearWidth = Math.min(room.width, room.depth);
      if (clearWidth < toUnit(brief, 3.5)) add(issues, "error", "access", `${room.name} is narrower than the recommended 3.5 ft clear passage.`);
    }

    if (isCirculationLike(room) && room.type !== "porch" && !reachable.has(room.id)) {
      add(issues, "error", "access", `${room.name} is disconnected from the main entry circulation path.`);
    }
    if (isCirculationLike(room) && reachable.has(room.id) && !roomHasRoadDoor(room, plan, brief) && (graph.get(room.id)?.size ?? 0) <= 1 && room.width * room.depth > toUnit(brief, 55)) {
      add(issues, "warning", "access", `${room.name} behaves like a large dead-end circulation pocket.`);
    }
    if (rule.needsAccess && !reachable.has(room.id)) add(issues, "error", "access", `${room.name} is not clearly reachable from the main entry/circulation path.`);
    if (roomNeedsExplicitDoor(room) && !roomHasUsableDoor(room, plan, brief)) add(issues, "error", "access", `${room.name} has no usable door opening.`);
    if (room.type === "bedroom" && !roomHasDoorToCirculation(room, plan)) add(issues, "error", "access", `${room.name} must have a door to a hallway, foyer, or circulation pocket.`);
    if (room.type === "bathroom" && !bathroomHasValidDoor(room, plan)) {
      const attached = room.name.toLowerCase().includes("attached");
      add(issues, "error", "access", attached ? `${room.name} must have a direct door to a bedroom.` : `${room.name} must have a door to circulation.`);
    }
    if (room.type === "garage" && !garageHasInternalAccess(room, plan)) add(issues, "error", "access", `${room.name} needs an internal access door to the house circulation.`);
    if (room.type === "stairs" && !roomHasDoorToCirculation(room, plan)) add(issues, "error", "access", `${room.name} must connect to hallway, foyer, or circulation.`);
    if (room.type === "storage" && !roomHasDoorToAny(room, plan, ["hallway", "foyer", "bedroom", "bathroom", "kitchen", "utility", "laundry", "pantry"])) {
      add(issues, "error", "access", `${room.name} needs a reachable door to circulation or its parent room.`);
    }
    if (room.type === "balcony" && !roomHasDoorToAny(room, plan, ["living", "bedroom", "hallway", "foyer", "open"])) {
      add(issues, "error", "access", `${room.name} needs a door from a room or hallway.`);
    }
    if (["utility", "laundry", "pantry"].includes(room.type) && !roomHasDoorToAny(room, plan, ["kitchen", "hallway", "foyer"])) {
      add(issues, "warning", "access", `${room.name} should connect to the kitchen or service circulation.`);
    }
    if (rule.needsExterior && exteriorWalls(room, plan).length === 0 && !hasVentilation(room, plan) && !hasBorrowedLight(room, plan)) add(issues, "warning", "light", `${room.name} has no exterior wall for natural light/ventilation.`);
    if (rule.needsExterior && exteriorWalls(room, plan).length > 0 && !hasWindow(room, plan)) add(issues, "warning", "light", `${room.name} touches an exterior wall but has no window opening.`);
    if (room.type === "bathroom" && exteriorWalls(room, plan).length === 0 && !hasVent(room, plan)) add(issues, "error", "light", `${room.name} is internal and needs a ventilation shaft or exhaust route.`);
    if (needsWetVentilation(room) && exteriorWalls(room, plan).length === 0 && !hasVentilation(room, plan)) add(issues, "warning", "light", `${room.name} needs a window or exhaust vent.`);
  });

  if (brief.features.includes("garage")) {
    const garage = plan.rooms.find(room => room.type === "garage");
    if (!garage) add(issues, "error", "brief", "Plan is missing the requested garage.");
    else if (!roomHasRoadDoor(garage, plan, brief)) add(issues, "error", "road", "Garage must touch the road side and have a vehicle door to the road.");
  }

  if (brief.kitchens > 0 && brief.diningRooms > 0 && !anyAdjacent(plan, "kitchen", "dining")) {
    if (requiresDirectKitchenDining(brief)) add(issues, "error", "adjacency", "Kitchen should be directly adjacent to the dining area.");
    else add(issues, "warning", "adjacency", "Kitchen is near but not directly adjacent to the dining area.");
  }
  if (brief.kitchens > 0 && brief.diningRooms > 0 && requiresPassableKitchenDining(brief) && !anyPassableConnection(plan, "kitchen", "dining")) {
    add(issues, "error", "adjacency", "Kitchen and dining must have a passable door or open connection.");
  }
  if (brief.features.includes("utility") && !anyAdjacent(plan, "kitchen", "utility") && !anyAdjacent(plan, "utility", "hallway")) add(issues, "warning", "adjacency", "Utility should connect near the kitchen or service passage.");
  if (brief.bedrooms > 0 && brief.bathrooms > 0 && !anyAdjacent(plan, "bedroom", "bathroom") && !anyNearAcrossHall(plan, "bedroom", "bathroom")) add(issues, "warning", "adjacency", "At least one bathroom should sit beside a bedroom zone.");

  const errors = [...new Set(issues.filter(issue => issue.severity === "error").map(issue => issue.message))];
  const warnings = [...new Set(issues.filter(issue => issue.severity === "warning").map(issue => issue.message))];
  const score = Math.max(0, Math.round(100 - errors.length * 16 - warnings.length * 6));

  return { score, issues, errors, warnings };
}
