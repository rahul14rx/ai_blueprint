import { FloorPlan, Opening, Room, WallSide } from "./studio-types";

export type OpeningPlacement = {
  opening: Opening;
  room: Room;
  orientation: "horizontal" | "vertical";
  coord: number;
  start: number;
  end: number;
  center: number;
};

export type EntryPath = {
  side: WallSide;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
  length: number;
  entry: OpeningPlacement;
};

export type DoorLeafPlacement = {
  hingeX: number;
  hingeZ: number;
  rotationY: number;
  length: number;
  orientation: OpeningPlacement["orientation"];
};

const ENTRY_ROOM_PRIORITY: Record<string, number> = {
  foyer: 0,
  porch: 1,
  hallway: 2,
  open: 3,
  living: 4,
};

export function getOpeningPlacement(opening: Opening, room: Room): OpeningPlacement {
  const orientation = opening.wall === "north" || opening.wall === "south" ? "horizontal" : "vertical";
  const roomStart = orientation === "horizontal" ? room.x : room.y;
  const roomLength = orientation === "horizontal" ? room.width : room.depth;
  const start = roomStart + (roomLength - opening.width) * opening.offset;
  const end = start + opening.width;
  const coord = opening.wall === "north" ? room.y : opening.wall === "south" ? room.y + room.depth : opening.wall === "west" ? room.x : room.x + room.width;

  return { opening, room, orientation, coord, start, end, center: (start + end) / 2 };
}

export function getDoorLeafPlacement(placement: OpeningPlacement): DoorLeafPlacement {
  const maxLeaf = placement.room.type === "garage" ? placement.end - placement.start : Math.min(placement.end - placement.start, 3.2);
  const swing = Math.PI / 2.7;
  const rotationY = placement.opening.wall === "north" ? -swing : placement.opening.wall === "south" ? swing : placement.opening.wall === "east" ? -swing : swing;
  return {
    hingeX: placement.orientation === "horizontal" ? placement.start : placement.coord,
    hingeZ: placement.orientation === "horizontal" ? placement.coord : placement.start,
    rotationY,
    length: maxLeaf,
    orientation: placement.orientation,
  };
}

export function getPlanOpeningPlacements(plan: FloorPlan, kinds?: Opening["kind"][]) {
  const roomById = new Map(plan.rooms.map(room => [room.id, room]));
  return plan.openings
    .filter(opening => !kinds || kinds.includes(opening.kind))
    .map(opening => {
      const room = roomById.get(opening.roomId);
      return room ? getOpeningPlacement(opening, room) : null;
    })
    .filter((placement): placement is OpeningPlacement => Boolean(placement));
}

export function getMainEntryPlacement(plan: FloorPlan) {
  const roadSide = plan.roadSide !== "unspecified" ? plan.roadSide : plan.facing;
  if (roadSide === "unspecified") return null;

  const roadDoors = getPlanOpeningPlacements(plan, ["door"])
    .filter(placement => placement.opening.wall === roadSide && placement.room.type !== "garage");
  if (!roadDoors.length) return null;

  return [...roadDoors].sort((a, b) => {
    const aPriority = ENTRY_ROOM_PRIORITY[a.room.type] ?? 9;
    const bPriority = ENTRY_ROOM_PRIORITY[b.room.type] ?? 9;
    return aPriority - bPriority;
  })[0];
}

export function getEntryPath(plan: FloorPlan): EntryPath | null {
  const entry = getMainEntryPlacement(plan);
  if (!entry) return null;

  const side = entry.opening.wall;
  const pathWidth = Math.max(4, Math.min(8, entry.opening.width + 1.6));
  const pathLength = Math.max(5, Math.min(8, Math.min(plan.width, plan.depth) * 0.16));
  const half = pathWidth / 2;

  if (side === "north" || side === "south") {
    const center = Math.max(half, Math.min(plan.width - half, entry.center));
    const z1 = side === "north" ? -pathLength : plan.depth;
    const z2 = side === "north" ? 0 : plan.depth + pathLength;
    return { side, x1: center - half, x2: center + half, z1, z2, width: pathWidth, length: pathLength, entry };
  }

  const center = Math.max(half, Math.min(plan.depth - half, entry.center));
  const x1 = side === "west" ? -pathLength : plan.width;
  const x2 = side === "west" ? 0 : plan.width + pathLength;
  return { side, x1, x2, z1: center - half, z2: center + half, width: pathWidth, length: pathLength, entry };
}
