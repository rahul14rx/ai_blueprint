export type Point = { x: number; y: number };
export type RoomType = "living" | "kitchen" | "bedroom" | "bathroom" | "dining" | "garage" | "stairs";
export type Room = { id: string; name: string; type: RoomType; x: number; y: number; width: number; depth: number; color: string };
export type Opening = { id: string; kind: "door" | "window"; wall: "north" | "south" | "east" | "west"; roomId: string; offset: number; width: number };
export type FloorPlan = { id: string; level: number; elevation: number; width: number; depth: number; rooms: Room[]; openings: Opening[] };
export type Brief = { title: string; prompt: string; floors: number; plotWidth: number; plotDepth: number; bedrooms: number; bathrooms: number; style: string; features: string[] };
export type Surface = "floor" | "wall" | "ceiling";
export type MaterialSet = { floor: string; wall: string; ceiling: string; accent: string };
export type ProjectState = "draft" | "requirements_ready" | "plan_editing" | "plan_approved" | "model_ready" | "interior_editing" | "ready";
export type Project = { id: string; version: number; state: ProjectState; brief: Brief; plans: FloorPlan[]; materials: Record<string, MaterialSet>; updatedAt: string };

export const ROOM_COLORS: Record<RoomType, string> = {
  living: "#DDE9D5", kitchen: "#F2DFC3", bedroom: "#D9E4F4", bathroom: "#D6ECEA", dining: "#E9DDF0", garage: "#E2E4E7", stairs: "#F5E4B8",
};

export const PRESETS: Record<string, MaterialSet> = {
  Modern: { floor: "#B9A58D", wall: "#F2F0EA", ceiling: "#FFFFFF", accent: "#252A2E" },
  Minimal: { floor: "#D5D0C6", wall: "#FAFAF7", ceiling: "#FFFFFF", accent: "#9C958B" },
  Traditional: { floor: "#7D563A", wall: "#F3E4CF", ceiling: "#FFF7E8", accent: "#8B3E2F" },
  Luxury: { floor: "#D8D0C0", wall: "#E9E3D7", ceiling: "#FFFCF5", accent: "#B08D57" },
  Industrial: { floor: "#747474", wall: "#C8C4BD", ceiling: "#A9A6A0", accent: "#2D3032" },
};
