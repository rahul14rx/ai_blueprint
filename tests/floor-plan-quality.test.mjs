import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true },
});
after(async () => {
  await vite.close();
});

const { createProject, finalPlanErrors, parseBrief, validatePlans } = await vite.ssrLoadModule("/app/plan-generator.ts");
const { evaluateArchitecture } = await vite.ssrLoadModule("/app/architecture-validator.ts");
const { evaluateBriefFeasibility } = await vite.ssrLoadModule("/app/layout-feasibility.ts");
const { normalizeParsedRequirements } = await vite.ssrLoadModule("/app/requirement-normalizer.ts");
const { exteriorWalls, isCirculationLike, needsWetVentilation, placementDistance, roomExceedsMaximum, sharedWall } = await vite.ssrLoadModule("/app/layout-rules.ts");
const { buildPlan3DGeometry } = await vite.ssrLoadModule("/app/plan-3d-geometry.ts");

function makeBrief(overrides) {
  return {
    title: "Golden Prompt Plan",
    prompt: "",
    floors: 1,
    plotWidth: 40,
    plotDepth: 60,
    unit: "feet",
    bedrooms: 2,
    bathrooms: 2,
    livingRooms: 1,
    kitchens: 1,
    diningRooms: 1,
    style: "Modern",
    facing: "east",
    roadSide: "east",
    features: [],
    adjacency: [],
    warnings: [],
    ...overrides,
  };
}

function roomCount(plan, type) {
  return plan.rooms.filter(room => room.type === type || (type === "dining" && room.name.toLowerCase().includes("dining"))).length;
}

