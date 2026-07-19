import { Brief, LayoutIntent } from "./studio-types";
import { evaluateBriefFeasibility } from "./layout-feasibility";

const FEATURES = ["garage", "internal_staircase", "utility", "balcony", "study", "pantry", "laundry", "porch", "open_space", "prayer_room", "roof_garden"] as const;
const DIRECTIONS = ["north", "south", "east", "west", "unspecified"] as const;
const LAYOUT_TYPES = ["compact", "open", "villa", "duplex", "courtyard", "unspecified"] as const;
const CIRCULATION_STYLES = ["central_spine", "side_spine", "loop", "foyer_split", "courtyard_ring", "unspecified"] as const;
const ZONING_PREFERENCES = ["public_front", "private_rear", "split_bedrooms", "service_side", "unspecified"] as const;
const GARAGE_MODES = ["none", "front", "side", "rear", "unspecified"] as const;
const WET_CORE_PREFERENCES = ["side", "center", "stacked", "split", "unspecified"] as const;

type Feature = (typeof FEATURES)[number];
type Direction = (typeof DIRECTIONS)[number];

export type BriefRevisionPatch = {
  changeSummary?: string;
  rejected?: boolean;
  rejectionReason?: string;
  set?: Partial<Pick<Brief, "plotWidth" | "plotDepth" | "unit" | "floors" | "bedrooms" | "bathrooms" | "livingRooms" | "kitchens" | "diningRooms" | "style" | "facing" | "roadSide">> & {
    layoutIntent?: Partial<LayoutIntent>;
  };
  addFeatures?: string[];
  removeFeatures?: string[];
  addAdjacency?: string[];
  removeAdjacency?: string[];
  warnings?: string[];
};

export type BriefRevisionResult = {
  ok: boolean;
  brief: Brief;
  changeSummary: string;
  warnings: string[];
  errors: string[];
  changedFields: string[];
};

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function normalizeFeature(value: string): Feature | null {
  const normalized = value.toLowerCase().trim().replaceAll(" ", "_").replace(/stairs?|staircase/, "internal_staircase");
  return FEATURES.includes(normalized as Feature) ? normalized as Feature : null;
}

function normalizeFeatures(values: string[] | undefined) {
  return uniqueStrings(values ?? []).map(normalizeFeature).filter((feature): feature is Feature => Boolean(feature));
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]) {
  const normalized = String(value ?? fallback).toLowerCase().replaceAll(" ", "_");
  return allowed.includes(normalized) ? normalized as T[number] : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function integerValue(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(numberValue(value, fallback, min, max));
}

function explicitPlotChange(text: string) {
  return /\b(plot|site|dimension|width|depth|size|feet|foot|ft|metres?|meters?|sq)\b/i.test(text);
}

function explicitOrientationChange(text: string) {
  return /\b(facing|road|entry|gate|north|south|east|west)\b/i.test(text);
}

function explicitCountChange(text: string, field: keyof Brief) {
  const labels: Record<string, string> = {
    floors: "(?:floors?|storeys?|stories|levels?)",
    bedrooms: "(?:bedrooms?|bed rooms?|beds?)",
    bathrooms: "(?:bathrooms?|baths?|toilets?|powder rooms?)",
    livingRooms: "(?:living rooms?|great rooms?|lounges?|family rooms?)",
    kitchens: "(?:kitchens?)",
    diningRooms: "(?:dining rooms?|dining areas?)",
  };
  const label = labels[field];
  if (!label) return false;
  const quantity = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|another|extra|second|third|fourth|fifth|single)";
  const countNearRoom = new RegExp(`\\b(?:${quantity})\\s+${label}\\b|\\b${label}\\s*(?:to|=|:)\\s*(?:${quantity}|\\d+)\\b`, "i");
  const countVerb = new RegExp(`\\b(?:add|include|create|need|want|make|set|change|increase|decrease|remove|delete|drop|without|no|skip|exclude)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:${quantity}\\s+)?${label}\\b`, "i");
  return countNearRoom.test(text) || countVerb.test(text);
}

function mergeLayoutIntent(current: LayoutIntent | undefined, patch: Partial<LayoutIntent> | undefined): LayoutIntent | undefined {
  if (!patch) return current;
  const base = current ?? {
    layoutType: "unspecified",
    circulationStyle: "unspecified",
    zoningPreference: "unspecified",
    garageMode: "unspecified",
    wetCorePreference: "unspecified",
  };
  return {
    layoutType: enumValue(patch.layoutType, LAYOUT_TYPES, base.layoutType),
    circulationStyle: enumValue(patch.circulationStyle, CIRCULATION_STYLES, base.circulationStyle),
    zoningPreference: enumValue(patch.zoningPreference, ZONING_PREFERENCES, base.zoningPreference),
    garageMode: enumValue(patch.garageMode, GARAGE_MODES, base.garageMode),
    wetCorePreference: enumValue(patch.wetCorePreference, WET_CORE_PREFERENCES, base.wetCorePreference),
  };
}

