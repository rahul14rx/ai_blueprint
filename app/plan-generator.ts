import { Brief, FloorPlan, GenerationTrace, Opening, Project, ROOM_COLORS, Room, RoomType, PRESETS } from "./studio-types";
import { evaluateGroundFloorCandidates } from "./layout-optimizer";
import { needsWetVentilation, removeNegatedFeatures, requestedOptionalFeaturesFromText, roomMeetsMinimum, roomRule, wantsAttachedBath } from "./layout-rules";
import { evaluateArchitecture } from "./architecture-validator";

const uid = () => Math.random().toString(36).slice(2, 9);
const room = (level: number, name: string, type: RoomType, x: number, y: number, width: number, depth: number): Room => ({ id: `f${level}-${type}-${uid()}`, name, type, x, y, width, depth, color: ROOM_COLORS[type] });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const nearly = (a: number, b: number) => Math.abs(a - b) < 0.03;
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1);
const feet = (brief: Brief, value: number) => brief.unit === "feet" ? value : value * 0.3048;
const target = (brief: Brief, min: number, ideal: number, max: number, available: number) => clamp(feet(brief, ideal), feet(brief, min), Math.min(feet(brief, max), available));
const wantsRoundedLiving = (brief: Brief) => /\b(round|rounded|curved|curve|semi[-\s]?circular|circular)\b.*\b(living|lounge|great room)\b|\b(living|lounge|great room)\b.*\b(round|rounded|curved|curve|semi[-\s]?circular|circular)\b/i.test(brief.prompt);
const intentText = (brief: Brief) => `${brief.prompt} ${brief.adjacency.join(" ")}`.toLowerCase();
const wantsGarageLobbyReplacement = (brief: Brief, targetRoom: "dining" | "pantry" | "storage") => {
  const text = intentText(brief);
  const targetPattern = targetRoom === "dining" ? /\b(dining|dining area|dining room)\b/ : targetRoom === "pantry" ? /\bpantry\b/ : /\b(storage|store)\b/;
  return /\b(remove|delete|replace|without|no|skip)\b[^.?!;\n]{0,60}\b(garage lobby|mudroom|mud room)\b/i.test(text) && targetPattern.test(text);
};
const wantsNoGarageLobby = (brief: Brief) => /\b(remove|delete|without|no|skip)\b[^.?!;\n]{0,60}\b(garage lobby|mudroom|mud room)\b/i.test(intentText(brief));
const OPTIONAL_FEATURES = ["garage", "internal_staircase", "utility", "balcony", "roof_garden", "study", "pantry", "laundry", "porch", "open_space", "prayer_room"];
const NUMBER_WORDS: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
type Direction = "north" | "south" | "east" | "west";

function numberValue(value: string | undefined) {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  const parsed = Number(lower);
  return Number.isFinite(parsed) ? parsed : NUMBER_WORDS[lower];
}

function firstCount(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return numberValue(match?.[1]);
}

function inferFloorCount(text: string) {
  if (/\b(single|one)[-\s]?(floor|storey|story)\b|\bground[-\s]?floor\b|\bsingle[-\s]?floor\b/.test(text)) return 1;
  return firstCount(text, /\b(\d+|one|two|three)\s*(?:floor|storey|story)\b/);
}

function inferBathroomCount(text: string) {
  const generic = firstCount(text, /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:bathrooms?|baths?)\b/);
  const specific = [...text.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:full|common|attached|ensuite|en-suite|half|powder|toilet)\s*(?:bathrooms?|baths?|toilets?|rooms?)\b/g)]
    .reduce((sum, match) => sum + (numberValue(match[1]) ?? 0), 0);
  if (specific > 0) return Math.max(generic ?? 0, specific);
  if (/\b(half bath|powder room|toilet room)\b/.test(text)) return Math.max(generic ?? 0, 1);
  return generic;
}

function isRoomNegated(text: string, labels: string[]) {
  return labels.some(label => {
    const phrase = label.replace(/\s+/g, "[-\\s]+");
    return new RegExp(`\\b(no|not|without|avoid|exclude|skip)\\b[^.?!;\\n]{0,35}\\b${phrase}\\b|\\b${phrase}\\b[^.?!;\\n]{0,35}\\b(not required|not needed|not necessary)\\b`, "i").test(text);
  });
}

function inferSharedRoomCount(text: string, labels: string[], defaultWhenMentioned = 1) {
  if (isRoomNegated(text, labels)) return 0;
  const labelPattern = labels.map(label => label.replace(/\s+/g, "[-\\s]+")).join("|");
  const counted = firstCount(text, new RegExp(`\\b(\\d+|one|two|three|four)\\s*(?:${labelPattern})s?\\b`));
  if (counted !== undefined) return counted;
  return new RegExp(`\\b(?:${labelPattern})\\b`, "i").test(text) ? defaultWhenMentioned : undefined;
}

function inferLivingRoomCount(text: string) {
  const inferred = inferSharedRoomCount(text, ["living room", "living", "great room", "lounge", "family lounge", "family room"]);
  if (inferred !== 1) return inferred;
  const hasFormalLiving = /\bformal\s+living(?:\s+room)?\b/i.test(text);
  const hasFamilyLounge = /\bfamily\s+(?:lounge|room)\b/i.test(text);
  const doubleHeightOnly = /\bdouble[-\s]?height\b[^.?!;\n]{0,40}\b(living|great room|lounge)\b|\b(living|great room|lounge)\b[^.?!;\n]{0,40}\bdouble[-\s]?height\b/i.test(text);
  return hasFormalLiving && hasFamilyLounge && !doubleHeightOnly ? 2 : inferred;
}

function inferPlot(text: string): Pick<Brief, "plotWidth" | "plotDepth" | "unit"> | null {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|m|meter|metre|meters|metres)?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(ft|feet|foot|m|meter|metre|meters|metres)\b/);
  if (!match) return null;
  return {
    plotWidth: Number(match[1]),
    plotDepth: Number(match[2]),
    unit: /^m|met/i.test(match[3]) ? "metres" : "feet",
  };
}

function inferFacing(text: string): Direction | undefined {
  const match = text.match(/\b(north|south|east|west)[-\s]?facing\b/);
  return match?.[1] as Direction | undefined;
}

function inferRoadSide(text: string): Direction | undefined {
  const direct = text.match(/\b(?:road|main entry|entry|gate)\b[^.?!;\n]{0,45}\b(?:on|at|to|from)\s+(?:the\s+)?(north|south|east|west)\s+side\b/);
  if (direct?.[1]) return direct[1] as Direction;
  const reverse = text.match(/\b(north|south|east|west)\s+side\b[^.?!;\n]{0,45}\b(?:road|main entry|entry|gate)\b/);
  return reverse?.[1] as Direction | undefined;
}

export function parseBrief(prompt: string, form: Partial<Brief>): Brief {
  const lower = prompt.toLowerCase();
  const inferredFloors = inferFloorCount(lower);
  const inferredBedrooms = firstCount(lower, /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:bed|bedroom|bedrooms)\b/);
  const inferredBathrooms = inferBathroomCount(lower);
  const inferredLivingRooms = inferLivingRoomCount(lower);
  const inferredKitchens = inferSharedRoomCount(lower, ["kitchen"]);
  const inferredDiningRooms = inferSharedRoomCount(lower, ["dining room", "dining area", "dining nook", "dining"]);
  const inferredPlot = inferPlot(lower);
  const inferredFacing = inferFacing(lower);
  const inferredRoadSide = inferRoadSide(lower);
  const inferredStyle = ["modern", "minimal", "traditional", "luxury", "industrial"].find(s => lower.includes(s)) ?? "Modern";
  const adjacency = form.adjacency || [];
  const features = removeNegatedFeatures(form.features ?? requestedOptionalFeaturesFromText(prompt, OPTIONAL_FEATURES), prompt, adjacency);
  return {
    title: form.title || "My Home Concept", prompt, floors: Math.min(3, Math.max(1, form.floors ?? inferredFloors ?? 1)),
    plotWidth: Math.max(8, form.plotWidth ?? inferredPlot?.plotWidth ?? 14), plotDepth: Math.max(8, form.plotDepth ?? inferredPlot?.plotDepth ?? 18), unit: form.unit || inferredPlot?.unit || "feet",
    bedrooms: Math.max(0, form.bedrooms ?? inferredBedrooms ?? 3), bathrooms: Math.max(0, form.bathrooms ?? inferredBathrooms ?? 2),
    livingRooms: form.livingRooms ?? inferredLivingRooms ?? 1, kitchens: form.kitchens ?? inferredKitchens ?? 1, diningRooms: form.diningRooms ?? inferredDiningRooms ?? 1,
    style: form.style || inferredStyle[0].toUpperCase() + inferredStyle.slice(1),
    facing: form.facing || inferredFacing || "unspecified", roadSide: form.roadSide || inferredRoadSide || inferredFacing || "unspecified",
    features,
    adjacency, warnings: form.warnings || [],
  };
}

