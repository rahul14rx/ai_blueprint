import { Brief, ROOM_COLORS, Room, RoomType, WallSide } from "./studio-types";
import { buildLayoutProgram, LayoutProgram, RoomRequirement } from "./layout-program";
import { clamp, explicitPlacementIntents, exteriorWalls, isCirculationLike, placementDistance, requiresDirectKitchenDining, resolvedRoadSide, roomExceedsMaximum, roomMeetsMinimum, roomsTouch, roomRule, toUnit, wantsAttachedBath } from "./layout-rules";

type Candidate = {
  strategy: string;
  rooms: Room[];
};

export type OptimizedLayout = Candidate & {
  score: number;
  hardErrors: string[];
  warnings: string[];
};

const uid = (level: number, key: string) => `f${level}-${key}`;
const isNorthSouth = (side: Brief["roadSide"] | Brief["facing"]) => side === "north" || side === "south";

function makeRoom(level: number, key: string, name: string, type: RoomType, x: number, y: number, width: number, depth: number, shape?: Room["shape"], curveSide?: WallSide): Room {
  return { id: uid(level, key), name, type, x, y, width, depth, color: ROOM_COLORS[type], shape, curveSide };
}

function findReq(program: LayoutProgram, type: RoomType, index = 0) {
  return program.rooms.filter(room => room.type === type)[index];
}

function hasReq(program: LayoutProgram, type: RoomType) {
  return program.rooms.some(room => room.type === type);
}

function byType(program: LayoutProgram, type: RoomType) {
  return program.rooms.filter(room => room.type === type);
}

function shapeFor(req: RoomRequirement | undefined, curveSide: WallSide): Pick<Room, "shape" | "curveSide"> {
  return req?.shape === "rounded" ? { shape: "rounded", curveSide } : {};
}

function leftoverSupportRoom(level: number, key: string, x: number, y: number, width: number, depth: number, brief: Brief): Room | null {
  if (width < toUnit(brief, 3) || depth < toUnit(brief, 3)) return null;
  if (width >= toUnit(brief, 8) && depth >= toUnit(brief, 8) && brief.features.includes("study")) return makeRoom(level, key, "Study", "study", x, y, width, depth);
  if (width >= toUnit(brief, 4) && depth >= toUnit(brief, 5)) return makeRoom(level, key, "Service pocket", "storage", x, y, width, depth);
  return makeRoom(level, key, "Access pocket", "hallway", x, y, width, depth);
}

function rotateForRoad(rooms: Room[], brief: Brief, roadSide: Brief["roadSide"] | Brief["facing"]) {
  if (roadSide === "north") return rooms.map(room => ({ ...room, y: brief.plotDepth - room.y - room.depth, curveSide: flipWall(room.curveSide, "vertical") }));
  if (roadSide === "west") return rooms.map(room => ({ ...room, x: brief.plotWidth - room.x - room.width, curveSide: flipWall(room.curveSide, "horizontal") }));
  return rooms;
}

function flipWall(side: WallSide | undefined, axis: "horizontal" | "vertical") {
  if (!side) return side;
  if (axis === "horizontal") return side === "east" ? "west" : side === "west" ? "east" : side;
  return side === "north" ? "south" : side === "south" ? "north" : side;
}

