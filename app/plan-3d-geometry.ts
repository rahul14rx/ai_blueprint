import { FloorPlan, Opening, Room, WallSide } from "./studio-types";
import { getPlanOpeningPlacements } from "./plan-openings";

export type WallSegment3D = {
  id: string;
  kind: "exterior" | "interior";
  orientation: "horizontal" | "vertical";
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  bottom: number;
  height: number;
  thickness: number;
};

type Edge = {
  orientation: "horizontal" | "vertical";
  coord: number;
  start: number;
  end: number;
  side: WallSide;
  roomId: string;
};

type OpeningGap = {
  orientation: "horizontal" | "vertical";
  coord: number;
  start: number;
  end: number;
  kind: Opening["kind"];
};

const WALL_HEIGHT = 9;
const WINDOW_SILL = 3.2;
const WINDOW_HEIGHT = 2.35;
const VENT_SILL = 6.2;
const VENT_HEIGHT = 1.1;
const EXTERIOR_THICKNESS = 0.42;
const INTERIOR_THICKNESS = 0.24;
const EPSILON = 0.03;

const roundKey = (value: number) => value.toFixed(2);
const sameCoord = (a: number, b: number) => Math.abs(a - b) <= EPSILON;

function roomEdges(room: Room): Edge[] {
  const north = room.y;
  const south = room.y + room.depth;
  const west = room.x;
  const east = room.x + room.width;

  return [
    { orientation: "horizontal", coord: north, start: west, end: east, side: "north", roomId: room.id },
    { orientation: "horizontal", coord: south, start: west, end: east, side: "south", roomId: room.id },
    { orientation: "vertical", coord: west, start: north, end: south, side: "west", roomId: room.id },
    { orientation: "vertical", coord: east, start: north, end: south, side: "east", roomId: room.id },
  ];
}

function covers(edge: Edge, start: number, end: number) {
  const mid = (start + end) / 2;
  return edge.start - EPSILON <= mid && edge.end + EPSILON >= mid;
}

function openingAt(gaps: OpeningGap[], orientation: Edge["orientation"], coord: number, start: number, end: number) {
  const mid = (start + end) / 2;
  return gaps.find(gap => gap.orientation === orientation && sameCoord(gap.coord, coord) && gap.start - EPSILON <= mid && gap.end + EPSILON >= mid) ?? null;
}

function wallKind(orientation: Edge["orientation"], intervalEdges: Edge[]) {
  if (orientation === "vertical") {
    const leftRooms = intervalEdges.some(edge => edge.side === "east");
    const rightRooms = intervalEdges.some(edge => edge.side === "west");
    return leftRooms && rightRooms ? "interior" : "exterior";
  }

  const upperRooms = intervalEdges.some(edge => edge.side === "south");
  const lowerRooms = intervalEdges.some(edge => edge.side === "north");
  return upperRooms && lowerRooms ? "interior" : "exterior";
}

function makeSegment(orientation: Edge["orientation"], coord: number, start: number, end: number, kind: WallSegment3D["kind"], bottom: number, height: number): WallSegment3D {
  return orientation === "horizontal"
    ? {
      id: `wall-${orientation}-${roundKey(coord)}-${roundKey(start)}-${roundKey(end)}-${roundKey(bottom)}-${roundKey(height)}`,
      kind,
      orientation,
      x1: start,
      z1: coord,
      x2: end,
      z2: coord,
      bottom,
      height,
      thickness: kind === "exterior" ? EXTERIOR_THICKNESS : INTERIOR_THICKNESS,
    }
    : {
      id: `wall-${orientation}-${roundKey(coord)}-${roundKey(start)}-${roundKey(end)}-${roundKey(bottom)}-${roundKey(height)}`,
      kind,
      orientation,
      x1: coord,
      z1: start,
      x2: coord,
      z2: end,
      bottom,
      height,
      thickness: kind === "exterior" ? EXTERIOR_THICKNESS : INTERIOR_THICKNESS,
    };
}

function segmentsForOpening(orientation: Edge["orientation"], coord: number, start: number, end: number, kind: WallSegment3D["kind"], gap: OpeningGap | null) {
  if (!gap) return [makeSegment(orientation, coord, start, end, kind, 0, WALL_HEIGHT)];
  if (gap.kind === "door") return [];

  const sill = gap.kind === "window" ? WINDOW_SILL : VENT_SILL;
  const openingHeight = gap.kind === "window" ? WINDOW_HEIGHT : VENT_HEIGHT;
  const topStart = sill + openingHeight;
  const segments: WallSegment3D[] = [];

  if (sill > EPSILON) segments.push(makeSegment(orientation, coord, start, end, kind, 0, sill));
  if (WALL_HEIGHT - topStart > EPSILON) segments.push(makeSegment(orientation, coord, start, end, kind, topStart, WALL_HEIGHT - topStart));
  return segments;
}

function mergeSegments(segments: WallSegment3D[]) {
  const merged: WallSegment3D[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && previous.kind === segment.kind && previous.orientation === segment.orientation && previous.thickness === segment.thickness && previous.bottom === segment.bottom && previous.height === segment.height) {
      const sameLine = segment.orientation === "horizontal"
        ? sameCoord(previous.z1, segment.z1) && sameCoord(previous.x2, segment.x1)
        : sameCoord(previous.x1, segment.x1) && sameCoord(previous.z2, segment.z1);
      if (sameLine) {
        previous.x2 = segment.x2;
        previous.z2 = segment.z2;
        previous.id = `${previous.id}-${segment.id}`;
        continue;
      }
    }
    merged.push({ ...segment });
  }
  return merged;
}

export function buildPlan3DGeometry(plan: FloorPlan): { walls: WallSegment3D[] } {
  const edges = plan.rooms.flatMap(roomEdges);
  const openingGaps: OpeningGap[] = getPlanOpeningPlacements(plan, ["door", "window", "vent"]).map(placement => ({
    orientation: placement.orientation,
    coord: placement.coord,
    start: placement.start,
    end: placement.end,
    kind: placement.opening.kind,
  }));

  const groups = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = `${edge.orientation}:${roundKey(edge.coord)}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }

  const walls: WallSegment3D[] = [];
  for (const [key, groupEdges] of groups) {
    const [orientation] = key.split(":") as [Edge["orientation"], string];
    const coord = groupEdges[0].coord;
    const breakpoints = new Set<number>();
    groupEdges.forEach(edge => {
      breakpoints.add(edge.start);
      breakpoints.add(edge.end);
    });
    openingGaps.filter(gap => gap.orientation === orientation && sameCoord(gap.coord, coord)).forEach(gap => {
      breakpoints.add(gap.start);
      breakpoints.add(gap.end);
    });

    const points = [...breakpoints].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (end - start < EPSILON) continue;

      const intervalEdges = groupEdges.filter(edge => covers(edge, start, end));
      if (!intervalEdges.length) continue;

      const kind = wallKind(orientation, intervalEdges);
      walls.push(...segmentsForOpening(orientation, coord, start, end, kind, openingAt(openingGaps, orientation, coord, start, end)));
    }
  }

  return { walls: mergeSegments(walls) };
}
