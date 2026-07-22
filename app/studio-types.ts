export type Point = { x: number; y: number };
export type RoomType = "living" | "kitchen" | "bedroom" | "bathroom" | "dining" | "garage" | "stairs" | "foyer" | "hallway" | "utility" | "study" | "pantry" | "laundry" | "storage" | "porch" | "balcony" | "open";
export type WallSide = "north" | "south" | "east" | "west";
export type Room = { id: string; name: string; type: RoomType; x: number; y: number; width: number; depth: number; color: string; shape?: "rect" | "rounded"; curveSide?: WallSide };
export type Opening = { id: string; kind: "door" | "window" | "vent"; wall: WallSide; roomId: string; offset: number; width: number };
export type FloorPlan = { id: string; level: number; elevation: number; width: number; depth: number; unit: "feet" | "metres"; facing: Brief["facing"]; roadSide: Brief["roadSide"]; rooms: Room[]; openings: Opening[] };
export type GenerationTraceCandidate = { label: string; source: "baseline" | "experimental"; score: number; valid: boolean; selected: boolean; errors: string[]; warnings: string[] };
export type GenerationTrace = { selectedLabel: string; candidates: GenerationTraceCandidate[] };
export type LayoutIntent = { layoutType: "compact" | "open" | "villa" | "duplex" | "courtyard" | "unspecified"; circulationStyle: "central_spine" | "side_spine" | "loop" | "foyer_split" | "courtyard_ring" | "unspecified"; zoningPreference: "public_front" | "private_rear" | "split_bedrooms" | "service_side" | "unspecified"; garageMode: "none" | "front" | "side" | "rear" | "unspecified"; wetCorePreference: "side" | "center" | "stacked" | "split" | "unspecified" };
export type Brief = { title: string; prompt: string; floors: number; plotWidth: number; plotDepth: number; unit: "feet" | "metres"; bedrooms: number; bathrooms: number; livingRooms: number; kitchens: number; diningRooms: number; style: string; facing: "north" | "south" | "east" | "west" | "unspecified"; roadSide: "north" | "south" | "east" | "west" | "unspecified"; features: string[]; adjacency: string[]; warnings: string[]; layoutIntent?: LayoutIntent };
export type Surface = "floor" | "wall" | "ceiling";
export type MaterialSet = { floor: string; wall: string; ceiling: string; accent: string };
export type RoofTemplate = "none" | "flat" | "gable" | "hip" | "designer";
export type ProjectState = "draft" | "requirements_ready" | "plan_editing" | "plan_approved" | "model_ready" | "interior_editing" | "ready";
export type Project = { id: string; version: number; state: ProjectState; brief: Brief; plans: FloorPlan[]; materials: Record<string, MaterialSet>; updatedAt: string; generationTrace?: GenerationTrace };

export const ROOM_COLORS: Record<RoomType, string> = {
  living: "#DDE9D5", kitchen: "#F2DFC3", bedroom: "#D9E4F4", bathroom: "#D6ECEA", dining: "#E9DDF0", garage: "#E2E4E7", stairs: "#F5E4B8",
  foyer: "#F8F3E7", hallway: "#F7F7F2", utility: "#E8E0CF", study: "#E1E8D9", pantry: "#EFE4CE", laundry: "#DCE9E7", storage: "#EEEEEA", porch: "#F7F2E5", balcony: "#E7F0DF", open: "#FFFDF6",
};

export const PRESETS: Record<string, MaterialSet> = {
  Modern: { floor: "#B9A58D", wall: "#F2F0EA", ceiling: "#FFFFFF", accent: "#252A2E" },
  Minimal: { floor: "#D5D0C6", wall: "#FAFAF7", ceiling: "#FFFFFF", accent: "#9C958B" },
  Traditional: { floor: "#7D563A", wall: "#F3E4CF", ceiling: "#FFF7E8", accent: "#8B3E2F" },
  Luxury: { floor: "#D8D0C0", wall: "#E9E3D7", ceiling: "#FFFCF5", accent: "#B08D57" },
  Industrial: { floor: "#747474", wall: "#C8C4BD", ceiling: "#A9A6A0", accent: "#2D3032" },
};