function makeNorthSouthCandidates(brief: Brief, level: number, program: LayoutProgram, roadSide: "north" | "south"): Candidate[] {
  const W = brief.plotWidth;
  const D = brief.plotDepth;
  const candidates: Candidate[] = [];
  const hasGarage = hasReq(program, "garage");
  const hasStairs = hasReq(program, "stairs");
  const hasPorch = hasReq(program, "porch");
  const bedroomCount = byType(program, "bedroom").length;
  const bathCount = byType(program, "bathroom").length;
  const supportCount = ["utility", "laundry", "pantry"].filter(type => hasReq(program, type as RoomType)).length;

  const frontD = clamp(hasGarage ? D * 0.28 : D * 0.24, toUnit(brief, hasStairs || hasPorch ? 9 : 8), toUnit(brief, 18));
  const hallW = clamp(W * 0.13, toUnit(brief, 4), toUnit(brief, 5));
  const leftW = clamp(W * 0.42, toUnit(brief, 11), W - hallW - toUnit(brief, hasGarage ? 12 : 10));
  const rightW = W - leftW - hallW;
  const serviceD = supportCount ? clamp(D * 0.16, toUnit(brief, 7), toUnit(brief, 11)) : 0;
  const rearD = hasReq(program, "kitchen") ? clamp(D * 0.25, toUnit(brief, 10), toUnit(brief, 14)) : serviceD;
  const privateTop = rearD;
  const frontY = D - frontD;
  const privateH = frontY - privateTop;
  const bedRows = Math.max(1, Math.min(bedroomCount, Math.floor(privateH / toUnit(brief, 10))));
  const bedH = privateH / bedRows;
  const bathW = bathCount ? clamp(rightW * 0.42, toUnit(brief, 5.5), toUnit(brief, 7)) : 0;
  const rooms: Room[] = [];
  let index = 0;

  if (hasReq(program, "kitchen")) {
    const diningW = hasReq(program, "dining") ? Math.max(toUnit(brief, 8), W * 0.28) : 0;
    rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", 0, 0, Math.max(toUnit(brief, 9), W - diningW), rearD));
    if (hasReq(program, "dining")) rooms.push(makeRoom(level, "dining-1", "Dining area", "dining", W - diningW, 0, diningW, rearD));
  }

  for (let row = 0; row < bedRows && index < bedroomCount; row++) {
    const y = privateTop + row * bedH;
    rooms.push(makeRoom(level, `bedroom-${index + 1}`, `Bedroom ${index + 1}`, "bedroom", 0, y, leftW, bedH));
    index++;
  }
  if (index < bedroomCount) {
    const extraRows = bedroomCount - index;
    const each = privateH / extraRows;
    for (let row = 0; row < extraRows; row++) rooms.push(makeRoom(level, `bedroom-${index + 1 + row}`, `Bedroom ${index + 1 + row}`, "bedroom", leftW + hallW, privateTop + row * each, rightW - bathW, each));
  }

  rooms.push(makeRoom(level, "central-hall", "Central hallway", "hallway", leftW, privateTop, hallW, D - privateTop));

  for (let i = 0; i < bathCount; i++) {
    const bathH = clamp(privateH / Math.max(2, bathCount + 1), toUnit(brief, 7), toUnit(brief, 8.5));
    rooms.push(makeRoom(level, `bathroom-${i + 1}`, i === 0 && wantsAttachedBath(brief) ? "Attached bath" : i === bathCount - 1 && /half bath|powder/i.test(brief.prompt) ? "Half bath" : `Bathroom ${i + 1}`, "bathroom", W - bathW, privateTop + i * bathH, bathW, bathH));
  }

  const publicX = leftW + hallW;
  const publicW = W - publicX;
  const livingReq = findReq(program, "living");
  if (hasReq(program, "living")) rooms.push(makeRoom(level, "living-1", "Living room", "living", publicX, frontY - clamp(privateH * 0.42, toUnit(brief, 12), Math.max(toUnit(brief, 12), privateH)), publicW, clamp(privateH * 0.42, toUnit(brief, 12), Math.max(toUnit(brief, 12), privateH)), shapeFor(livingReq, "east").shape, shapeFor(livingReq, "east").curveSide));
  if (hasStairs) rooms.push(makeRoom(level, "stairs-1", "Internal stairs", "stairs", leftW, frontY, hallW, frontD));
  rooms.push(makeRoom(level, "foyer-1", "Foyer", "foyer", 0, frontY, leftW, frontD));
  if (hasPorch || !hasGarage) rooms.push(makeRoom(level, "porch-1", "Porch", "porch", publicX, frontY, publicW, frontD));
  if (hasGarage) rooms.push(makeRoom(level, "garage-1", "Garage", "garage", publicX, D - clamp(frontD, toUnit(brief, 16), toUnit(brief, 20)), publicW, clamp(frontD, toUnit(brief, 16), toUnit(brief, 20))));
  if (supportCount) rooms.push(makeRoom(level, "utility-1", hasReq(program, "laundry") ? "Laundry / utility" : "Utility", hasReq(program, "laundry") ? "laundry" : "utility", 0, Math.max(0, rearD - serviceD), leftW, serviceD));

  candidates.push({ strategy: "north-south-side-spine", rooms: rotateForRoad(rooms, brief, roadSide) });

  const centralSpine = makeNorthSouthCentralSpineCandidate(brief, level, program, roadSide);
  if (centralSpine) candidates.push(centralSpine);
  const publicRight = makeNorthSouthCompactPublicRightCandidate(brief, level, program, roadSide);
  if (publicRight) candidates.push(publicRight);
  return candidates;
}

function wantsRoomAt(brief: Brief, type: RoomType, sides: Array<"north" | "south" | "east" | "west" | "center">) {
  return explicitPlacementIntents(brief).some(intent => intent.type === type && sides.every(side => intent.sides.includes(side)));
}