function overlapAmount(a1, a2, b1, b2) {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

function openingTarget(plan, owner, opening) {
  const horizontal = opening.wall === "north" || opening.wall === "south";
  const roomStart = horizontal ? owner.x : owner.y;
  const roomLength = horizontal ? owner.width : owner.depth;
  const start = roomStart + (roomLength - opening.width) * opening.offset;
  const end = start + opening.width;
  return plan.rooms.filter(room => room.id !== owner.id && sharedWall(owner, room) === opening.wall).find(room => {
    const targetStart = horizontal ? room.x : room.y;
    const targetEnd = horizontal ? room.x + room.width : room.y + room.depth;
    return overlapAmount(start, end, targetStart, targetEnd) > Math.min(1, opening.width * 0.45);
  }) ?? null;
}

function doorTargets(plan, room) {
  const targets = [];
  plan.openings.filter(opening => opening.kind === "door").forEach(opening => {
    const owner = plan.rooms.find(candidate => candidate.id === opening.roomId);
    if (!owner) return;
    if (owner.id === room.id) {
      const target = openingTarget(plan, owner, opening);
      if (target) targets.push(target);
      return;
    }
    const target = openingTarget(plan, owner, opening);
    if (target?.id === room.id) targets.push(owner);
  });
  return targets;
}

function assertAccessOpenings(plan, brief) {
  const roadSide = brief.roadSide !== "unspecified" ? brief.roadSide : brief.facing;
  for (const room of plan.rooms) {
    const targets = doorTargets(plan, room);
    if (room.type === "bedroom") assert.ok(targets.some(isCirculationLike), `${room.name} needs a circulation door`);
    if (room.type === "bathroom") {
      const attached = room.name.toLowerCase().includes("attached");
      assert.ok(targets.some(target => attached ? target.type === "bedroom" : isCirculationLike(target)), attached ? `${room.name} needs a bedroom door` : `${room.name} needs a circulation door`);
    }
    if (["stairs", "utility", "laundry", "pantry", "study"].includes(room.type)) assert.ok(targets.length > 0, `${room.name} needs a usable door`);
    if (room.type === "garage") {
      const roadDoor = roadSide !== "unspecified" && exteriorWalls(room, plan).includes(roadSide) && plan.openings.some(opening => opening.kind === "door" && opening.roomId === room.id && opening.wall === roadSide);
      assert.ok(roadDoor, `${room.name} needs a vehicle door to the road`);
    }
  }
}

function assertWetVentilation(plan) {
  for (const room of plan.rooms.filter(needsWetVentilation)) {
    const hasWindow = plan.openings.some(opening => opening.roomId === room.id && opening.kind === "window");
    const hasVent = plan.openings.some(opening => opening.roomId === room.id && opening.kind === "vent");
    assert.ok(hasWindow || hasVent, `${room.name} needs a window or vent`);
    if (room.type === "bathroom" && exteriorWalls(room, plan).length === 0) {
      assert.ok(hasVent, `${room.name} is internal and needs a vent`);
    }
  }
}

function assertNoOversizedSecondaryHallways(plan) {
  for (const room of plan.rooms.filter(room => room.type === "hallway")) {
    if (/central|entry|bedroom/i.test(room.name)) continue;
    assert.ok(room.width * room.depth <= 80, `${room.name} should not become a large leftover hallway`);
  }
}

function assertRoomPlacement(plan, type, sides, maxDistance, label = type) {
  const rooms = plan.rooms.filter(room => room.type === type || (type === "dining" && room.name.toLowerCase().includes("dining")));
  assert.ok(rooms.length > 0, `${label} room exists for placement check`);
  const best = Math.min(...rooms.map(room => Math.max(...sides.map(side => placementDistance(room, plan, side)))));
  assert.ok(best <= maxDistance, `${label} should be near ${sides.join("+")} but distance was ${best.toFixed(2)}`);
}

function assertRoomRatio(plan, type, maxRatio, label = type) {
  const rooms = plan.rooms.filter(room => room.type === type || (type === "dining" && room.name.toLowerCase().includes("dining")));
  assert.ok(rooms.length > 0, `${label} room exists for ratio check`);
  const worst = Math.max(...rooms.map(room => Math.max(room.width, room.depth) / Math.max(0.01, Math.min(room.width, room.depth))));
  assert.ok(worst <= maxRatio, `${label} should not be corridor-like; ratio was ${worst.toFixed(2)}`);
}

function assertQuality(brief, expectations = {}) {
  const feasibility = evaluateBriefFeasibility(brief);
  assert.equal(feasibility.canGenerate, true, `feasibility issues:\n${feasibility.errors.join("\n")}`);
  const project = createProject(brief);
  const plan = project.plans[0];
  const geometryErrors = validatePlans(project.plans);
  const architecture = evaluateArchitecture(brief, plan);
  const blocking = [...geometryErrors, ...architecture.errors];

  assert.deepEqual(blocking, [], `blocking issues:\n${blocking.join("\n")}`);
  assert.deepEqual(finalPlanErrors(brief, plan), [], "final plan gate");
  assertAccessOpenings(plan, brief);
  assertWetVentilation(plan);
  assertNoOversizedSecondaryHallways(plan);
  for (const room of plan.rooms) assert.equal(roomExceedsMaximum(room, brief), false, `${room.name} should stay within recommended maximum size`);
  assert.equal(plan.width, brief.plotWidth);
  assert.equal(plan.depth, brief.plotDepth);
  assert.ok(roomCount(plan, "bedroom") >= brief.bedrooms, "bedroom count");
  assert.ok(roomCount(plan, "bathroom") >= brief.bathrooms, "bathroom count");
  assert.ok(roomCount(plan, "kitchen") >= brief.kitchens, "kitchen count");
  assert.ok(roomCount(plan, "living") >= brief.livingRooms, "living count");
  if (brief.diningRooms) assert.ok(roomCount(plan, "dining") >= brief.diningRooms, "dining count");
  if (expectations.garage) assert.ok(roomCount(plan, "garage") >= 1, "garage count");
  if (expectations.stairs) assert.ok(roomCount(plan, "stairs") >= 1, "stairs count");
  if (expectations.porch) assert.ok(roomCount(plan, "porch") >= 1, "porch count");
  if (expectations.utility) assert.ok(roomCount(plan, "utility") + roomCount(plan, "laundry") >= 1, "utility/laundry count");
  if (expectations.pantry) assert.ok(roomCount(plan, "pantry") >= 1, "pantry count");
  if (expectations.study) assert.ok(roomCount(plan, "study") >= 1, "study count");
  if (expectations.roundedLiving) assert.ok(plan.rooms.some(room => room.type === "living" && room.shape === "rounded"), "rounded living room");
  if (expectations.noAttachedBath) assert.equal(project.plans.flatMap(plan => plan.rooms).some(room => /attached/i.test(room.name)), false, "should not invent attached bath labels");
  if (!brief.features.includes("study")) assert.equal(project.plans.flatMap(plan => plan.rooms).some(room => room.type === "study"), false, "should not invent study/flex rooms");
  expectations.placements?.forEach(check => assertRoomPlacement(plan, check.type, check.sides, check.maxDistance, check.label));
  expectations.maxRatios?.forEach(check => assertRoomRatio(plan, check.type, check.maxRatio, check.label));
  if (expectations.noWarnings) assert.deepEqual(architecture.warnings, [], "architecture warnings");
  assert.ok(architecture.score >= (expectations.minScore ?? 70), `architecture score ${architecture.score}`);
  return { plan, architecture };
}

function assertBlocking(brief) {
  const feasibility = evaluateBriefFeasibility(brief);
  assert.equal(feasibility.canGenerate, false, "expected feasibility gate to block impossible brief");
  const project = createProject(brief);
  const plan = project.plans[0];
  const geometryErrors = validatePlans(project.plans);
  const architecture = evaluateArchitecture(brief, plan);
  const blocking = [...geometryErrors, ...architecture.errors];
  assert.ok(blocking.length > 0, "expected blocking issues for infeasible brief");
  return blocking;
}

test("40x60 east-facing 2BHK with garage, stairs, utility, and attached bath", () => {
  assertQuality(makeBrief({
    prompt: "Create a modern ground-floor plan for a 40 ft x 60 ft east-facing plot. Include 2 bedrooms, 2 bathrooms, a living room, kitchen beside the dining room, a one-car garage, an internal staircase and a utility room. One bathroom should be attached. The road is on the east side. Prioritize ventilation, practical circulation and no room overlaps.",
    features: ["garage", "internal_staircase", "utility"],
    adjacency: ["kitchen beside dining room", "one bathroom attached"],
  }), { garage: true, stairs: true, minScore: 70 });
});

test("30x40 south-facing compact 2BHK with porch and rounded living room", () => {
  assertQuality(makeBrief({
    prompt: "Create a compact 30 ft x 40 ft south-facing ground-floor plan with 2 bedrooms, 1 common bathroom, kitchen, open dining area, rounded living room, front porch, and internal staircase. Road and main entry on the south side. Bedrooms on the left side, kitchen near rear, open dining in the center, rounded living room at front-right, stairs near the front entry, and porch at the front-right.",
    plotWidth: 30,
    plotDepth: 40,
    bathrooms: 1,
    facing: "south",
    roadSide: "south",
    features: ["internal_staircase", "porch", "open_space"],
    adjacency: ["bedrooms open to circulation", "rounded living room front-right"],
  }), {
    porch: true,
    stairs: true,
    roundedLiving: true,
    minScore: 70,
    placements: [
      { type: "living", sides: ["south", "east"], maxDistance: 0.45, label: "rounded living front-right" },
      { type: "kitchen", sides: ["north"], maxDistance: 0.2, label: "kitchen rear" },
      { type: "bedroom", sides: ["west"], maxDistance: 0.25, label: "bedrooms left side" },
      { type: "dining", sides: ["center"], maxDistance: 0.32, label: "open dining center" },
      { type: "porch", sides: ["south", "east"], maxDistance: 0.22, label: "porch front-right" },
    ],
    maxRatios: [
      { type: "dining", maxRatio: 1.8, label: "open dining area" },
    ],
    noWarnings: true,
  });
});

test("28x42 south-facing 3BHK with full bath, half bath, laundry, and central hallway", () => {
  assertQuality(makeBrief({
    prompt: "Create a 28 ft x 42 ft south-facing single-floor house with road and main entry on the south side. Include 3 bedrooms, 1 full bathroom, 1 half bathroom, living room, kitchen, laundry, and central hallway. Place living room at the front-left, kitchen at the front-right, bedrooms toward the north/top side, full bathroom near the center-right, half bath near the right side, and laundry near the kitchen/bath. Bedrooms must open to the hallway.",
    plotWidth: 28,
    plotDepth: 42,
    bedrooms: 3,
    bathrooms: 2,
    diningRooms: 0,
    facing: "south",
    roadSide: "south",
    features: ["laundry"],
    adjacency: ["bedrooms open to hallway", "laundry near kitchen and bath"],
  }), {
    minScore: 68,
    placements: [
      { type: "living", sides: ["south", "west"], maxDistance: 0.28, label: "living front-left" },
      { type: "kitchen", sides: ["south", "east"], maxDistance: 0.28, label: "kitchen front-right" },
      { type: "bathroom", sides: ["east"], maxDistance: 0.32, label: "bath right side" },
    ],
  });
});

test("26x36 west-facing 1BHK keeps compact rooms above minimum sizes", () => {
  assertQuality(makeBrief({
    prompt: "Create a 26 ft x 36 ft west-facing 1 bedroom home with 1 bathroom, living room, kitchen, dining nook, utility, and road/main entry on the west side. Keep bedroom rear, public areas front, kitchen near utility.",
    plotWidth: 26,
    plotDepth: 36,
    bedrooms: 1,
    bathrooms: 1,
    facing: "west",
    roadSide: "west",
    features: ["utility"],
  }), { utility: true, minScore: 90 });
});

test("32x44 north-facing 2BHK without dining keeps both bathrooms", () => {
  assertQuality(makeBrief({
    prompt: "Create a 32 ft x 44 ft north-facing 2 bedroom house with 2 bathrooms, living room, kitchen, utility, porch, and internal staircase. Road and main entry on north side. No separate dining room.",
    plotWidth: 32,
    plotDepth: 44,
    bedrooms: 2,
    bathrooms: 2,
    diningRooms: 0,
    facing: "north",
    roadSide: "north",
    features: ["utility", "porch", "internal_staircase"],
  }), { porch: true, stairs: true, utility: true, noAttachedBath: true, minScore: 90 });
});

test("36x54 west-facing 2BHK supports mirrored road side with garage and stairs", () => {
  assertQuality(makeBrief({
    prompt: "Create a 36 ft x 54 ft west-facing 2 bedroom house with 2 bathrooms, living room, kitchen beside dining, one-car garage, utility, and internal staircase. Road on west side.",
    plotWidth: 36,
    plotDepth: 54,
    bedrooms: 2,
    bathrooms: 2,
    facing: "west",
    roadSide: "west",
    features: ["garage", "utility", "internal_staircase"],
    adjacency: ["kitchen beside dining"],
  }), { garage: true, stairs: true, utility: true, minScore: 80 });
});

test("48x70 north-facing 4BHK can place larger programs without falling back", () => {
  assertQuality(makeBrief({
    prompt: "Create a 48 ft x 70 ft north-facing 4 bedroom house with 3 bathrooms, living room, kitchen, dining, family room/study, utility, pantry, porch and one-car garage. Road and main entry on north side.",
    plotWidth: 48,
    plotDepth: 70,
    bedrooms: 4,
    bathrooms: 3,
    facing: "north",
    roadSide: "north",
    features: ["garage", "utility", "pantry", "porch", "study"],
  }), { garage: true, utility: true, pantry: true, porch: true, study: true, minScore: 80 });
});

test("impossibly tight briefs are reported as blocking instead of accepted", () => {
  const blocking = assertBlocking(makeBrief({
    prompt: "Create a 16 ft x 22 ft south-facing single-floor house with 3 bedrooms, 2 bathrooms, kitchen, dining, living room and garage.",
    plotWidth: 16,
    plotDepth: 22,
    bedrooms: 3,
    bathrooms: 2,
    facing: "south",
    roadSide: "south",
    features: ["garage"],
  }));
  assert.ok(blocking.some(message => /minimum|smaller|outside|missing/i.test(message)), blocking.join("\n"));
});

test("attached bathrooms require a direct bedroom door", () => {
  const brief = makeBrief({
    prompt: "Create a 40 ft x 60 ft east-facing house with 1 bedroom and 1 attached bathroom.",
    bedrooms: 1,
    bathrooms: 1,
    diningRooms: 0,
    features: [],
    adjacency: ["attached bathroom"],
  });
  const plan = {
    id: "bad-attached",
    level: 0,
    elevation: 0,
    width: 40,
    depth: 60,
    unit: "feet",
    facing: "east",
    roadSide: "east",
    rooms: [
      { id: "hall", name: "Central hallway", type: "hallway", x: 12, y: 0, width: 4, depth: 60, color: "#fff" },
      { id: "bed", name: "Bedroom 1", type: "bedroom", x: 0, y: 10, width: 12, depth: 12, color: "#fff" },
      { id: "bath", name: "Attached bath", type: "bathroom", x: 16, y: 10, width: 6, depth: 8, color: "#fff" },
      { id: "foyer", name: "Foyer", type: "foyer", x: 16, y: 0, width: 24, depth: 10, color: "#fff" },
    ],
    openings: [
      { id: "entry", kind: "door", wall: "east", roomId: "foyer", offset: 0.5, width: 3 },
      { id: "foyer-hall", kind: "door", wall: "west", roomId: "foyer", offset: 0.5, width: 3 },
      { id: "bed-door", kind: "door", wall: "east", roomId: "bed", offset: 0.5, width: 3 },
      { id: "bath-hall", kind: "door", wall: "west", roomId: "bath", offset: 0.5, width: 3 },
      { id: "bed-window", kind: "window", wall: "west", roomId: "bed", offset: 0.5, width: 4 },
      { id: "bath-vent", kind: "vent", wall: "west", roomId: "bath", offset: 0.5, width: 2 },
    ],
  };
  const report = evaluateArchitecture(brief, plan);
  assert.ok(report.errors.some(message => /direct door to a bedroom/i.test(message)), report.errors.join("\n"));
});

test("connected kitchen and dining require a passable opening", () => {
  const brief = makeBrief({
    prompt: "Create a 32 ft x 40 ft house with kitchen connected to dining.",
    plotWidth: 32,
    plotDepth: 40,
    bedrooms: 0,
    bathrooms: 0,
    livingRooms: 0,
    kitchens: 1,
    diningRooms: 1,
    adjacency: ["kitchen connected to dining"],
  });
  const plan = {
    id: "bad-kitchen-dining",
    level: 0,
    elevation: 0,
    width: 32,
    depth: 40,
    unit: "feet",
    facing: "south",
    roadSide: "south",
    rooms: [
      { id: "foyer", name: "Foyer", type: "foyer", x: 0, y: 28, width: 32, depth: 12, color: "#fff" },
      { id: "kitchen", name: "Kitchen", type: "kitchen", x: 0, y: 0, width: 16, depth: 14, color: "#fff" },
      { id: "dining", name: "Dining area", type: "dining", x: 16, y: 0, width: 16, depth: 14, color: "#fff" },
    ],
    openings: [
      { id: "entry", kind: "door", wall: "south", roomId: "foyer", offset: 0.5, width: 3 },
      { id: "kitchen-window", kind: "window", wall: "west", roomId: "kitchen", offset: 0.5, width: 4 },
      { id: "dining-window", kind: "window", wall: "east", roomId: "dining", offset: 0.5, width: 4 },
    ],
  };
  const report = evaluateArchitecture(brief, plan);
  assert.ok(report.errors.some(message => /passable door or open connection/i.test(message)), report.errors.join("\n"));
});

test("road-facing plans require a visible main entry door", () => {
  const brief = makeBrief({
    prompt: "Create a 32 ft x 40 ft south-facing house with road and main entry on the south side.",
    plotWidth: 32,
    plotDepth: 40,
    bedrooms: 0,
    bathrooms: 0,
    livingRooms: 0,
    kitchens: 0,
    diningRooms: 0,
    facing: "south",
    roadSide: "south",
  });
  const plan = {
    id: "missing-main-entry",
    level: 0,
    elevation: 0,
    width: 32,
    depth: 40,
    unit: "feet",
    facing: "south",
    roadSide: "south",
    rooms: [
      { id: "foyer", name: "Foyer", type: "foyer", x: 0, y: 32, width: 32, depth: 8, color: "#fff" },
    ],
    openings: [],
  };
  const report = evaluateArchitecture(brief, plan);
  assert.ok(report.errors.some(message => /main entry\/gate/i.test(message)), report.errors.join("\n"));
});

test("bathrooms are not labeled attached unless requested", () => {
  const project = createProject(makeBrief({
    prompt: "Create a 32 ft x 44 ft north-facing two floor home with 2 bedrooms, 2 bathrooms, living room, kitchen, utility and internal staircase. Road on north side. Do not create an ensuite.",
    floors: 2,
    plotWidth: 32,
    plotDepth: 44,
    bedrooms: 2,
    bathrooms: 2,
    diningRooms: 0,
    facing: "north",
    roadSide: "north",
    features: ["utility", "internal_staircase"],
  }));
  const attachedRooms = project.plans.flatMap(plan => plan.rooms).filter(room => /attached/i.test(room.name));
  assert.deepEqual(attachedRooms.map(room => room.name), []);
});

test("leftover areas are neutral storage unless study is requested", () => {
  const project = createProject(makeBrief({
    prompt: "Create a 36 ft x 54 ft west-facing 2 bedroom house with 2 bathrooms, living room, kitchen beside dining, utility, and internal staircase. Road on west side. Do not add a study or flex room.",
    plotWidth: 36,
    plotDepth: 54,
    bedrooms: 2,
    bathrooms: 2,
    facing: "west",
    roadSide: "west",
    features: ["utility", "internal_staircase"],
    adjacency: ["kitchen beside dining"],
  }));
  const inventedStudy = project.plans.flatMap(plan => plan.rooms).filter(room => room.type === "study" || /flex room/i.test(room.name));
  assert.deepEqual(inventedStudy.map(room => room.name), []);
});

test("feature extraction respects negated optional rooms", () => {
  const brief = parseBrief(
    "Create a 36 ft x 54 ft west-facing single-floor house with 2 bedrooms, 2 bathrooms, living room, kitchen, dining, laundry and internal staircase. Road on west side. Do not add a study or flex room, without garage, and pantry not required.",
    { floors: 1, plotWidth: 36, plotDepth: 54, unit: "feet", facing: "west", roadSide: "west" },
  );

  assert.ok(brief.features.includes("laundry"), "laundry should still be extracted");
  assert.ok(brief.features.includes("internal_staircase"), "internal staircase should still be extracted");
  assert.equal(brief.features.includes("study"), false, "negated study/flex room must not be extracted");
  assert.equal(brief.features.includes("garage"), false, "negated garage must not be extracted");
  assert.equal(brief.features.includes("pantry"), false, "pantry not required must not be extracted");
});

test("local parser understands single-floor and mixed full-half bathrooms", () => {
  const brief = parseBrief(
    "Create a 28 ft x 42 ft south-facing single-floor house with 3 bedrooms, 1 full bathroom, 1 half bathroom, living room, kitchen, laundry, and central hallway.",
    { plotWidth: 28, plotDepth: 42, unit: "feet", facing: "south", roadSide: "south" },
  );

  assert.equal(brief.floors, 1);
  assert.equal(brief.bedrooms, 3);
  assert.equal(brief.bathrooms, 2);
  assert.ok(brief.features.includes("laundry"), "laundry should still be extracted");
});

test("local parser extracts plot dimensions, unit, facing, and road side from prompt", () => {
  const brief = parseBrief(
    "Create a modern 40 ft x 60 ft east-facing house with 2 bedrooms, 2 bathrooms, kitchen, dining, living room, garage, staircase, and utility. The road is on the east side.",
    {},
  );

  assert.equal(brief.plotWidth, 40);
  assert.equal(brief.plotDepth, 60);
  assert.equal(brief.unit, "feet");
  assert.equal(brief.facing, "east");
  assert.equal(brief.roadSide, "east");
  assert.equal(brief.bedrooms, 2);
  assert.equal(brief.bathrooms, 2);
  assert.ok(brief.features.includes("garage"), "garage should be extracted");
  assert.ok(brief.features.includes("internal_staircase"), "staircase should be extracted");
  assert.ok(brief.features.includes("utility"), "utility should be extracted");
});

test("local parser respects no separate dining room", () => {
  const brief = parseBrief(
    "Create a 32 ft x 44 ft north-facing 2 bedroom house with 2 bathrooms, living room, kitchen, utility, porch, and internal staircase. Road and main entry on north side. No separate dining room.",
    {},
  );

  assert.equal(brief.plotWidth, 32);
  assert.equal(brief.plotDepth, 44);
  assert.equal(brief.facing, "north");
  assert.equal(brief.roadSide, "north");
  assert.equal(brief.livingRooms, 1);
  assert.equal(brief.kitchens, 1);
  assert.equal(brief.diningRooms, 0);
});

test("API normalizer overrides negated shared-room counts", () => {
  const prompt = "Create a 32 ft x 44 ft north-facing 2 bedroom house with 2 bathrooms, living room, kitchen, utility, porch, and internal staircase. Road and main entry on north side. No separate dining room.";
  const brief = normalizeParsedRequirements({
    title: "No Dining Test",
    plotWidth: 32,
    plotDepth: 44,
    unit: "feet",
    floors: 1,
    bedrooms: 2,
    bathrooms: 2,
    livingRooms: 1,
    kitchens: 1,
    diningRooms: 1,
    facing: "north",
    roadSide: "north",
    features: ["utility", "internal_staircase", "porch"],
    adjacency: [],
    warnings: [],
  }, prompt);

  assert.equal(brief.livingRooms, 1);
  assert.equal(brief.kitchens, 1);
  assert.equal(brief.diningRooms, 0);
});

test("API normalizer falls back to prompt for missing Gemini fields", () => {
  const prompt = "Create a 28 ft x 42 ft south-facing single-floor house with 3 bedrooms, 1 full bathroom, 1 half bathroom, living room, kitchen, laundry, and central hallway. Road and main entry on the south side.";
  const brief = normalizeParsedRequirements({
    title: "Partial Gemini Parse",
    unit: "",
    facing: "unspecified",
    roadSide: "unspecified",
    features: ["laundry"],
  }, prompt);

  assert.equal(brief.plotWidth, 28);
  assert.equal(brief.plotDepth, 42);
  assert.equal(brief.unit, "feet");
  assert.equal(brief.floors, 1);
  assert.equal(brief.bedrooms, 3);
  assert.equal(brief.bathrooms, 2);
  assert.equal(brief.facing, "south");
  assert.equal(brief.roadSide, "south");
});

test("API normalizer recovers omitted prompt features without adding negated ones", () => {
  const prompt = "Create a modern 40 ft x 60 ft east-facing house with 2 bedrooms, 2 bathrooms, kitchen, dining, living room, garage, staircase, and utility. The road is on the east side. Do not add a study.";
  const brief = normalizeParsedRequirements({
    title: "Partial Feature Parse",
    plotWidth: 40,
    plotDepth: 60,
    unit: "feet",
    floors: 1,
    bedrooms: 2,
    bathrooms: 2,
    livingRooms: 1,
    kitchens: 1,
    diningRooms: 1,
    facing: "east",
    roadSide: "east",
    features: [],
  }, prompt);

  assert.ok(brief.features.includes("garage"), "garage should be recovered from prompt");
  assert.ok(brief.features.includes("internal_staircase"), "staircase should be recovered from prompt");
  assert.ok(brief.features.includes("utility"), "utility should be recovered from prompt");
  assert.equal(brief.features.includes("study"), false, "negated study must not be recovered");
});

test("3D geometry merges shared walls and cuts door gaps", () => {
  const plan = {
    id: "two-room-plan",
    level: 0,
    elevation: 0,
    width: 20,
    depth: 10,
    unit: "feet",
    facing: "south",
    roadSide: "south",
    rooms: [
      { id: "living", name: "Living", type: "living", x: 0, y: 0, width: 10, depth: 10, color: "#fff" },
      { id: "kitchen", name: "Kitchen", type: "kitchen", x: 10, y: 0, width: 10, depth: 10, color: "#fff" },
    ],
    openings: [
      { id: "living-kitchen-door", kind: "door", wall: "east", roomId: "living", offset: 0.5, width: 4 },
    ],
  };

  const geometry = buildPlan3DGeometry(plan);
  const sharedWallPieces = geometry.walls.filter(wall => wall.kind === "interior" && wall.orientation === "vertical" && Math.abs(wall.x1 - 10) < 0.03);
  const totalSharedLength = sharedWallPieces.reduce((sum, wall) => sum + wall.z2 - wall.z1, 0);

  assert.equal(totalSharedLength, 6);
  assert.ok(sharedWallPieces.every(wall => wall.thickness < 0.3), "shared partitions should use interior wall thickness");
  assert.equal(geometry.walls.filter(wall => wall.kind === "exterior").length, 4);
});