export function normalizeRevisionPatch(value: unknown): BriefRevisionPatch {
  const input = typeof value === "object" && value ? value as Record<string, unknown> : {};
  const rawSet = typeof input.set === "object" && input.set ? input.set as Record<string, unknown> : {};
  const layoutIntent = typeof rawSet.layoutIntent === "object" && rawSet.layoutIntent ? rawSet.layoutIntent as Partial<LayoutIntent> : undefined;
  return {
    changeSummary: typeof input.changeSummary === "string" ? input.changeSummary.trim() : "",
    rejected: input.rejected === true,
    rejectionReason: typeof input.rejectionReason === "string" ? input.rejectionReason.trim() : "",
    set: {
      ...rawSet,
      layoutIntent,
    },
    addFeatures: Array.isArray(input.addFeatures) ? input.addFeatures.filter(item => typeof item === "string") : [],
    removeFeatures: Array.isArray(input.removeFeatures) ? input.removeFeatures.filter(item => typeof item === "string") : [],
    addAdjacency: Array.isArray(input.addAdjacency) ? input.addAdjacency.filter(item => typeof item === "string") : [],
    removeAdjacency: Array.isArray(input.removeAdjacency) ? input.removeAdjacency.filter(item => typeof item === "string") : [],
    warnings: Array.isArray(input.warnings) ? input.warnings.filter(item => typeof item === "string") : [],
  };
}

export function buildLocalRevisionPatch(current: Brief, correction: string): BriefRevisionPatch {
  const text = correction.toLowerCase();
  const patch: BriefRevisionPatch = { changeSummary: correction.trim(), set: {}, addFeatures: [], removeFeatures: [], addAdjacency: [], warnings: [] };

  if (/\bkitchen\b/.test(text) && /\bdining\b/.test(text) && /\b(near|beside|next to|closer|adjacent|connect|open)\b/.test(text)) {
    patch.addAdjacency?.push("kitchen beside dining room");
  }
  if (/\bhall(way)?\b/.test(text) && /\b(wider|wide|clear|spacious|broader)\b/.test(text)) {
    patch.addAdjacency?.push("wider clear hallway circulation");
    patch.set = { ...patch.set, layoutIntent: { ...(patch.set?.layoutIntent ?? {}), circulationStyle: "central_spine" } };
  }
  if (/\b(loop|round|rounded|circular)\b/.test(text) && /\b(hall|hallway|corridor|circulation)\b/.test(text)) {
    patch.set = { ...patch.set, layoutIntent: { ...(patch.set?.layoutIntent ?? {}), circulationStyle: "loop" } };
    patch.addAdjacency?.push("loop circulation requested");
  }
  if (/\b(remove|delete|replace|without|no|skip)\b[^.?!;\n]{0,60}\b(garage lobby|mudroom|mud room)\b/.test(text)) {
    if (/\b(dining|dining area|dining room)\b/.test(text)) patch.addAdjacency?.push("replace garage lobby with dining area");
    else if (/\bpantry\b/.test(text)) patch.addAdjacency?.push("replace garage lobby with pantry");
    else patch.addAdjacency?.push("remove garage lobby");
  }

  const featureLabels: Array<[Feature, RegExp]> = [
    ["garage", /\bgarage\b/],
    ["porch", /\b(porch|veranda|sit-out|sitout)\b/],
    ["pantry", /\bpantry\b/],
    ["utility", /\butility\b/],
    ["laundry", /\blaundry\b/],
    ["study", /\b(study|office|flex room)\b/],
    ["internal_staircase", /\b(stair|stairs|staircase)\b/],
  ];
  featureLabels.forEach(([feature, pattern]) => {
    if (!pattern.test(text)) return;
    if (feature === "garage" && /\b(garage lobby|mudroom|mud room)\b/.test(text)) return;
    if (/\b(remove|delete|without|no|skip|exclude)\b/.test(text)) patch.removeFeatures?.push(feature);
    if (/\b(add|include|need|want|with|create)\b/.test(text)) patch.addFeatures?.push(feature);
  });

  const countTargets: Array<[keyof Brief, RegExp]> = [
    ["bedrooms", /\b(\d+)\s*(?:bedrooms?|beds?)\b/],
    ["bathrooms", /\b(\d+)\s*(?:bathrooms?|baths?|toilets?)\b/],
    ["floors", /\b(\d+)\s*(?:floors?|storeys?|stories|levels?)\b/],
  ];
  countTargets.forEach(([field, pattern]) => {
    const match = text.match(pattern);
    if (match && patch.set) patch.set[field] = Number(match[1]) as never;
  });

  if (/\b(vague|nicer|better|beautiful|improve it)\b/.test(text) && !patch.addAdjacency?.length && !patch.addFeatures?.length && !patch.removeFeatures?.length) {
    return { rejected: true, rejectionReason: "Please describe a concrete layout change, like moving a room, adding a feature, or changing a count.", warnings: [] };
  }

  if (!patch.addAdjacency?.length && !patch.addFeatures?.length && !patch.removeFeatures?.length && !Object.keys(patch.set ?? {}).length) {
    return { rejected: true, rejectionReason: "No concrete revision was detected. Try a specific change such as 'move kitchen near dining' or 'make hallway wider'.", warnings: [] };
  }

  patch.addFeatures = uniqueStrings(patch.addFeatures ?? []);
  patch.removeFeatures = uniqueStrings(patch.removeFeatures ?? []);
  patch.addAdjacency = uniqueStrings(patch.addAdjacency ?? []);
  patch.removeAdjacency = uniqueStrings(patch.removeAdjacency ?? []);
  patch.changeSummary = patch.changeSummary || "Apply requested plan revision.";
  patch.warnings = [...(patch.warnings ?? []), ...(current.warnings ?? [])].filter(Boolean);
  return patch;
}