function makeNorthSouthCompactPublicRightCandidate(brief: Brief, level: number, program: LayoutProgram, roadSide: "north" | "south"): Candidate | null {
  const W = brief.plotWidth;
  const D = brief.plotDepth;
  const bedroomCount = byType(program, "bedroom").length;
  const bathCount = byType(program, "bathroom").length;
  const hasKitchen = hasReq(program, "kitchen");
  const hasDining = hasReq(program, "dining");
  const hasLiving = hasReq(program, "living");
  const hasStairs = hasReq(program, "stairs");
  const hasPorch = hasReq(program, "porch");
  if (hasReq(program, "garage") || bedroomCount > 2 || bathCount > 1 || !hasLiving || !wantsRoomAt(brief, "living", [roadSide, "east"])) return null;

  const porchD = clamp(D * 0.24, toUnit(brief, hasStairs || hasPorch ? 9 : 7), toUnit(brief, 10));
  const leftW = clamp(W * 0.38, toUnit(brief, 10), toUnit(brief, 13));
  const centerW = clamp(W * 0.27, toUnit(brief, hasDining ? 8 : hasStairs ? 6.5 : 5), toUnit(brief, 8.5));
  const rightW = W - leftW - centerW;
  if (rightW < toUnit(brief, 10)) return null;

  const frontY = D - porchD;
  const kitchenD = hasKitchen ? clamp(D * 0.28, toUnit(brief, 10), toUnit(brief, 12)) : 0;
  const livingD = clamp(D * 0.34, toUnit(brief, 12), toUnit(brief, 14));
  const livingY = Math.max(kitchenD, frontY - livingD);
  const bathD = bathCount ? clamp(D * 0.2, toUnit(brief, 7), toUnit(brief, 8.5)) : 0;
  const bedroomH = (frontY - bathD) / Math.max(1, bedroomCount);
  if (bedroomH < toUnit(brief, 10)) return null;

  const rooms: Room[] = [];
  const bathW = Math.min(toUnit(brief, 6.5), leftW * 0.52);
  if (bathCount) {
    rooms.push(makeRoom(level, "bathroom-1", wantsAttachedBath(brief) ? "Attached bath" : "Common bath", "bathroom", 0, 0, bathW, bathD));
    if (leftW - bathW >= toUnit(brief, 3.5)) rooms.push(makeRoom(level, "service-passage-1", "Service passage", "hallway", bathW, 0, leftW - bathW, bathD));
  }
  for (let i = 0; i < bedroomCount; i++) {
    rooms.push(makeRoom(level, `bedroom-${i + 1}`, `Bedroom ${i + 1}`, "bedroom", 0, bathD + i * bedroomH, leftW, bedroomH));
  }
  rooms.push(makeRoom(level, "front-foyer", "Front foyer", "foyer", 0, frontY, leftW, porchD));

  if (hasDining) {
    const diningD = clamp(D * 0.34, toUnit(brief, 10), toUnit(brief, 14));
    const diningY = clamp(kitchenD * 0.8, toUnit(brief, 4), Math.max(toUnit(brief, 4), frontY - diningD));
    if (diningY >= toUnit(brief, 3.5)) rooms.push(makeRoom(level, "rear-hall", "Rear hall", "hallway", leftW, 0, centerW, diningY));
    rooms.push(makeRoom(level, "dining-1", "Open dining area", "dining", leftW, diningY, centerW, diningD));
    const frontHallY = diningY + diningD;
    if (frontY - frontHallY >= toUnit(brief, 3.5)) rooms.push(makeRoom(level, "front-hall", "Front hall", "hallway", leftW, frontHallY, centerW, frontY - frontHallY));
  } else {
    rooms.push(makeRoom(level, "central-hall", "Central hallway", "hallway", leftW, 0, centerW, D));
  }
  if (hasStairs) rooms.push(makeRoom(level, "stairs-1", "Internal stairs", "stairs", leftW, frontY, centerW, porchD));

  if (hasKitchen) rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", leftW + centerW, 0, rightW, kitchenD));
  const livingReq = findReq(program, "living");
  const livingShape = shapeFor(livingReq, "east");
  const flexH = livingY - kitchenD;
  if (flexH >= toUnit(brief, 5)) rooms.push(makeRoom(level, "service-pocket-1", "Service pocket", "storage", leftW + centerW, kitchenD, rightW, flexH));
  rooms.push(makeRoom(level, "living-1", brief.livingRooms > 1 ? "Living room 1" : "Living room", "living", leftW + centerW, livingY, rightW, frontY - livingY, livingShape.shape, livingShape.curveSide));
  if (hasPorch || !hasStairs) rooms.push(makeRoom(level, "porch-1", "Porch", "porch", leftW + centerW, frontY, rightW, porchD));

  return { strategy: "north-south-compact-public-right", rooms: rotateForRoad(rooms, brief, roadSide) };
}

