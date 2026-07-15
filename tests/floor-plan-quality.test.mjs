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

const { createProject, validatePlans } = await vite.ssrLoadModule("/app/plan-generator.ts");
const { evaluateArchitecture } = await vite.ssrLoadModule("/app/architecture-validator.ts");
const { evaluateBriefFeasibility } = await vite.ssrLoadModule("/app/layout-feasibility.ts");
const { exteriorWalls, isCirculationLike, needsWetVentilation, sharedWall } = await vite.ssrLoadModule("/app/layout-rules.ts");

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
      assert.ok(targets.some(target => isCirculationLike(target) || (attached && target.type === "bedroom")), `${room.name} needs a valid door`);
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

function assertQuality(brief, expectations = {}) {
  const feasibility = evaluateBriefFeasibility(brief);
  assert.equal(feasibility.canGenerate, true, `feasibility issues:\n${feasibility.errors.join("\n")}`);
  const project = createProject(brief);
  const plan = project.plans[0];
  const geometryErrors = validatePlans(project.plans);
  const architecture = evaluateArchitecture(brief, plan);
  const blocking = [...geometryErrors, ...architecture.errors];

  assert.deepEqual(blocking, [], `blocking issues:\n${blocking.join("\n")}`);
  assertAccessOpenings(plan, brief);
  assertWetVentilation(plan);
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
  }), { porch: true, stairs: true, roundedLiving: true, minScore: 70 });
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
  }), { minScore: 68 });
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
  }), { porch: true, stairs: true, utility: true, minScore: 90 });
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
