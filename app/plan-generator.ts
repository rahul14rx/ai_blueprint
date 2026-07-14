import { Brief, FloorPlan, Opening, Project, ROOM_COLORS, Room, RoomType, PRESETS } from "./studio-types";

const uid = () => Math.random().toString(36).slice(2, 9);
const room = (level: number, name: string, type: RoomType, x: number, y: number, width: number, depth: number): Room => ({ id: `f${level}-${type}-${uid()}`, name, type, x, y, width, depth, color: ROOM_COLORS[type] });

export function parseBrief(prompt: string, form: Partial<Brief>): Brief {
  const lower = prompt.toLowerCase();
  const floorMatch = lower.match(/(\d+)\s*(?:floor|storey|story)/);
  const bedMatch = lower.match(/(\d+)\s*(?:bed|bedroom)/);
  const bathMatch = lower.match(/(\d+)\s*(?:bath|bathroom)/);
  const inferredStyle = ["modern", "minimal", "traditional", "luxury", "industrial"].find(s => lower.includes(s)) ?? "Modern";
  return {
    title: form.title || "My Home Concept", prompt, floors: Math.min(3, Math.max(1, form.floors || Number(floorMatch?.[1]) || 2)),
    plotWidth: Math.max(8, form.plotWidth || 14), plotDepth: Math.max(8, form.plotDepth || 18),
    bedrooms: Math.max(1, form.bedrooms || Number(bedMatch?.[1]) || 3), bathrooms: Math.max(1, form.bathrooms || Number(bathMatch?.[1]) || 2),
    style: form.style || inferredStyle[0].toUpperCase() + inferredStyle.slice(1),
    features: ["garage", "balcony", "roof garden", "study"].filter(feature => lower.includes(feature)),
  };
}

export function generatePlans(brief: Brief): FloorPlan[] {
  const W = brief.plotWidth, D = brief.plotDepth;
  return Array.from({ length: brief.floors }, (_, level) => {
    const sx = W / 40, sy = D / 60;
    const rooms: Room[] = [
      room(level, "Bedroom 1", "bedroom", 0, 0, 18*sx, 22*sy), room(level, "Bedroom 2", "bedroom", 18*sx, 0, 22*sx, 22*sy),
      room(level, "Attached bath", "bathroom", 0, 22*sy, 8*sx, 10*sy), room(level, "Common bath", "bathroom", 8*sx, 22*sy, 8*sx, 10*sy),
      room(level, "Passage", "dining", 16*sx, 22*sy, 8*sx, 10*sy), room(level, "Internal stairs", "stairs", 24*sx, 22*sy, 8*sx, 10*sy),
      room(level, "Entry foyer", "living", 32*sx, 22*sy, 8*sx, 10*sy), room(level, "Living room", "living", 0, 32*sy, 20*sx, 28*sy),
      room(level, "Kitchen", "kitchen", 20*sx, 32*sy, 10*sx, 14*sy), room(level, "Utility", "kitchen", 20*sx, 46*sy, 5*sx, 6*sy),
      room(level, "Dining", "dining", 20*sx, 52*sy, 10*sx, 8*sy), room(level, "Garage", "garage", 30*sx, 32*sy, 10*sx, 28*sy),
    ];
    const openings: Opening[] = rooms.flatMap((r, i) => [
      { id: `door-${r.id}`, kind: "door" as const, wall: i % 2 ? "west" as const : "south" as const, roomId: r.id, offset: .5, width: Math.min(1.1, r.width * .35) },
      ...(r.type !== "stairs" && r.type !== "bathroom" ? [{ id: `window-${r.id}`, kind: "window" as const, wall: "north" as const, roomId: r.id, offset: .5, width: Math.min(1.8, r.width * .45) }] : []),
    ]);
    return { id: `floor-${level}-${uid()}`, level, elevation: level * 10, width: W, depth: D, rooms, openings };
  });
}

export function validatePlans(plans: FloorPlan[]): string[] {
  const errors: string[] = [];
  plans.forEach(plan => {
    plan.rooms.forEach((room, i) => {
      if (room.width < 4 || room.depth < 4) errors.push(`${room.name} is smaller than the 4 ft minimum.`);
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