function makeNorthSouthCentralSpineCandidate(brief: Brief, level: number, program: LayoutProgram, roadSide: "north" | "south"): Candidate | null {
  const W = brief.plotWidth;
  const D = brief.plotDepth;
  const bedroomCount = byType(program, "bedroom").length;
  const bathCount = byType(program, "bathroom").length;
  const hasKitchen = hasReq(program, "kitchen");
  const hasDining = hasReq(program, "dining");
  const hasGarage = hasReq(program, "garage");
  const hasStairs = hasReq(program, "stairs");
  const hasPorch = hasReq(program, "porch");
  const hasStudy = hasReq(program, "study");
  const hasUtility = hasReq(program, "utility") || hasReq(program, "laundry");
  const hasPantry = hasReq(program, "pantry");
  const needsService = hasKitchen || hasDining || hasUtility || hasPantry;
  const rooms: Room[] = [];

  const hallW = clamp(W * 0.11, toUnit(brief, 4), toUnit(brief, 5));
  const hallX = (W - hallW) / 2;
  const leftW = hallX;
  const rightX = hallX + hallW;
  const rightW = W - rightX;
  if (Math.min(leftW, rightW) < toUnit(brief, 10)) return null;

  const serviceD = needsService ? clamp(D * 0.2, toUnit(brief, D < 46 ? 10 : 11), toUnit(brief, D < 46 ? 12 : 14)) : 0;
  const frontBase = hasGarage ? 18 : hasStairs || hasPorch ? 10 : 12;
  const frontD = clamp(D * (hasGarage ? 0.31 : 0.25), toUnit(brief, frontBase), toUnit(brief, hasGarage || hasStudy ? 22 : 14));
  const middleTop = serviceD;
  const middleBottom = D - frontD;
  const middleH = middleBottom - middleTop;
  const canUseBathStrip = bathCount > 0 && rightW - toUnit(brief, 10) >= toUnit(brief, 5.5);
  const rows = Math.max(1, canUseBathStrip ? Math.max(Math.ceil(Math.max(1, bedroomCount) / 2), bathCount) : Math.max(1, bedroomCount));
  if (middleH / rows < toUnit(brief, 10)) return null;

  rooms.push(makeRoom(level, "central-hall", "Central hallway", "hallway", hallX, 0, hallW, D));

  if (needsService) {
    if (hasKitchen && hasDining && leftW >= toUnit(brief, 18)) {
      const kitchenW = clamp(leftW * 0.5, toUnit(brief, 9.5), leftW - toUnit(brief, 8));
      rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", 0, 0, kitchenW, serviceD));
      rooms.push(makeRoom(level, "dining-1", "Dining area", "dining", kitchenW, 0, leftW - kitchenW, serviceD));
      if (hasUtility || hasPantry) {
        if (hasPantry && hasUtility) {
          rooms.push(makeRoom(level, "pantry-1", "Pantry", "pantry", rightX, 0, rightW, serviceD / 2));
          rooms.push(makeRoom(level, "utility-1", hasReq(program, "laundry") ? "Laundry / utility" : "Utility", hasReq(program, "laundry") ? "laundry" : "utility", rightX, serviceD / 2, rightW, serviceD / 2));
        } else if (hasPantry) {
          rooms.push(makeRoom(level, "pantry-1", "Pantry", "pantry", rightX, 0, rightW, serviceD));
        } else {
          rooms.push(makeRoom(level, "utility-1", hasReq(program, "laundry") ? "Laundry / utility" : "Utility", hasReq(program, "laundry") ? "laundry" : "utility", rightX, 0, rightW, serviceD));
        }
      }
    } else if (hasKitchen && (hasUtility || hasPantry) && leftW >= toUnit(brief, 18)) {
      const kitchenW = Math.max(toUnit(brief, 10), leftW - toUnit(brief, 7.5));
      const serviceW = leftW - kitchenW;
      rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", 0, 0, kitchenW, serviceD));
      if (hasPantry) {
        const pantryD = hasUtility ? serviceD / 2 : serviceD;
        rooms.push(makeRoom(level, "pantry-1", "Pantry", "pantry", kitchenW, 0, serviceW, pantryD));
        if (hasUtility) rooms.push(makeRoom(level, "utility-1", hasReq(program, "laundry") ? "Laundry / utility" : "Utility", hasReq(program, "laundry") ? "laundry" : "utility", kitchenW, pantryD, serviceW, serviceD - pantryD));
      } else {
        rooms.push(makeRoom(level, "utility-1", hasReq(program, "laundry") ? "Laundry / utility" : "Utility", hasReq(program, "laundry") ? "laundry" : "utility", kitchenW, 0, serviceW, serviceD));
      }
    } else if (hasUtility) {
      rooms.push(makeRoom(level, "utility-1", hasReq(program, "laundry") ? "Laundry / utility" : "Utility", hasReq(program, "laundry") ? "laundry" : "utility", 0, 0, leftW, serviceD));
    } else if (hasKitchen) {
      rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", 0, 0, leftW, serviceD));
    }

    if (hasKitchen && !rooms.some(room => room.type === "kitchen")) rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", rightX, 0, rightW, serviceD));
    else if (hasDining && !rooms.some(room => room.type === "dining")) rooms.push(makeRoom(level, "dining-1", "Dining area", "dining", rightX, 0, rightW, serviceD));
    if (hasDining && !rooms.some(room => room.type === "dining")) rooms.push(makeRoom(level, "dining-1", "Dining area", "dining", rightX, 0, rightW, serviceD));
  }

  const rowH = middleH / rows;
  const bathStripW = canUseBathStrip ? clamp(rightW * 0.32, toUnit(brief, 5.5), toUnit(brief, 7)) : 0;
  const rightBedroomW = bathStripW ? rightW - bathStripW : rightW;
  const rightBedroomRows = new Set<number>();
  for (let i = 0; i < bedroomCount; i++) {
    const row = i % rows;
    const col = Math.floor(i / rows);
    const y = middleTop + row * rowH;
    if (col === 0 || !bathStripW) rooms.push(makeRoom(level, `bedroom-${i + 1}`, `Bedroom ${i + 1}`, "bedroom", 0, y, leftW, rowH));
    else {
      rightBedroomRows.add(row);
      rooms.push(makeRoom(level, `bedroom-${i + 1}`, `Bedroom ${i + 1}`, "bedroom", rightX + bathStripW, y, rightBedroomW, rowH));
    }
  }

  if (bathCount) {
    if (bathStripW) {
      for (let i = 0; i < bathCount; i++) {
        const rowY = middleTop + i * rowH;
        const hasBedroomEntry = rightBedroomRows.has(i);
        const entryH = hasBedroomEntry ? clamp(rowH * 0.28, toUnit(brief, 3.5), Math.max(toUnit(brief, 3.5), rowH - toUnit(brief, 7))) : 0;
        const bathH = clamp(rowH - entryH, toUnit(brief, 7), Math.min(toUnit(brief, 8.5), rowH - entryH));
        const attached = i === 0 && wantsAttachedBath(brief);
        const half = i === bathCount - 1 && /half bath|powder/i.test(brief.prompt);
        rooms.push(makeRoom(level, `bathroom-${i + 1}`, attached ? "Attached bath" : half ? "Half bath" : `Bathroom ${i + 1}`, "bathroom", rightX, rowY, bathStripW, bathH));
        if (!hasBedroomEntry) {
          const leftover = leftoverSupportRoom(level, `bath-leftover-${i + 1}`, rightX, rowY + bathH, bathStripW, rowH - bathH, brief);
          if (leftover) rooms.push(leftover);
        }
        if (hasBedroomEntry) rooms.push(makeRoom(level, `bedroom-${i + rows + 1}-entry`, `Bedroom ${i + rows + 1} entry`, "hallway", rightX, rowY + bathH, bathStripW, entryH));
        if (!hasBedroomEntry && rightBedroomW >= toUnit(brief, 3)) rooms.push(makeRoom(level, `linen-${i + 1}`, `Linen ${i + 1}`, "storage", rightX + bathStripW, rowY, rightBedroomW, rowH));
      }
    } else {
      const rowH = middleH / bathCount;
      const bathW = clamp(rightW * 0.46, toUnit(brief, 5.5), Math.min(toUnit(brief, 7), rightW));
      const bathD = clamp(rowH * 0.45, toUnit(brief, 7), Math.min(toUnit(brief, 8.5), rowH));
      for (let i = 0; i < bathCount; i++) {
        const rowY = middleTop + i * rowH;
        const attached = i === 0 && wantsAttachedBath(brief);
        const half = i === bathCount - 1 && /half bath|powder/i.test(brief.prompt);
        rooms.push(makeRoom(level, `bathroom-${i + 1}`, attached ? "Attached bath" : half ? "Half bath" : `Bathroom ${i + 1}`, "bathroom", rightX, rowY, bathW, bathD));
        if (rightW - bathW >= toUnit(brief, 3)) rooms.push(makeRoom(level, `bath-linen-${i + 1}`, `Bath linen ${i + 1}`, "storage", rightX + bathW, rowY, rightW - bathW, bathD));
        const leftover = leftoverSupportRoom(level, `bath-leftover-${i + 1}`, rightX, rowY + bathD, rightW, rowH - bathD, brief);
        if (leftover) rooms.push(leftover);
      }
    }
  }

  const livingReq = findReq(program, "living");
  const livingShape = shapeFor(livingReq, "south");
  if (hasReq(program, "living")) {
    const splitFront = (hasStudy || (hasPorch && !hasStairs && !hasGarage)) && frontD >= toUnit(brief, 17);
    const livingD = splitFront ? Math.max(toUnit(brief, 12), frontD - toUnit(brief, 8)) : frontD;
    rooms.push(makeRoom(level, "living-1", brief.livingRooms > 1 ? "Living room 1" : "Living room", "living", 0, middleBottom, leftW, livingD, livingShape.shape, livingShape.curveSide));
    const flexD = frontD - livingD;
    if (flexD >= toUnit(brief, 5)) {
      const y = middleBottom + livingD;
      if (hasPorch && hasStudy) {
        const porchW = Math.max(toUnit(brief, 8), leftW * 0.45);
        rooms.push(makeRoom(level, "porch-1", "Porch", "porch", 0, y, porchW, flexD));
        rooms.push(makeRoom(level, "study-1", "Study", "study", porchW, y, leftW - porchW, flexD));
      } else if (hasPorch) {
        rooms.push(makeRoom(level, "porch-1", "Porch", "porch", 0, y, leftW, flexD));
      } else if (hasStudy) {
        rooms.push(makeRoom(level, "study-1", "Study", "study", 0, y, leftW, flexD));
      }
    }
  }

  if (hasGarage) {
    rooms.push(makeRoom(level, "garage-1", "Garage", "garage", rightX, middleBottom, rightW, frontD));
  } else if (hasStairs && hasPorch && rightW >= toUnit(brief, 12)) {
    const stairsW = clamp(rightW * 0.52, toUnit(brief, 6), rightW - toUnit(brief, 5));
    rooms.push(makeRoom(level, "stairs-1", "Internal stairs", "stairs", rightX, middleBottom, stairsW, frontD));
    rooms.push(makeRoom(level, "porch-1", "Porch", "porch", rightX + stairsW, middleBottom, rightW - stairsW, frontD));
  } else if (hasStairs) {
    rooms.push(makeRoom(level, "stairs-1", "Internal stairs", "stairs", rightX, middleBottom, rightW, frontD));
  } else if (hasPorch) {
    rooms.push(makeRoom(level, "porch-1", "Porch", "porch", rightX, middleBottom, rightW, frontD));
  } else if (!hasReq(program, "living")) {
    rooms.push(makeRoom(level, "foyer-1", "Foyer", "foyer", rightX, middleBottom, rightW, frontD));
  }

  return { strategy: "north-south-central-spine", rooms: rotateForRoad(rooms, brief, roadSide) };
}