export function generatePlans(brief: Brief): FloorPlan[] {
  return generatePlansWithTrace(brief).plans;
}

function generatePlansWithTrace(brief: Brief): { plans: FloorPlan[]; generationTrace?: GenerationTrace } {
  const W = brief.plotWidth, D = brief.plotDepth;
  let generationTrace: GenerationTrace | undefined;
  const plans = Array.from({ length: brief.floors }, (_, level) => {
    if (level === 0 && W >= feet(brief, 24) && D >= feet(brief, 32)) {
      const result = generateArchitecturalGroundFloorResult(brief, level);
      generationTrace = result.trace;
      return result.plan;
    }
    return generateFallbackFloor(brief, level);
  });
  return { plans, generationTrace };
}

function generateFallbackFloor(brief: Brief, level: number): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const specs = roomSpecs(brief);
  const cols = specs.length <= 4 ? 2 : 3;
  const rows = Math.ceil(specs.length / cols);
  const rowDepth = D / rows;
  const rooms: Room[] = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    const rowSpecs = specs.slice(rowIndex * cols, (rowIndex + 1) * cols);
    const cellWidth = W / rowSpecs.length;
    rowSpecs.forEach((spec, colIndex) => rooms.push(room(level, spec.name, spec.type, colIndex * cellWidth, rowIndex * rowDepth, cellWidth, rowDepth)));
  }
  return makeFloorPlan(brief, level, rooms);
}

function roomSpecs(brief: Brief): { name: string; type: RoomType }[] {
  const specs: { name: string; type: RoomType }[] = [];
  for (let i = 0; i < brief.livingRooms; i++) specs.push({ name: brief.livingRooms > 1 ? `Living room ${i + 1}` : "Living room", type: "living" });
  for (let i = 0; i < brief.kitchens; i++) specs.push({ name: brief.kitchens > 1 ? `Kitchen ${i + 1}` : "Kitchen", type: "kitchen" });
  for (let i = 0; i < brief.diningRooms; i++) specs.push({ name: brief.diningRooms > 1 ? `Dining ${i + 1}` : "Dining", type: "dining" });
  for (let i = 0; i < brief.bedrooms; i++) specs.push({ name: `Bedroom ${i + 1}`, type: "bedroom" });
  for (let i = 0; i < brief.bathrooms; i++) specs.push({ name: i === 0 && brief.bedrooms && wantsAttachedBath(brief) ? "Attached bath" : `Bathroom ${i + 1}`, type: "bathroom" });
  if (brief.features.includes("internal_staircase")) specs.push({ name: "Internal stairs", type: "stairs" });
  if (brief.features.includes("garage")) specs.push({ name: "Garage", type: "garage" });
  if (brief.features.includes("utility")) specs.push({ name: "Utility", type: "utility" });
  if (brief.features.includes("study")) specs.push({ name: "Study", type: "study" });
  if (brief.features.includes("pantry")) specs.push({ name: "Pantry", type: "pantry" });
  if (brief.features.includes("laundry")) specs.push({ name: "Laundry", type: "laundry" });
  if (brief.features.includes("porch")) specs.push({ name: "Porch", type: "porch" });
  if (brief.features.includes("balcony")) specs.push({ name: "Balcony", type: "balcony" });
  if (brief.features.includes("open_space")) specs.push({ name: "Open flexible space", type: "open" });
  if (brief.features.includes("prayer_room")) specs.push({ name: "Prayer room", type: "living" });
  return specs.length ? specs : [{ name: "Open room", type: "living" }];
}

type PlanCandidate = { label: string; source: "baseline" | "experimental"; plan: FloorPlan };

function generateArchitecturalGroundFloorResult(brief: Brief, level: number): { plan: FloorPlan; trace: GenerationTrace } {
  const optimizedLayouts = evaluateGroundFloorCandidates(brief, level);
  const roadSide = brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing;
  const candidates: PlanCandidate[] = [];
  optimizedLayouts.forEach((layout, index) => candidates.push({
    label: `${index === 0 ? "Optimizer primary" : "Optimizer alternate"}: ${layout.strategy}`,
    source: index === 0 ? "baseline" : "experimental",
    plan: makeFloorPlan(brief, level, layout.rooms),
  }));
  if ((roadSide === "north" || roadSide === "south") && brief.bedrooms === 3 && !brief.features.includes("garage") && brief.plotWidth >= feet(brief, 24) && brief.plotDepth >= feet(brief, 38)) {
    candidates.push({ label: "Experimental: compact 3-bedroom public split", source: "experimental", plan: makeCompactThreeBedroomPlan(brief, level, roadSide) });
  }
  if ((roadSide === "north" || roadSide === "south") && brief.bedrooms === 2 && !brief.features.includes("garage") && brief.plotWidth >= feet(brief, 24) && brief.plotDepth >= feet(brief, 32)) {
    candidates.push({ label: "Experimental: compact 2-bedroom open plan", source: "experimental", plan: makeCompactTwoBedroomOpenPlan(brief, level, roadSide) });
  }
  candidates.push({
    label: roadSide === "north" || roadSide === "south" ? "Legacy generator: north-south heuristic" : "Legacy generator: east-west heuristic",
    source: "experimental",
    plan: roadSide === "north" || roadSide === "south"
      ? makeNorthSouthPlan(brief, level, roadSide)
      : makeEastWestPlan(brief, level, roadSide === "west" ? "west" : "east"),
  });
  const repairCandidates = candidates.flatMap(candidate => makeServiceAccessRepairCandidates(brief, level, candidate));
  candidates.push(...repairCandidates);

  const fallback = candidates[0] ?? { label: "Fallback grid generator", source: "baseline" as const, plan: generateFallbackFloor(brief, level) };
  const baseline = candidates.find(candidate => finalPlanErrors(brief, candidate.plan).length === 0) ?? fallback;
  return selectBestGroundFloorCandidate(brief, baseline, candidates.filter(candidate => candidate !== baseline));
}

export function finalPlanErrors(brief: Brief, plan: FloorPlan) {
  return [...validatePlans([plan]), ...evaluateArchitecture(brief, plan).errors];
}

function planChoiceScore(brief: Brief, plan: FloorPlan) {
  const geometryErrors = validatePlans([plan]);
  const architecture = evaluateArchitecture(brief, plan);
  const errors = [...new Set([...geometryErrors, ...architecture.errors])];
  return {
    plan,
    errors,
    score: architecture.score - errors.length * 100 - architecture.warnings.length * 4,
  };
}

function makeServiceAccessRepairCandidates(brief: Brief, level: number, candidate: PlanCandidate): PlanCandidate[] {
  const beforeErrors = finalPlanErrors(brief, candidate.plan);
  const serviceRooms = candidate.plan.rooms.filter(room =>
    ["utility", "laundry", "pantry"].includes(room.type) &&
    beforeErrors.some(error => error.startsWith(`${room.name} is not clearly reachable`) || error.startsWith(`${room.name} has no usable door`))
  );
  if (!serviceRooms.length) return [];

  const repairedRooms = candidate.plan.rooms.map(item => ({ ...item }));
  let changed = false;
  serviceRooms.forEach(serviceRoom => {
    const index = repairedRooms.findIndex(item => item.id === serviceRoom.id);
    if (index < 0) return;
    const placed = findAccessibleServicePlacement(brief, candidate.plan, repairedRooms.filter(item => item.id !== serviceRoom.id), repairedRooms[index]);
    if (!placed) return;
    repairedRooms[index] = placed;
    changed = true;
  });
  if (!changed) return [];

  const repairedPlan = makeFloorPlan(brief, level, repairedRooms);
  const afterErrors = finalPlanErrors(brief, repairedPlan);
  if (afterErrors.length >= beforeErrors.length) return [];
  return [{
    label: `Repair: service access for ${candidate.label}`,
    source: "experimental",
    plan: repairedPlan,
  }];
}