export function applyBriefRevision(current: Brief, patchInput: BriefRevisionPatch, correction: string): BriefRevisionResult {
  const correctionText = correction.trim();
  const patch = normalizeRevisionPatch(patchInput);
  if (patch.rejected) {
    return {
      ok: false,
      brief: current,
      changeSummary: patch.rejectionReason || "Revision was not specific enough.",
      warnings: patch.warnings ?? [],
      errors: [patch.rejectionReason || "Revision was rejected."],
      changedFields: [],
    };
  }

  const next: Brief = {
    ...current,
    features: [...current.features],
    adjacency: [...current.adjacency],
    warnings: [...current.warnings],
    layoutIntent: current.layoutIntent ? { ...current.layoutIntent } : undefined,
    prompt: correctionText ? `${current.prompt}\nRevision request: ${correctionText}` : current.prompt,
  };
  const changed = new Set<string>();
  const set = patch.set ?? {};

  if (explicitPlotChange(correctionText)) {
    if (set.plotWidth !== undefined) { next.plotWidth = numberValue(set.plotWidth, current.plotWidth, 8, 1000); changed.add("plotWidth"); }
    if (set.plotDepth !== undefined) { next.plotDepth = numberValue(set.plotDepth, current.plotDepth, 8, 1000); changed.add("plotDepth"); }
    if (set.unit === "feet" || set.unit === "metres") { next.unit = set.unit; changed.add("unit"); }
  }

  if (explicitOrientationChange(correctionText)) {
    if (set.facing !== undefined) { next.facing = enumValue(set.facing, DIRECTIONS, current.facing) as Direction; changed.add("facing"); }
    if (set.roadSide !== undefined) { next.roadSide = enumValue(set.roadSide, DIRECTIONS, current.roadSide) as Direction; changed.add("roadSide"); }
  }

  (["floors", "bedrooms", "bathrooms", "livingRooms", "kitchens", "diningRooms"] as const).forEach(field => {
    if (set[field] === undefined || !explicitCountChange(correctionText, field)) return;
    const max = field === "floors" ? 3 : 12;
    next[field] = integerValue(set[field], current[field], field === "floors" ? 1 : 0, max) as never;
    changed.add(field);
  });

  if (typeof set.style === "string" && set.style.trim()) {
    next.style = set.style.trim();
    changed.add("style");
  }
  const mergedIntent = mergeLayoutIntent(current.layoutIntent, set.layoutIntent);
  if (mergedIntent && JSON.stringify(mergedIntent) !== JSON.stringify(current.layoutIntent)) {
    next.layoutIntent = mergedIntent;
    changed.add("layoutIntent");
  }

  const removeFeatures = new Set(normalizeFeatures(patch.removeFeatures));
  const addFeatures = normalizeFeatures(patch.addFeatures).filter(feature => !removeFeatures.has(feature));
  const featureSet = new Set(next.features.filter(feature => !removeFeatures.has(feature as Feature)));
  addFeatures.forEach(feature => featureSet.add(feature));
  next.features = [...featureSet];
  if (addFeatures.length || removeFeatures.size) changed.add("features");

  const removeAdjacency = new Set(uniqueStrings(patch.removeAdjacency ?? []).map(value => value.toLowerCase()));
  const addAdjacency = uniqueStrings(patch.addAdjacency ?? []);
  next.adjacency = uniqueStrings([
    ...next.adjacency.filter(item => !removeAdjacency.has(item.toLowerCase())),
    ...addAdjacency,
  ]);
  if (addAdjacency.length || removeAdjacency.size) changed.add("adjacency");

  next.warnings = uniqueStrings([...(patch.warnings ?? []), ...next.warnings]);

  if (!changed.size) {
    return {
      ok: false,
      brief: current,
      changeSummary: "No safe structured change was detected.",
      warnings: next.warnings,
      errors: ["The revision did not produce a safe structured change."],
      changedFields: [],
    };
  }

  const feasibility = evaluateBriefFeasibility(next);
  if (!feasibility.canGenerate) {
    return {
      ok: false,
      brief: current,
      changeSummary: patch.changeSummary || "Revision would make the plan infeasible.",
      warnings: [...next.warnings, ...feasibility.warnings],
      errors: feasibility.errors,
      changedFields: [...changed],
    };
  }

  return {
    ok: true,
    brief: next,
    changeSummary: patch.changeSummary || correctionText || "Revision applied.",
    warnings: [...next.warnings, ...feasibility.warnings],
    errors: [],
    changedFields: [...changed],
  };
}