function makeEastWestCandidates(brief: Brief, level: number, program: LayoutProgram, roadSide: "east" | "west"): Candidate[] {
  const W = brief.plotWidth;
  const D = brief.plotDepth;
  const candidates: Candidate[] = [];
  const bedroomCount = byType(program, "bedroom").length;
  const bathCount = byType(program, "bathroom").length;
  const hasGarage = hasReq(program, "garage");
  const hasStairs = hasReq(program, "stairs");
  const hasSupport = hasReq(program, "utility") || hasReq(program, "laundry");
  const hallW = clamp(W * 0.1, toUnit(brief, 4), toUnit(brief, 5));
  const privateW = clamp(W * 0.5, toUnit(brief, 16), W - hallW - toUnit(brief, hasGarage ? 12 : 10));
  const roadW = W - privateW - hallW;
  const topH = clamp(D * 0.25, toUnit(brief, 13), toUnit(brief, 17));
  const foyerH = clamp(D * 0.12, toUnit(brief, 6.5), toUnit(brief, 8));
  const garageH = hasGarage ? clamp(D * 0.28, toUnit(brief, 16), toUnit(brief, 20)) : 0;
  const supportH = hasSupport ? clamp(D * 0.12, toUnit(brief, 6), toUnit(brief, 8)) : 0;
  const privateTop = topH + foyerH;
  const privateBottom = D - supportH;
  const privateH = privateBottom - privateTop;
  const bathW = bathCount ? clamp(privateW * 0.32, toUnit(brief, 5.5), toUnit(brief, 7)) : 0;
  const bedW = privateW - bathW;
  const bedRows = Math.max(1, Math.min(bedroomCount, Math.floor(privateH / toUnit(brief, 10))));
  const bedH = privateH / bedRows;
  const rooms: Room[] = [];

  if (hasReq(program, "kitchen") && hasReq(program, "dining")) {
    rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", 0, 0, privateW * 0.46, topH));
    rooms.push(makeRoom(level, "dining-1", "Dining area", "dining", privateW * 0.46, 0, privateW * 0.54, topH));
  } else if (hasReq(program, "kitchen")) {
    rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", 0, 0, privateW, topH));
  }

  rooms.push(makeRoom(level, "central-hall", "Central hallway", "hallway", privateW, 0, hallW, D));
  const livingReq = findReq(program, "living");
  if (hasReq(program, "living")) rooms.push(makeRoom(level, "living-1", "Great room", "living", privateW + hallW, 0, roadW, topH, shapeFor(livingReq, "east").shape, shapeFor(livingReq, "east").curveSide));
  rooms.push(makeRoom(level, "foyer-1", "Foyer", "foyer", privateW + hallW, topH, roadW, foyerH));
  if (hasStairs) rooms.push(makeRoom(level, "stairs-1", "Internal stairs", "stairs", privateW + hallW, topH + foyerH, roadW, clamp(D * 0.18, toUnit(brief, 10), toUnit(brief, 13))));
  if (hasGarage) rooms.push(makeRoom(level, "garage-1", "Garage", "garage", privateW + hallW, D - garageH, roadW, garageH));
  const lobbyTop = topH + foyerH + (hasStairs ? clamp(D * 0.18, toUnit(brief, 10), toUnit(brief, 13)) : 0);
  if (hasGarage && D - garageH - lobbyTop >= toUnit(brief, 5)) rooms.push(makeRoom(level, "garage-lobby", "Garage lobby", "storage", privateW + hallW, lobbyTop, roadW, D - garageH - lobbyTop));

  for (let i = 0; i < bedroomCount; i++) {
    const row = i % bedRows;
    const col = Math.floor(i / bedRows);
    const x = col === 0 ? 0 : privateW * 0.5;
    const w = col === 0 ? bedW : Math.max(toUnit(brief, 10), privateW * 0.5);
    rooms.push(makeRoom(level, `bedroom-${i + 1}`, `Bedroom ${i + 1}`, "bedroom", x, privateTop + row * bedH, Math.min(w, bedW), bedH));
  }
  for (let i = 0; i < bathCount; i++) {
    const bathH = clamp(bedH * 0.52, toUnit(brief, 7), toUnit(brief, 8.5));
    const rowY = privateTop + i * bedH;
    const entryH = Math.min(toUnit(brief, 4.5), Math.max(toUnit(brief, 3.5), bedH - bathH));
    rooms.push(makeRoom(level, `bathroom-${i + 1}`, i === 0 && wantsAttachedBath(brief) ? "Attached bath" : `Bathroom ${i + 1}`, "bathroom", bedW, rowY, bathW, bathH));
    if (entryH >= toUnit(brief, 3.5)) rooms.push(makeRoom(level, `bedroom-${i + 1}-entry`, `Bedroom ${i + 1} entry`, "hallway", bedW, rowY + bedH - entryH, bathW, entryH));
  }
  if (hasSupport) rooms.push(makeRoom(level, "utility-1", hasReq(program, "laundry") ? "Laundry / utility" : "Utility", hasReq(program, "laundry") ? "laundry" : "utility", 0, D - supportH, privateW, supportH));

  candidates.push({ strategy: "east-west-central-spine", rooms: rotateForRoad(rooms, brief, roadSide) });
  const compact = makeEastWestCompactCandidate(brief, level, program, roadSide);
  if (compact) candidates.push(compact);
  return candidates;
}