function findAccessibleServicePlacement(brief: Brief, plan: FloorPlan, fixedRooms: Room[], serviceRoom: Room) {
  const accessTargets = fixedRooms.filter(room => {
    if (serviceRoom.type === "pantry") return room.type === "kitchen" || isAccessRoom(room);
    return room.type === "kitchen" || room.type === "bathroom" || isAccessRoom(room);
  });
  const sizes = uniqueSizes([
    { width: serviceRoom.width, depth: serviceRoom.depth },
    { width: serviceRoom.depth, depth: serviceRoom.width },
    {
      width: Math.max(serviceRoom.width, feet(brief, serviceRoom.type === "pantry" ? 5 : 6)),
      depth: Math.max(serviceRoom.depth, feet(brief, serviceRoom.type === "pantry" ? 5 : 6)),
    },
  ]);

  return accessTargets.flatMap(targetRoom => servicePlacementAttempts(plan, fixedRooms, serviceRoom, targetRoom, sizes)
    .map(placed => ({
      placed,
      score: servicePlacementScore(plan, serviceRoom, targetRoom, placed),
    })))
    .sort((a, b) => b.score - a.score)[0]?.placed ?? null;
}

function uniqueSizes(sizes: { width: number; depth: number }[]) {
  const seen = new Set<string>();
  return sizes.filter(size => {
    const key = `${size.width.toFixed(2)}x${size.depth.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return size.width > 0 && size.depth > 0;
  });
}

function servicePlacementAttempts(plan: FloorPlan, fixedRooms: Room[], serviceRoom: Room, targetRoom: Room, sizes: { width: number; depth: number }[]) {
  const attempts: Room[] = [];
  sizes.forEach(size => {
    const verticalY = uniqueNumbers([
      targetRoom.y,
      targetRoom.y + targetRoom.depth - size.depth,
      targetRoom.y + targetRoom.depth / 2 - size.depth / 2,
    ]).map(value => clamp(value, 0, plan.depth - size.depth));
    const horizontalX = uniqueNumbers([
      targetRoom.x,
      targetRoom.x + targetRoom.width - size.width,
      targetRoom.x + targetRoom.width / 2 - size.width / 2,
    ]).map(value => clamp(value, 0, plan.width - size.width));

    verticalY.forEach(y => {
      attempts.push({ ...serviceRoom, x: targetRoom.x - size.width, y, width: size.width, depth: size.depth });
      attempts.push({ ...serviceRoom, x: targetRoom.x + targetRoom.width, y, width: size.width, depth: size.depth });
    });
    horizontalX.forEach(x => {
      attempts.push({ ...serviceRoom, x, y: targetRoom.y - size.depth, width: size.width, depth: size.depth });
      attempts.push({ ...serviceRoom, x, y: targetRoom.y + targetRoom.depth, width: size.width, depth: size.depth });
    });
  });

  return attempts.filter(attempt =>
    roomInsidePlan(attempt, plan) &&
    !fixedRooms.some(other => roomsOverlap(attempt, other)) &&
    !!sharedWall(attempt, targetRoom)
  );
}

function servicePlacementScore(plan: FloorPlan, original: Room, targetRoom: Room, placed: Room) {
  const targetScore = targetRoom.type === "kitchen" ? 80 : isAccessRoom(targetRoom) ? 65 : 45;
  const exteriorScore = exteriorWall(placed, plan) ? 3 : 0;
  const distancePenalty = Math.abs(original.x - placed.x) + Math.abs(original.y - placed.y);
  return targetScore - distancePenalty * 0.05 + exteriorScore;
}

function roomInsidePlan(item: Room, plan: FloorPlan) {
  return item.x >= -0.01 && item.y >= -0.01 && item.x + item.width <= plan.width + 0.01 && item.y + item.depth <= plan.depth + 0.01;
}

function roomsOverlap(a: Room, b: Room) {
  return a.x < b.x + b.width - 0.02 && a.x + a.width > b.x + 0.02 && a.y < b.y + b.depth - 0.02 && a.y + a.depth > b.y + 0.02;
}

function uniqueNumbers(values: number[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return Number.isFinite(value);
  });
}

export function selectBestGroundFloorPlan(brief: Brief, baseline: FloorPlan, alternatives: FloorPlan[]) {
  return selectBestGroundFloorCandidate(
    brief,
    { label: "Baseline", source: "baseline", plan: baseline },
    alternatives.map((plan, index) => ({ label: `Alternative ${index + 1}`, source: "experimental", plan })),
  ).plan;
}

function selectBestGroundFloorCandidate(brief: Brief, baseline: PlanCandidate, alternatives: PlanCandidate[]): { plan: FloorPlan; trace: GenerationTrace } {
  const baselineChoice = planChoiceScore(brief, baseline.plan);
  const choices = alternatives.map(candidate => ({ candidate, ...planChoiceScore(brief, candidate.plan) }));
  const validChoices = choices.filter(choice => choice.errors.length === 0);
  let selected = baseline;

  if (baselineChoice.errors.length === 0) {
    const better = validChoices
      .filter(choice => choice.score >= baselineChoice.score + 6)
      .sort((a, b) => b.score - a.score)[0];
    selected = better?.candidate ?? baseline;
  } else {
    const valid = validChoices.sort((a, b) => b.score - a.score)[0];
    selected = valid?.candidate ?? choices
      .filter(choice => choice.errors.length < baselineChoice.errors.length || (choice.errors.length === baselineChoice.errors.length && choice.score > baselineChoice.score))
      .sort((a, b) => a.errors.length - b.errors.length || b.score - a.score)[0]?.candidate ?? baseline;
  }

  const allTraceChoices = [
    { candidate: baseline, ...baselineChoice },
    ...choices,
  ];
  const trace: GenerationTrace = {
    selectedLabel: selected.label,
    candidates: allTraceChoices.map(choice => ({
      label: choice.candidate.label,
      source: choice.candidate.source,
      score: choice.score,
      valid: choice.errors.length === 0,
      selected: choice.candidate === selected,
      errors: choice.errors.slice(0, 4),
      warnings: evaluateArchitecture(brief, choice.candidate.plan).warnings.slice(0, 4),
    })),
  };

  logGenerationTrace(brief, trace);
  return { plan: selected.plan, trace };
}

function logGenerationTrace(brief: Brief, trace: GenerationTrace) {
  if (typeof window !== "undefined") return;
  console.info(`[layout-engine] ${brief.plotWidth}x${brief.plotDepth} ${brief.roadSide}-road selected: ${trace.selectedLabel}`);
  trace.candidates.forEach(candidate => {
    console.info(`[layout-engine] ${candidate.selected ? "WIN" : candidate.valid ? "OK " : "BAD"} score=${candidate.score} ${candidate.label}${candidate.errors.length ? ` | ${candidate.errors.join(" ")}` : ""}`);
  });
}

function makeCompactTwoBedroomOpenPlan(brief: Brief, level: number, roadSide: "north" | "south"): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const hasStairs = brief.features.includes("internal_staircase");
  const porchD = hasStairs ? target(brief, 9, 9.5, 10, D * 0.26) : target(brief, 6, 8, 10, D * 0.24);
  const leftW = target(brief, 10, 12, 13, W * 0.43);
  const centerW = target(brief, 7.5, 8, 9, W - leftW - feet(brief, 9.5));
  const rightW = W - leftW - centerW;
  const kitchenD = target(brief, 9, 10.5, 12, D * 0.3);
  const bathD = target(brief, 7, 7, 7.5, kitchenD);
  const frontY = D - porchD;
  const bedroomD = (frontY - bathD) / 2;
  const bathW = Math.min(feet(brief, 6.5), leftW * 0.52);
  const rooms: Room[] = [];

  rooms.push(room(level, "Common bath", "bathroom", 0, 0, bathW, bathD));
  rooms.push(room(level, "Service passage", "hallway", bathW, 0, leftW - bathW, bathD));
  rooms.push(room(level, "Kitchen", "kitchen", leftW, 0, centerW + rightW, kitchenD));
  rooms.push(room(level, "Bedroom 1", "bedroom", 0, bathD, leftW, bedroomD));
  rooms.push(room(level, "Bedroom 2", "bedroom", 0, bathD + bedroomD, leftW, bedroomD));
  rooms.push(room(level, "Front foyer", "foyer", 0, frontY, leftW, porchD));
  rooms.push(room(level, "Open dining area", "dining", leftW, kitchenD, centerW, frontY - kitchenD));
  rooms.push({ ...room(level, "Living area", "living", leftW + centerW, kitchenD, rightW, frontY - kitchenD), ...(wantsRoundedLiving(brief) ? { shape: "rounded" as const, curveSide: "east" as const } : {}) });
  rooms.push(room(level, hasStairs ? "Internal stairs" : "Entry passage", hasStairs ? "stairs" : "hallway", leftW, frontY, centerW, porchD));
  rooms.push(room(level, "Porch", "porch", leftW + centerW, frontY, rightW, porchD));

  const oriented = roadSide === "north" ? rooms.map(r => ({ ...r, y: D - r.y - r.depth })) : rooms;
  return makeFloorPlan(brief, level, oriented);
}

function makeCompactThreeBedroomPlan(brief: Brief, level: number, roadSide: "north" | "south"): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const hallW = clamp(W * 0.13, feet(brief, 3.5), feet(brief, 4.5));
  const hallX = clamp(W * 0.48, feet(brief, 11), W - hallW - feet(brief, 9));
  const leftW = hallX;
  const rightW = W - hallX - hallW;
  const publicD = clamp(D * 0.34, feet(brief, 13), feet(brief, 16));
  const frontY = D - publicD;
  const backD = D - publicD;
  const bathD = clamp(D * 0.18, feet(brief, 7), feet(brief, 8.5));
  const bathW = Math.min(rightW, feet(brief, 6.5));
  const hasLaundry = brief.features.includes("utility") || brief.features.includes("laundry");
  const laundryD = hasLaundry ? clamp(D * 0.12, feet(brief, 5), feet(brief, 6.5)) : 0;
  const rightBedroomD = backD - bathD * Math.min(2, brief.bathrooms) - laundryD;
  const leftBedroomD = backD / 2;
  const rooms: Room[] = [];

  rooms.push(room(level, "Central hallway", "hallway", hallX, 0, hallW, D));
  rooms.push(room(level, "Living room", "living", 0, frontY, leftW, publicD));
  if (brief.kitchens) rooms.push(room(level, "Kitchen", "kitchen", hallX + hallW, frontY, rightW, brief.diningRooms ? publicD * 0.58 : publicD));
  if (brief.diningRooms) rooms.push(room(level, "Dining area", "dining", hallX + hallW, frontY + publicD * 0.58, rightW, publicD * 0.42));
  rooms.push(room(level, "Bedroom 1", "bedroom", 0, 0, leftW, leftBedroomD));
  rooms.push(room(level, "Bedroom 2", "bedroom", 0, leftBedroomD, leftW, leftBedroomD));
  rooms.push(room(level, "Bedroom 3", "bedroom", hallX + hallW, 0, rightW, Math.max(feet(brief, 10), rightBedroomD)));
  if (brief.bathrooms >= 1) {
    const bathY = Math.max(feet(brief, 10), rightBedroomD);
    rooms.push(room(level, "Bathroom 1", "bathroom", hallX + hallW, bathY, bathW, bathD));
    if (rightW - bathW >= feet(brief, 3)) rooms.push(room(level, "Bath linen 1", "storage", hallX + hallW + bathW, bathY, rightW - bathW, bathD));
  }
  const wetTop = Math.max(feet(brief, 10), rightBedroomD) + bathD;
  const wetH = frontY - wetTop;
  if (brief.bathrooms >= 2 && hasLaundry && wetH >= feet(brief, 4)) {
    const wetRoomH = Math.min(wetH, feet(brief, 8.5));
    const halfBathW = Math.min(rightW * 0.48, feet(brief, 6.5));
    rooms.push(room(level, "Half bath", "bathroom", hallX + hallW, wetTop, halfBathW, wetRoomH));
    rooms.push(room(level, "Laundry", "laundry", hallX + hallW + halfBathW, wetTop, rightW - halfBathW, wetRoomH));
    if (wetH - wetRoomH >= feet(brief, 3.5)) rooms.push(room(level, "Service pocket", "storage", hallX + hallW, wetTop + wetRoomH, rightW, wetH - wetRoomH));
  } else {
    if (brief.bathrooms >= 2 && wetH >= feet(brief, 4)) rooms.push(room(level, "Half bath", "bathroom", hallX + hallW, wetTop, Math.min(rightW, feet(brief, 6.5)), Math.min(wetH, feet(brief, 8.5))));
    if (hasLaundry) rooms.push(room(level, "Laundry", "laundry", hallX + hallW, frontY - laundryD, rightW, laundryD));
  }

  const oriented = roadSide === "north" ? rooms.map(r => ({ ...r, y: D - r.y - r.depth })) : rooms;
  return makeFloorPlan(brief, level, oriented);
}

function makeEastWestPlan(brief: Brief, level: number, roadSide: "east" | "west"): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const hallW = clamp(W * 0.1, feet(brief, 3.5), feet(brief, 5));
  const leftW = clamp(W * 0.5, feet(brief, 15), W - hallW - feet(brief, 11));
  const rightW = W - leftW - hallW;
  const topH = clamp(D * 0.25, feet(brief, 13), feet(brief, 17));
  const foyerH = clamp(D * 0.11, feet(brief, 6), feet(brief, 8));
  const garageH = brief.features.includes("garage") ? clamp(D * 0.27, feet(brief, 15), feet(brief, 21)) : 0;
  const supportH = (brief.features.includes("utility") || brief.features.includes("laundry")) ? clamp(D * 0.12, feet(brief, 6), feet(brief, 8)) : 0;
  const privateTop = topH + foyerH;
  const privateBottom = D - supportH;
  const bathW = brief.bathrooms ? clamp(leftW * 0.32, feet(brief, 5.5), feet(brief, 7)) : 0;
  const bedW = leftW - bathW;
  const bedroomRows = Math.max(1, Math.min(brief.bedrooms, Math.floor((privateBottom - privateTop) / feet(brief, 8))));
  const bedH = bedroomRows ? (privateBottom - privateTop) / bedroomRows : 0;
  const bathH = brief.bathrooms ? clamp(bedH * 0.58, feet(brief, 7), feet(brief, 8.5)) : 0;
  const rooms: Room[] = [];

  rooms.push(room(level, "Central hallway", "hallway", leftW, 0, hallW, D));
  if (brief.livingRooms) rooms.push(room(level, brief.livingRooms > 1 ? "Great room 1" : "Great room", "living", leftW + hallW, 0, rightW, topH));
  if (brief.kitchens && brief.diningRooms) {
    rooms.push(room(level, "Kitchen", "kitchen", 0, 0, leftW * 0.48, topH));
    rooms.push(room(level, "Dining area", "dining", leftW * 0.48, 0, leftW * 0.52, topH));
  } else if (brief.kitchens) {
    rooms.push(room(level, "Kitchen", "kitchen", 0, 0, leftW, topH));
  } else if (brief.diningRooms) {
    rooms.push(room(level, "Dining area", "dining", 0, 0, leftW, topH));
  }
  const serviceW = clamp(leftW * 0.52, feet(brief, 9), feet(brief, 11));
  rooms.push(room(level, brief.features.includes("pantry") ? "Pantry" : "Service lobby", brief.features.includes("pantry") ? "pantry" : "hallway", leftW - serviceW, topH, serviceW, foyerH));
  if (leftW - serviceW >= feet(brief, 7)) rooms.push(room(level, "Store", "storage", 0, topH, leftW - serviceW, foyerH));
  rooms.push(room(level, "Foyer", "foyer", leftW + hallW, topH, rightW, foyerH));

  const stairTop = topH + foyerH;
  const stairH = clamp(D * 0.18, feet(brief, 10), feet(brief, 13));
  if (brief.features.includes("internal_staircase")) rooms.push(room(level, "Internal stairs", "stairs", leftW + hallW, stairTop, rightW, Math.min(stairH, Math.max(feet(brief, 6), D - garageH - stairTop))));
  const lobbyTop = stairTop + (brief.features.includes("internal_staircase") ? Math.min(stairH, Math.max(feet(brief, 6), D - garageH - stairTop)) : 0);
  const lobbyH = D - garageH - lobbyTop;
  if (lobbyH >= feet(brief, 4)) {
    const requestedStudy = brief.features.includes("study") && lobbyH >= feet(brief, 8);
    if (wantsGarageLobbyReplacement(brief, "dining")) {
      rooms.push(room(level, "Dining extension", "dining", leftW + hallW, lobbyTop, rightW, lobbyH));
    } else if (wantsGarageLobbyReplacement(brief, "pantry")) {
      rooms.push(room(level, "Pantry", "pantry", leftW + hallW, lobbyTop, rightW, lobbyH));
    } else if (wantsNoGarageLobby(brief)) {
      rooms.push(room(level, "Storage", "storage", leftW + hallW, lobbyTop, rightW, lobbyH));
    } else {
      rooms.push(room(level, requestedStudy ? "Study" : brief.features.includes("garage") ? "Mudroom / garage lobby" : "Service pocket", requestedStudy ? "study" : "storage", leftW + hallW, lobbyTop, rightW, lobbyH));
    }
  }
  if (brief.features.includes("garage")) rooms.push(room(level, "Garage", "garage", leftW + hallW, D - garageH, rightW, garageH));

  for (let i = 0; i < bedroomRows; i++) {
    const y = privateTop + i * bedH;
    if (i < brief.bedrooms) rooms.push(room(level, `Bedroom ${i + 1}`, "bedroom", 0, y, bedW || leftW, bedH));
    if (i < brief.bathrooms) {
      const entryH = Math.min(feet(brief, 4.5), Math.max(feet(brief, 3.5), bedH - bathH));
      rooms.push(room(level, i === 0 && wantsAttachedBath(brief) ? "Attached bath" : `Bathroom ${i + 1}`, "bathroom", bedW, y, bathW, bathH));
      if (i === 0) {
        const closetH = bedH - bathH;
        if (closetH >= feet(brief, 3)) rooms.push(room(level, "Wardrobe niche", "storage", bedW, y + bathH, bathW, closetH));
      } else {
        const closetH = bedH - bathH - entryH;
        if (closetH >= feet(brief, 3)) rooms.push(room(level, `Linen ${i + 1}`, "storage", bedW, y + bathH, bathW, closetH));
        if (entryH >= feet(brief, 3)) rooms.push(room(level, `Bedroom ${i + 1} entry`, "hallway", bedW, y + bedH - entryH, bathW, entryH));
      }
    }
  }

  if (brief.features.includes("utility")) rooms.push(room(level, "Utility", "utility", 0, D - supportH, clamp(leftW * 0.48, feet(brief, 8), feet(brief, 10)), supportH));
  if (brief.features.includes("laundry")) rooms.push(room(level, "Laundry", "laundry", leftW * 0.58, D - supportH, leftW * 0.42, supportH));

  const placed = roadSide === "east" ? rooms : rooms.map(r => ({ ...r, x: W - r.x - r.width }));
  return makeFloorPlan(brief, level, placed);
}

function makeNorthSouthPlan(brief: Brief, level: number, roadSide: "north" | "south"): FloorPlan {
  const W = brief.plotWidth, D = brief.plotDepth;
  const hallD = clamp(D * 0.09, feet(brief, 3.5), feet(brief, 4.5));
  const frontD = clamp(D * 0.27, feet(brief, 12), feet(brief, 15));
  const serviceD = (brief.features.includes("utility") || brief.features.includes("laundry")) ? clamp(D * 0.18, brief.kitchens || brief.diningRooms ? feet(brief, 10) : feet(brief, 7), feet(brief, 12)) : 0;
  const privateD = D - frontD - hallD - serviceD;
  const publicW = clamp(W * 0.58, feet(brief, 16), W - feet(brief, 9));
  const foyerW = W - publicW;
  const bathW = brief.bathrooms ? clamp(W * 0.22, feet(brief, 5.5), feet(brief, 7)) : 0;
  const bedW = (W - bathW) / 2;
  const bathD = brief.bathrooms ? clamp(privateD * 0.45, feet(brief, 7), feet(brief, 8.5)) : 0;
  const serviceW = brief.features.includes("garage") ? clamp(W * 0.44, feet(brief, 12), feet(brief, 16)) : 0;
  const rooms: Room[] = [];

  rooms.push(room(level, "Foyer", "foyer", publicW, 0, foyerW, frontD));
  if (brief.livingRooms) rooms.push(room(level, brief.livingRooms > 1 ? "Great room 1" : "Great room", "living", 0, 0, publicW, frontD));
  rooms.push(room(level, "Central hallway", "hallway", 0, frontD, W, hallD));

  const privateTop = frontD + hallD;
  const bedroomCount = Math.min(brief.bedrooms, 2);
  if (bedroomCount >= 1) rooms.push(room(level, "Bedroom 1", "bedroom", 0, privateTop, bedW, privateD));
  if (bedroomCount >= 2) rooms.push(room(level, "Bedroom 2", "bedroom", bedW, privateTop, bedW, privateD));
  if (brief.bathrooms >= 1) {
    rooms.push(room(level, wantsAttachedBath(brief) ? "Attached bath" : "Bathroom 1", "bathroom", bedW * 2, privateTop, bathW, bathD));
    if (brief.bathrooms >= 2) rooms.push(room(level, "Bathroom 2", "bathroom", bedW * 2, privateTop + bathD, bathW, bathD));
    const usedBathD = brief.bathrooms >= 2 ? bathD * 2 : bathD;
    const storageD = privateD - usedBathD;
    if (storageD >= feet(brief, 4)) rooms.push(room(level, "Wardrobe niche", "storage", bedW * 2, privateTop + usedBathD, bathW, storageD));
  }

  const serviceTop = frontD + hallD + privateD;
  if (serviceD > 0) {
    const leftServiceW = serviceW ? W - serviceW : W;
    const utilityW = brief.features.includes("utility") ? clamp(leftServiceW * 0.3, feet(brief, 7), feet(brief, 9)) : 0;
    const kitchenDiningW = leftServiceW - utilityW;
    if (brief.kitchens) rooms.push(room(level, "Kitchen", "kitchen", 0, serviceTop, kitchenDiningW * 0.48, serviceD));
    if (brief.diningRooms) rooms.push(room(level, "Dining area", "dining", kitchenDiningW * 0.48, serviceTop, kitchenDiningW * 0.52, serviceD));
    if (brief.features.includes("utility")) rooms.push(room(level, "Utility", "utility", kitchenDiningW, serviceTop, utilityW, serviceD));
    if (brief.features.includes("garage")) rooms.push(room(level, "Garage", "garage", W - serviceW, serviceTop, serviceW, serviceD));
  } else {
    const backTop = frontD + hallD + privateD;
    if (brief.kitchens) rooms.push(room(level, "Kitchen", "kitchen", 0, backTop, W * 0.48, D - backTop));
    if (brief.diningRooms) rooms.push(room(level, "Dining area", "dining", W * 0.48, backTop, W * 0.52, D - backTop));
  }
  if (brief.features.includes("internal_staircase") && privateD >= feet(brief, 11)) rooms.push(room(level, "Internal stairs", "stairs", W - clamp(W * 0.25, feet(brief, 7), feet(brief, 9)), privateTop, clamp(W * 0.25, feet(brief, 7), feet(brief, 9)), clamp(privateD * 0.45, feet(brief, 10), feet(brief, 13))));

  const placed = roadSide === "south" ? rooms : rooms.map(r => ({ ...r, y: D - r.y - r.depth }));
  return makeFloorPlan(brief, level, placed);
}

function makeFloorPlan(brief: Brief, level: number, rooms: Room[]): FloorPlan {
  const planRooms = fillUnassignedPlanAreas(brief, level, applyGeneratedRoomIntent(brief, addBalconyIfRequested(brief, level, rooms)));
  const plan = { id: `floor-${level}-${uid()}`, level, elevation: level * (brief.unit === "feet" ? 10 : 3.05), width: brief.plotWidth, depth: brief.plotDepth, unit: brief.unit, facing: brief.facing, roadSide: brief.roadSide, rooms: planRooms, openings: [] as Opening[] };
  plan.openings = generateOpenings(plan, brief);
  return plan;
}

function fillUnassignedPlanAreas(brief: Brief, level: number, rooms: Room[]) {
  const minPocket = feet(brief, 3);
  const minUsefulArea = feet(brief, 18);
  const xs = sortedBreakpoints([0, brief.plotWidth, ...rooms.flatMap(item => [item.x, item.x + item.width])], brief.plotWidth);
  const ys = sortedBreakpoints([0, brief.plotDepth, ...rooms.flatMap(item => [item.y, item.y + item.depth])], brief.plotDepth);
  const used = Array.from({ length: ys.length - 1 }, () => Array.from({ length: xs.length - 1 }, () => false));

  for (let rowIndex = 0; rowIndex < ys.length - 1; rowIndex += 1) {
    for (let colIndex = 0; colIndex < xs.length - 1; colIndex += 1) {
      const x1 = xs[colIndex];
      const x2 = xs[colIndex + 1];
      const y1 = ys[rowIndex];
      const y2 = ys[rowIndex + 1];
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      used[rowIndex][colIndex] = rooms.some(item => cx > item.x + 0.01 && cx < item.x + item.width - 0.01 && cy > item.y + 0.01 && cy < item.y + item.depth - 0.01);
    }
  }

  const fillers: Room[] = [];
  for (let rowIndex = 0; rowIndex < ys.length - 1; rowIndex += 1) {
    for (let colIndex = 0; colIndex < xs.length - 1; colIndex += 1) {
      if (used[rowIndex][colIndex]) continue;
      let endCol = colIndex;
      while (endCol < xs.length - 1 && !used[rowIndex][endCol]) endCol += 1;
      let endRow = rowIndex + 1;
      while (endRow < ys.length - 1) {
        const clear = Array.from({ length: endCol - colIndex }, (_, index) => colIndex + index).every(nextCol => !used[endRow][nextCol]);
        if (!clear) break;
        endRow += 1;
      }
      for (let r = rowIndex; r < endRow; r += 1) {
        for (let c = colIndex; c < endCol; c += 1) used[r][c] = true;
      }
      const x = xs[colIndex];
      const y = ys[rowIndex];
      const width = xs[endCol] - x;
      const depth = ys[endRow] - y;
      if (width < minPocket || depth < minPocket || width * depth < minUsefulArea) continue;
      fillers.push(makeVoidFillerRoom(brief, level, rooms, fillers, x, y, width, depth));
    }
  }

  return [...rooms, ...mergeCompatibleFillers(fillers)];
}

function sortedBreakpoints(values: number[], max: number) {
  return [...new Set(values
    .map(value => clamp(value, 0, max))
    .filter(value => Number.isFinite(value))
    .map(value => Number(value.toFixed(2))))]
    .sort((a, b) => a - b)
    .filter((value, index, all) => index === 0 || value - all[index - 1] > 0.05);
}

function makeVoidFillerRoom(brief: Brief, level: number, rooms: Room[], previousFillers: Room[], x: number, y: number, width: number, depth: number): Room {
  const planBox = { width: brief.plotWidth, depth: brief.plotDepth } as FloorPlan;
  const area = width * depth;
  const allRooms = [...rooms, ...previousFillers];
  const touchesAccess = allRooms.some(item => isAccessRoom(item) && sharedWall({ x, y, width, depth } as Room, item));
  const touchesService = allRooms.some(item => ["kitchen", "utility", "laundry", "pantry", "bathroom"].includes(item.type) && sharedWall({ x, y, width, depth } as Room, item));
  const exterior = ["north", "east", "south", "west"].some(side => touchesExteriorWall({ x, y, width, depth } as Room, planBox, side as Opening["wall"]));
  const bigEnoughForLounge = Math.min(width, depth) >= feet(brief, 7) && area >= feet(brief, 80);
  const canBeOpen = Math.min(width, depth) >= feet(brief, 4);
  const type: RoomType = bigEnoughForLounge || (touchesAccess && canBeOpen) || (exterior && level > 0 && canBeOpen) ? "open" : touchesAccess && Math.min(width, depth) >= feet(brief, 3.5) ? "hallway" : "storage";
  const label = type === "open"
    ? level > 0 && exterior ? "Open terrace lounge" : touchesAccess ? "Open circulation lounge" : "Open lounge"
    : type === "hallway" ? "Access pocket" : touchesService ? "Service pocket" : "Storage pocket";
  return room(level, label, type, x, y, width, depth);
}

function mergeCompatibleFillers(fillers: Room[]) {
  const merged: Room[] = [];
  fillers.forEach(filler => {
    const previous = merged.find(item =>
      item.type === filler.type &&
      item.name === filler.name &&
      nearly(item.x, filler.x) &&
      nearly(item.width, filler.width) &&
      (nearly(item.y + item.depth, filler.y) || nearly(filler.y + filler.depth, item.y))
    );
    if (previous) {
      const y = Math.min(previous.y, filler.y);
      previous.depth = Math.max(previous.y + previous.depth, filler.y + filler.depth) - y;
      previous.y = y;
      return;
    }
    merged.push(filler);
  });
  return merged;
}

function addBalconyIfRequested(brief: Brief, level: number, rooms: Room[]) {
  if (!brief.features.includes("balcony") || rooms.some(item => item.type === "balcony")) return rooms;
  const porch = rooms.find(item => item.type === "porch");
  if (porch) return rooms.map(item => item.id === porch.id ? { ...item, name: "Balcony", type: "balcony" as RoomType, color: ROOM_COLORS.balcony } : item);

  const side = brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing !== "unspecified" ? brief.facing : "south";
  const balconyDepth = feet(brief, 5.5);
  const candidate = rooms
    .filter(item => ["living", "bedroom", "foyer", "study", "dining", "hallway", "open"].includes(item.type) && touchesExteriorWall(item, { width: brief.plotWidth, depth: brief.plotDepth } as FloorPlan, side))
    .find(item => {
      const rule = roomRule(item.type);
      const minShort = feet(brief, Math.min(rule.minWidth, rule.minDepth));
      const minLong = feet(brief, Math.max(rule.minWidth, rule.minDepth));
      const nextWidth = side === "east" || side === "west" ? item.width - balconyDepth : item.width;
      const nextDepth = side === "north" || side === "south" ? item.depth - balconyDepth : item.depth;
      return Math.min(nextWidth, nextDepth) >= minShort && Math.max(nextWidth, nextDepth) >= minLong;
    });
  if (!candidate) return rooms;

  const nextRooms = rooms.map(item => {
    if (item.id !== candidate.id) return item;
    if (side === "east") return { ...item, width: item.width - balconyDepth };
    if (side === "west") return { ...item, x: item.x + balconyDepth, width: item.width - balconyDepth };
    if (side === "north") return { ...item, y: item.y + balconyDepth, depth: item.depth - balconyDepth };
    return { ...item, depth: item.depth - balconyDepth };
  });
  const balcony: Room = side === "east"
    ? room(level, "Balcony", "balcony", candidate.x + candidate.width - balconyDepth, candidate.y, balconyDepth, candidate.depth)
    : side === "west"
      ? room(level, "Balcony", "balcony", candidate.x, candidate.y, balconyDepth, candidate.depth)
      : side === "north"
        ? room(level, "Balcony", "balcony", candidate.x, candidate.y, candidate.width, balconyDepth)
        : room(level, "Balcony", "balcony", candidate.x, candidate.y + candidate.depth - balconyDepth, candidate.width, balconyDepth);
  return [...nextRooms, balcony];
}

function applyGeneratedRoomIntent(brief: Brief, rooms: Room[]) {
  if (!wantsNoGarageLobby(brief)) return rooms;
  return rooms.map(item => {
    if (!/\b(garage lobby|mudroom|mud room)\b/i.test(item.name)) return item;
    if (wantsGarageLobbyReplacement(brief, "dining")) return { ...item, name: "Dining extension", type: "dining" as RoomType, color: ROOM_COLORS.dining };
    if (wantsGarageLobbyReplacement(brief, "pantry")) return { ...item, name: "Pantry", type: "pantry" as RoomType, color: ROOM_COLORS.pantry };
    return { ...item, name: "Storage", type: "storage" as RoomType, color: ROOM_COLORS.storage };
  });
}

function generateOpenings(plan: FloorPlan, brief: Brief): Opening[] {
  const roadSide = brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing;
  const doorWidth = feet(brief, 3);
  const openings: Opening[] = [];

  plan.rooms.forEach(r => {
    if (isMainEntryRoom(r) && roadSide !== "unspecified" && touchesExteriorWall(r, plan, roadSide)) openings.push({ id: `main-door-${r.id}`, kind: "door", wall: roadSide, roomId: r.id, offset: 0.5, width: Math.min(doorWidth, roadSide === "north" || roadSide === "south" ? r.width * 0.8 : r.depth * 0.8) });
    if (r.type === "garage" && roadSide !== "unspecified") openings.push({ id: `garage-door-${r.id}`, kind: "door", wall: roadSide, roomId: r.id, offset: 0.5, width: Math.min(feet(brief, 9), roadSide === "north" || roadSide === "south" ? r.width * 0.7 : r.depth * 0.7) });
    const directBedroomBath = r.type === "bathroom" && r.name.toLowerCase().includes("attached")
      ? plan.rooms.find(other => other.type === "bedroom" && other.name === "Bedroom 1" && sharedWall(r, other))
      : null;
    const accessRoom = directBedroomBath ?? pickDoorTarget(r, plan, brief, openings);
    const doorWall = accessRoom ? sharedWall(r, accessRoom) : null;
    if (doorWall && accessRoom && !isDoorlessCirculation(r)) {
      const width = interiorDoorWidth(brief, r, accessRoom, doorWall, doorWidth);
      openings.push({ id: `door-${r.id}`, kind: "door", wall: doorWall, roomId: r.id, offset: doorOffset(r, accessRoom, doorWall, width), width });
    }
    if (r.type === "stairs") {
      plan.rooms.filter(other => other.id !== r.id && other.id !== accessRoom?.id && isDoorTarget(r, other) && sharedWall(r, other)).forEach((target, index) => {
        const wall = sharedWall(r, target);
        if (!wall) return;
        const width = interiorDoorWidth(brief, r, target, wall, doorWidth);
        openings.push({ id: `door-${r.id}-${index + 2}`, kind: "door", wall, roomId: r.id, offset: doorOffset(r, target, wall, width), width });
      });
    }
    const exterior = exteriorWall(r, plan);
    if (exterior && !["hallway", "foyer", "stairs", "garage", "porch", "balcony", "open"].includes(r.type)) openings.push({ id: `window-${r.id}`, kind: "window", wall: exterior, roomId: r.id, offset: 0.5, width: Math.min(feet(brief, 5), exterior === "north" || exterior === "south" ? r.width * 0.55 : r.depth * 0.55) });
    if (!exterior && needsWetVentilation(r)) {
      const ventWall = ventWallForRoom(r, plan);
      openings.push({ id: `vent-${r.id}`, kind: "vent", wall: ventWall, roomId: r.id, offset: 0.5, width: Math.min(feet(brief, 2), ventWall === "north" || ventWall === "south" ? r.width * 0.45 : r.depth * 0.45) });
    }
  });

  plan.rooms.forEach((room, index) => {
    if (!isAccessRoom(room)) return;
    plan.rooms.slice(index + 1).forEach(target => {
      if (!isAccessRoom(target)) return;
      const wall = sharedWall(room, target);
      if (!wall) return;
      const width = Math.min(feet(brief, 4), wall === "north" || wall === "south" ? room.width * 0.55 : room.depth * 0.55);
      openings.push({ id: `passage-${room.id}-${target.id}`, kind: "door", wall, roomId: room.id, offset: doorOffset(room, target, wall, width), width });
    });
  });

  return ensureRequiredAccessOpenings(plan, brief, openings);
}

function isAccessRoom(room: Room) {
  const name = room.name.toLowerCase();
  return ["hallway", "foyer", "porch", "open"].includes(room.type) || name.includes("open dining") || name.includes("lobby") || name.includes("passage");
}

function isDoorTarget(room: Room, target: Room) {
  if (isAccessRoom(target)) return true;
  if (room.type === "garage" && target.type === "storage") return true;
  return [
    "balcony:living", "living:balcony",
    "balcony:bedroom", "bedroom:balcony",
    "balcony:hallway", "hallway:balcony",
    "balcony:foyer", "foyer:balcony",
    "balcony:open", "open:balcony",
    "utility:kitchen", "utility:bathroom",
    "laundry:kitchen", "laundry:bathroom",
    "pantry:kitchen",
    "storage:hallway", "storage:bathroom", "storage:bedroom", "storage:kitchen", "storage:utility", "storage:laundry", "storage:pantry",
    "bathroom:storage", "utility:storage", "laundry:storage", "pantry:storage",
    "kitchen:dining",
    "dining:kitchen",
  ].includes(`${room.type}:${target.type}`);
}

function sharedOverlap(room: Room, target: Room, wall: Opening["wall"]) {
  return wall === "north" || wall === "south"
    ? overlap(room.x, room.x + room.width, target.x, target.x + target.width)
    : overlap(room.y, room.y + room.depth, target.y, target.y + target.depth);
}

function interiorDoorWidth(brief: Brief, room: Room, target: Room, wall: Opening["wall"], defaultWidth = feet(brief, 3)) {
  const wallLength = wall === "north" || wall === "south" ? room.width : room.depth;
  const shared = Math.max(0, sharedOverlap(room, target, wall));
  const isBalconyDoor = room.type === "balcony" || target.type === "balcony";
  const desired = isBalconyDoor ? feet(brief, 6) : defaultWidth;
  const maxWidth = Math.max(feet(brief, 2.6), Math.min(wallLength * 0.86, shared * 0.9));
  return Math.min(desired, maxWidth);
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
  return plan.rooms.filter(room => room.id !== owner.id && sharedWall(owner, room) === opening.wall).find(room => {
    const targetStart = span.horizontal ? room.x : room.y;
    const targetEnd = span.horizontal ? room.x + room.width : room.y + room.depth;
    return overlap(span.start, span.end, targetStart, targetEnd) > Math.min(feet({ unit: plan.unit } as Brief, 1), opening.width * 0.45);
  }) ?? null;
}

function hasDoorBetween(openings: Opening[], plan: FloorPlan, room: Room, target: Room) {
  return openings.some(opening => {
    if (opening.kind !== "door") return false;
    const owner = plan.rooms.find(candidate => candidate.id === opening.roomId);
    if (!owner) return false;
    const resolvedTarget = openingTargetRoom(plan, owner, opening);
    return (owner.id === room.id && resolvedTarget?.id === target.id) || (owner.id === target.id && resolvedTarget?.id === room.id);
  });
}

function doorTargetsForRoom(openings: Opening[], plan: FloorPlan, room: Room) {
  const targets: Room[] = [];
  openings.filter(opening => opening.kind === "door").forEach(opening => {
    const owner = plan.rooms.find(candidate => candidate.id === opening.roomId);
    if (!owner) return;
    const target = openingTargetRoom(plan, owner, opening);
    if (owner.id === room.id && target) targets.push(target);
    if (target?.id === room.id) targets.push(owner);
  });
  return targets;
}

function doorTargetScore(room: Room, target: Room) {
  const circulation = isAccessRoom(target);
  const attachedBath = room.type === "bathroom" && room.name.toLowerCase().includes("attached");
  if (attachedBath) {
    if (target.type === "bedroom" && target.name === "Bedroom 1") return 320;
    if (target.type === "bedroom") return 280;
    return -1;
  }
  if (room.type === "bedroom") return circulation ? 300 : -1;
  if (room.type === "bathroom") return circulation ? 290 : target.type === "storage" ? 90 : -1;
  if (room.type === "stairs") return circulation ? 280 : -1;
  if (room.type === "garage") return circulation ? 260 : ["utility", "storage", "living"].includes(target.type) ? 170 : -1;
  if (room.type === "utility" || room.type === "laundry") {
    if (target.type === "kitchen") return 260;
    if (circulation) return 240;
    if (target.type === "bathroom" || target.type === "storage") return 130;
  }
  if (room.type === "pantry") {
    if (target.type === "kitchen") return 280;
    if (circulation) return 220;
    if (target.type === "storage") return 120;
  }
  if (room.type === "storage") {
    if (circulation) return 260;
    if (["utility", "laundry", "pantry", "kitchen"].includes(target.type)) return 210;
    if (target.type === "bathroom") return 170;
    if (target.type === "bedroom") return 150;
  }
  if (room.type === "balcony") {
    if (["living", "open"].includes(target.type)) return 360;
    if (target.type === "bedroom") return 320;
    if (["hallway", "foyer"].includes(target.type)) return 260;
    if (circulation) return 220;
  }
  if (target.type === "balcony" && ["living", "open"].includes(room.type)) return 340;
  if (target.type === "balcony" && room.type === "bedroom") return 300;
  if (target.type === "balcony" && ["hallway", "foyer"].includes(room.type)) return 240;
  if ((room.type === "kitchen" && target.type === "dining") || (room.type === "dining" && target.type === "kitchen")) return 220;
  if (circulation) return 110;
  return isDoorTarget(room, target) ? 70 : -1;
}

function doorCandidates(room: Room, plan: FloorPlan, openings: Opening[]) {
  return plan.rooms
    .filter(target => target.id !== room.id)
    .map(target => ({ target, wall: sharedWall(room, target) }))
    .filter((candidate): candidate is { target: Room; wall: Opening["wall"] } => !!candidate.wall)
    .filter(candidate => (isDoorTarget(room, candidate.target) || isDoorTarget(candidate.target, room)) && !hasDoorBetween(openings, plan, room, candidate.target));
}

function pickDoorTarget(room: Room, plan: FloorPlan, _brief: Brief, openings: Opening[]) {
  return doorCandidates(room, plan, openings)
    .map(candidate => ({ ...candidate, score: Math.max(doorTargetScore(room, candidate.target), doorTargetScore(candidate.target, room) - 20) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || sharedOverlap(room, b.target, b.wall) - sharedOverlap(room, a.target, a.wall))[0]?.target ?? null;
}

function addDoorOpening(openings: Opening[], plan: FloorPlan, brief: Brief, room: Room, target: Room, reason: string) {
  if (hasDoorBetween(openings, plan, room, target)) return false;
  const wall = sharedWall(room, target);
  if (!wall) return false;
  const width = interiorDoorWidth(brief, room, target, wall, feet(brief, isAccessRoom(room) && isAccessRoom(target) ? 4 : 3));
  openings.push({ id: `door-${reason}-${room.id}-${target.id}`, kind: "door", wall, roomId: room.id, offset: doorOffset(room, target, wall, width), width });
  return true;
}

function roomHasRoadDoorFromOpenings(openings: Opening[], room: Room, plan: FloorPlan, brief: Brief) {
  const roadSide = brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing;
  return roadSide !== "unspecified" && touchesExteriorWall(room, plan, roadSide) && openings.some(opening => opening.kind === "door" && opening.roomId === room.id && opening.wall === roadSide);
}

function roomNeedsGeneratedAccess(room: Room) {
  return ["living", "kitchen", "bedroom", "bathroom", "dining", "garage", "stairs", "utility", "study", "pantry", "laundry", "storage", "balcony"].includes(room.type);
}

function buildReachability(plan: FloorPlan, brief: Brief, openings: Opening[]) {
  const graph = new Map<string, Set<string>>();
  plan.rooms.forEach(room => graph.set(room.id, new Set()));
  openings.filter(opening => opening.kind === "door").forEach(opening => {
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
      if (!sharedWall(a, b)) continue;
      if ((isAccessRoom(a) && isAccessRoom(b)) || (a.type === "kitchen" && b.type === "dining") || (a.type === "dining" && b.type === "kitchen")) {
        graph.get(a.id)?.add(b.id);
        graph.get(b.id)?.add(a.id);
      }
    }
  }

  const start = plan.rooms.find(room => isAccessRoom(room) && roomHasRoadDoorFromOpenings(openings, room, plan, brief)) ?? plan.rooms.find(room => room.type === "foyer") ?? plan.rooms.find(isAccessRoom);
  const reachable = new Set<string>();
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    graph.get(id)?.forEach(next => { if (!reachable.has(next)) queue.push(next); });
  }
  return reachable;
}

function ensureRequiredAccessOpenings(plan: FloorPlan, brief: Brief, openings: Opening[]) {
  const next = [...openings];
  plan.rooms.forEach(room => {
    const targets = doorTargetsForRoom(next, plan, room);
    const attachedBath = room.type === "bathroom" && room.name.toLowerCase().includes("attached");
    const hasRoadDoor = roomHasRoadDoorFromOpenings(next, room, plan, brief);
    const hasUsableDoor = targets.length > 0 || hasRoadDoor;
    const needsPriorityDoor =
      (attachedBath && !targets.some(target => target.type === "bedroom")) ||
      (room.type === "bedroom" && !targets.some(isAccessRoom)) ||
      (room.type === "bathroom" && !attachedBath && !targets.some(isAccessRoom)) ||
      (["stairs", "storage", "utility", "laundry", "pantry", "study"].includes(room.type) && !hasUsableDoor) ||
      (room.type === "balcony" && !hasUsableDoor) ||
      (room.type === "garage" && !targets.some(target => isAccessRoom(target) || ["utility", "storage", "living"].includes(target.type)));
    if (!needsPriorityDoor) return;
    const target = pickDoorTarget(room, plan, brief, next);
    if (target) addDoorOpening(next, plan, brief, room, target, "repair");
  });

  for (let guard = 0; guard < plan.rooms.length; guard++) {
    const reachable = buildReachability(plan, brief, next);
    const unreachable = plan.rooms.find(room => roomNeedsGeneratedAccess(room) && !reachable.has(room.id));
    if (!unreachable) break;
    const bridge = doorCandidates(unreachable, plan, next)
      .filter(candidate => reachable.has(candidate.target.id))
      .map(candidate => ({ ...candidate, score: Math.max(doorTargetScore(unreachable, candidate.target), doorTargetScore(candidate.target, unreachable) - 20) }))
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score || sharedOverlap(unreachable, b.target, b.wall) - sharedOverlap(unreachable, a.target, a.wall))[0];
    if (!bridge || !addDoorOpening(next, plan, brief, unreachable, bridge.target, "bridge")) break;
  }

  return next;
}

function isMainEntryRoom(room: Room) {
  return ["foyer", "porch", "open"].includes(room.type) || room.type === "hallway";
}

function isDoorlessCirculation(room: Room) {
  return isAccessRoom(room) && room.type !== "stairs";
}

function sharedWall(room: Room, target: Room): Opening["wall"] | null {
  if (nearly(room.x + room.width, target.x) && overlap(room.y, room.y + room.depth, target.y, target.y + target.depth) > 1) return "east";
  if (nearly(room.x, target.x + target.width) && overlap(room.y, room.y + room.depth, target.y, target.y + target.depth) > 1) return "west";
  if (nearly(room.y + room.depth, target.y) && overlap(room.x, room.x + room.width, target.x, target.x + target.width) > 1) return "south";
  if (nearly(room.y, target.y + target.depth) && overlap(room.x, room.x + room.width, target.x, target.x + target.width) > 1) return "north";
  return null;
}

function doorOffset(room: Room, target: Room, wall: Opening["wall"], width: number) {
  const horizontal = wall === "north" || wall === "south";
  const start = horizontal ? Math.max(room.x, target.x) : Math.max(room.y, target.y);
  const end = horizontal ? Math.min(room.x + room.width, target.x + target.width) : Math.min(room.y + room.depth, target.y + target.depth);
  const roomStart = horizontal ? room.x : room.y;
  const roomLength = horizontal ? room.width : room.depth;
  const usable = Math.max(0.01, roomLength - width);
  const centered = (start + end) / 2 - roomStart - width / 2;
  return clamp(centered / usable, 0.08, 0.92);
}

function ventWallForRoom(room: Room, plan: FloorPlan): Opening["wall"] {
  const preferred = (["north", "east", "south", "west"] as Opening["wall"][]).find(wall =>
    plan.rooms.some(other => other.id !== room.id && ["hallway", "storage", "open"].includes(other.type) && sharedWall(room, other) === wall));
  if (preferred) return preferred;
  return (["north", "east", "south", "west"] as Opening["wall"][]).find(wall =>
    plan.rooms.some(other => other.id !== room.id && sharedWall(room, other) === wall)) ?? "north";
}

function exteriorWall(room: Room, plan: FloorPlan): Opening["wall"] | null {
  if (nearly(room.y, 0)) return "north";
  if (nearly(room.x + room.width, plan.width)) return "east";
  if (nearly(room.y + room.depth, plan.depth)) return "south";
  if (nearly(room.x, 0)) return "west";
  return null;
}

function touchesExteriorWall(room: Room, plan: FloorPlan, wall: Opening["wall"]) {
  if (wall === "north") return nearly(room.y, 0);
  if (wall === "east") return nearly(room.x + room.width, plan.width);
  if (wall === "south") return nearly(room.y + room.depth, plan.depth);
  return nearly(room.x, 0);
}

export function validatePlans(plans: FloorPlan[]): string[] {
  const errors: string[] = [];
  plans.forEach(plan => {
    const briefLike: Brief = { title: "", prompt: "", floors: 1, plotWidth: plan.width, plotDepth: plan.depth, unit: plan.unit, bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0, diningRooms: 0, style: "", facing: plan.facing, roadSide: plan.roadSide, features: [], adjacency: [], warnings: [] };
    plan.rooms.forEach((room, i) => {
      if (!roomMeetsMinimum(room, briefLike)) errors.push(`${room.name} is smaller than the recommended minimum.`);
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
  const { plans, generationTrace } = generatePlansWithTrace(brief); const base = PRESETS[brief.style] || PRESETS.Modern;
  return { id: uid(), version: 1, state: "plan_editing", brief, plans, materials: Object.fromEntries(plans.flatMap(p => p.rooms.map(r => [r.id, { ...base }]))), updatedAt: new Date().toISOString(), generationTrace };
}