function makeEastWestCompactCandidate(brief: Brief, level: number, program: LayoutProgram, roadSide: "east" | "west"): Candidate | null {
  const W = brief.plotWidth;
  const D = brief.plotDepth;
  const bedroomCount = byType(program, "bedroom").length;
  const bathCount = byType(program, "bathroom").length;
  if (bedroomCount > 1 || bathCount > 1 || hasReq(program, "garage") || hasReq(program, "stairs")) return null;

  const hallW = clamp(W * 0.15, toUnit(brief, 3.8), toUnit(brief, 4.5));
  const privateW = clamp(W * 0.39, toUnit(brief, 10), W - hallW - toUnit(brief, 12));
  const roadW = W - privateW - hallW;
  if (privateW + 0.01 < toUnit(brief, 10) || roadW + 0.01 < toUnit(brief, 12)) return null;

  const kitchenD = clamp(D * 0.32, toUnit(brief, 10), toUnit(brief, 12));
  const diningD = hasReq(program, "dining") ? clamp(D * 0.27, toUnit(brief, 10), toUnit(brief, 11)) : 0;
  const bedroomY = kitchenD + diningD;
  const bedroomD = D - bedroomY;
  if (bedroomD < toUnit(brief, 10)) return null;

  const rooms: Room[] = [];
  rooms.push(makeRoom(level, "central-hall", "Central hallway", "hallway", privateW, 0, hallW, D));
  if (hasReq(program, "kitchen")) rooms.push(makeRoom(level, "kitchen-1", "Kitchen", "kitchen", 0, 0, privateW, kitchenD));
  if (hasReq(program, "dining")) rooms.push(makeRoom(level, "dining-1", "Dining area", "dining", 0, kitchenD, privateW, diningD));
  if (bedroomCount) rooms.push(makeRoom(level, "bedroom-1", "Bedroom 1", "bedroom", 0, bedroomY, privateW, bedroomD));

  const livingReq = findReq(program, "living");
  const livingD = clamp(D * 0.38, toUnit(brief, 12), toUnit(brief, 15));
  const foyerD = clamp(D * 0.18, toUnit(brief, 6), toUnit(brief, 7));
  if (hasReq(program, "living")) {
    const shape = shapeFor(livingReq, "east");
    rooms.push(makeRoom(level, "living-1", "Living room", "living", privateW + hallW, 0, roadW, livingD, shape.shape, shape.curveSide));
  }
  rooms.push(makeRoom(level, "foyer-1", "Foyer", "foyer", privateW + hallW, livingD, roadW, foyerD));
  if (bathCount) {
    const bathW = Math.min(roadW, toUnit(brief, 6.5));
    const bathY = livingD + foyerD;
    rooms.push(makeRoom(level, "bathroom-1", wantsAttachedBath(brief) ? "Attached bath" : "Bathroom 1", "bathroom", privateW + hallW, bathY, bathW, toUnit(brief, 7)));
    if (roadW - bathW >= toUnit(brief, 3)) rooms.push(makeRoom(level, "bath-linen-1", "Bath linen 1", "storage", privateW + hallW + bathW, bathY, roadW - bathW, toUnit(brief, 7)));
  }
  const serviceY = livingD + foyerD + (bathCount ? toUnit(brief, 7) : 0);
  if (hasReq(program, "utility") || hasReq(program, "laundry")) {
    const supportType = hasReq(program, "laundry") ? "laundry" : "utility";
    rooms.push(makeRoom(level, "utility-1", supportType === "laundry" ? "Laundry / utility" : "Utility", supportType, privateW + hallW, serviceY, roadW, D - serviceY));
  }

  return { strategy: "east-west-compact-spine", rooms: rotateForRoad(rooms, brief, roadSide) };
}

function countType(rooms: Room[], type: RoomType) {
  if (type === "dining") return rooms.filter(room => room.type === "dining" || room.name.toLowerCase().includes("dining")).length;
  return rooms.filter(room => room.type === type).length;
}

function roomDirectlyConnects(a: Room, b: Room) {
  const pair = `${a.type}:${b.type}`;
  return [
    "kitchen:dining", "dining:kitchen",
    "kitchen:utility", "utility:kitchen",
    "kitchen:laundry", "laundry:kitchen",
    "kitchen:pantry", "pantry:kitchen",
    "bedroom:bathroom", "bathroom:bedroom",
    "garage:storage", "storage:garage",
    "garage:hallway", "hallway:garage",
  ].includes(pair);
}

function reachableRooms(rooms: Room[], brief: Brief) {
  const roadSide = resolvedRoadSide(brief);
  const planBox = { width: brief.plotWidth, depth: brief.plotDepth };
  const start = rooms.find(room => isCirculationLike(room) && roadSide !== "unspecified" && exteriorWalls(room, planBox).includes(roadSide)) ?? rooms.find(isCirculationLike);
  const graph = new Map<string, Set<string>>();
  rooms.forEach(room => graph.set(room.id, new Set()));
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (!roomsTouch(a, b)) continue;
      if (isCirculationLike(a) || isCirculationLike(b) || roomDirectlyConnects(a, b)) {
        graph.get(a.id)?.add(b.id);
        graph.get(b.id)?.add(a.id);
      }
    }
  }
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

function scoreCandidate(brief: Brief, program: LayoutProgram, candidate: Candidate): OptimizedLayout {
  const hardErrors: string[] = [];
  const warnings: string[] = [];
  let score = 100;
  const planBox = { width: brief.plotWidth, depth: brief.plotDepth };
  const rooms = candidate.rooms.filter(room => room.width > 0.01 && room.depth > 0.01);
  const reachable = reachableRooms(rooms, brief);

  program.rooms.forEach(req => {
    if (countType(rooms, req.type) < program.rooms.filter(room => room.type === req.type).length && !["porch", "utility", "laundry", "pantry"].includes(req.type)) {
      hardErrors.push(`Missing ${req.name}.`);
    }
  });

  rooms.forEach((room, i) => {
    if (room.x < -0.01 || room.y < -0.01 || room.x + room.width > brief.plotWidth + 0.01 || room.y + room.depth > brief.plotDepth + 0.01) hardErrors.push(`${room.name} extends outside the plot.`);
    if (!roomMeetsMinimum(room, brief)) hardErrors.push(`${room.name} is below minimum size.`);
    if (roomExceedsMaximum(room, brief)) {
      score -= 10;
      warnings.push(`${room.name} is larger than its recommended functional size.`);
    }
    const ratio = Math.max(room.width, room.depth) / Math.max(0.01, Math.min(room.width, room.depth));
    if (!["hallway", "stairs", "porch"].includes(room.type) && ratio > 2.6) {
      score -= (ratio - 2.6) * 6;
      warnings.push(`${room.name} is elongated.`);
    }
    candidate.rooms.slice(i + 1).forEach(other => {
      const overlaps = room.x < other.x + other.width - 0.02 && room.x + room.width > other.x + 0.02 && room.y < other.y + other.depth - 0.02 && room.y + room.depth > other.y + 0.02;
      if (overlaps) hardErrors.push(`${room.name} overlaps ${other.name}.`);
    });
  });

  const roadSide = resolvedRoadSide(brief);
  const entryRooms = rooms.filter(room => isCirculationLike(room) && roadSide !== "unspecified" && exteriorWalls(room, planBox).includes(roadSide));
  if (!entryRooms.length) hardErrors.push("No clear entry room touches the road side.");

  const placementKeys = new Set<string>();
  explicitPlacementIntents(brief).forEach(intent => {
    const placementKey = `${intent.type}:${intent.sides.slice().sort().join("+")}`;
    if (placementKeys.has(placementKey)) return;
    placementKeys.add(placementKey);
    const matching = rooms.filter(room => roomMatchesIntent(room, intent.type));
    if (!matching.length) return;
    const bestDistance = Math.min(...matching.map(room => Math.max(...intent.sides.map(side => placementDistance(room, planBox, side)))));
    if (bestDistance > 0.5) {
      score -= 24;
      warnings.push(`${intent.type} placement does not follow "${intent.source}".`);
    } else if (bestDistance > 0.35) {
      score -= 6;
    }
  });

  rooms.filter(room => roomRule(room.type).needsAccess).forEach(room => {
    if (!reachable.has(room.id) && !isCirculationLike(room)) {
      score -= 18;
      hardErrors.push(`${room.name} is not attached to circulation.`);
    }
  });

  rooms.filter(room => room.type === "bathroom" && room.name.toLowerCase().includes("attached")).forEach(room => {
    if (!rooms.some(other => other.type === "bedroom" && roomsTouch(room, other))) {
      score -= 30;
      hardErrors.push(`${room.name} is labeled attached but does not touch a bedroom.`);
    }
  });

  if (brief.kitchens > 0 && brief.diningRooms > 0 && !rooms.some(a => a.type === "kitchen" && rooms.some(b => b.type === "dining" && roomsTouch(a, b)))) {
    score -= requiresDirectKitchenDining(brief) ? 22 : 8;
    if (requiresDirectKitchenDining(brief)) hardErrors.push("Kitchen is not directly adjacent to dining.");
    else warnings.push("Kitchen is near but not directly adjacent to dining.");
  }
  if (brief.features.includes("garage")) {
    const garage = rooms.find(room => room.type === "garage");
    if (!garage) hardErrors.push("Garage is missing.");
    else if (roadSide !== "unspecified" && !exteriorWalls(garage, planBox).includes(roadSide)) hardErrors.push("Garage does not touch road side.");
  }

  rooms.filter(room => roomRule(room.type).needsExterior).forEach(room => {
    if (!exteriorWalls(room, planBox).length && !hasBorrowedPublicLight(room, rooms, planBox)) {
      score -= 8;
      warnings.push(`${room.name} has no exterior wall.`);
    }
  });

  const usedArea = rooms.reduce((sum, room) => sum + room.width * room.depth, 0);
  const fill = usedArea / (brief.plotWidth * brief.plotDepth);
  if (fill < 0.72) score -= (0.72 - fill) * 60;
  if (fill > 1.01) hardErrors.push("Room area exceeds plot area.");

  score -= hardErrors.length * 40;
  score = Math.max(0, Math.round(score));
  return { ...candidate, rooms, score, hardErrors: [...new Set(hardErrors)], warnings: [...new Set(warnings)] };
}

function roomMatchesIntent(room: Room, type: RoomType) {
  return room.type === type || (type === "dining" && room.name.toLowerCase().includes("dining"));
}

function hasBorrowedPublicLight(room: Room, rooms: Room[], planBox: { width: number; depth: number }) {
  if (room.type !== "dining" || !room.name.toLowerCase().includes("open")) return false;
  return rooms.some(other => ["kitchen", "living", "foyer"].includes(other.type) && roomsTouch(room, other) && exteriorWalls(other, planBox).length > 0);
}

export function optimizeGroundFloor(brief: Brief, level: number): OptimizedLayout | null {
  return evaluateGroundFloorCandidates(brief, level)[0] ?? null;
}

export function evaluateGroundFloorCandidates(brief: Brief, level: number): OptimizedLayout[] {
  const program = buildLayoutProgram(brief);
  const roadSide = resolvedRoadSide(brief);
  const candidates: Candidate[] = [];

  if (isNorthSouth(roadSide)) {
    candidates.push(...makeNorthSouthCandidates(brief, level, program, roadSide === "north" ? "north" : "south"));
  } else {
    candidates.push(...makeEastWestCandidates(brief, level, program, roadSide === "west" ? "west" : "east"));
  }

  return candidates.map(candidate => scoreCandidate(brief, program, candidate)).sort((a, b) => b.score - a.score || a.hardErrors.length - b.hardErrors.length);
}
