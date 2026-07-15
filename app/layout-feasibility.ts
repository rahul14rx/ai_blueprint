import { Brief, RoomType } from "./studio-types";
import { buildLayoutProgram } from "./layout-program";
import { ROOM_RULES, toUnit } from "./layout-rules";

export type FeasibilityIssue = {
  severity: "error" | "warning";
  message: string;
};

export type FeasibilityReport = {
  canGenerate: boolean;
  score: number;
  plotArea: number;
  requiredArea: number;
  issues: FeasibilityIssue[];
  errors: string[];
  warnings: string[];
};

const formatArea = (value: number, unit: Brief["unit"]) => `${Math.round(value).toLocaleString()} ${unit === "feet" ? "sq ft" : "sq m"}`;
const formatLength = (value: number, unit: Brief["unit"]) => `${Number(value.toFixed(1))} ${unit === "feet" ? "ft" : "m"}`;

function add(issues: FeasibilityIssue[], severity: FeasibilityIssue["severity"], message: string) {
  issues.push({ severity, message });
}

function roomTypeCount(types: RoomType[], type: RoomType) {
  return types.filter(item => item === type).length;
}

export function evaluateBriefFeasibility(brief: Brief): FeasibilityReport {
  const program = buildLayoutProgram(brief);
  const issues: FeasibilityIssue[] = [];
  const plotArea = brief.plotWidth * brief.plotDepth;
  const roomTypes = program.rooms.map(room => room.type);
  const requiredRoomsArea = program.rooms.reduce((sum, room) => sum + room.minWidth * room.minDepth, 0);
  const roomCount = Math.max(1, program.rooms.length);
  const wetRoomCount = roomTypeCount(roomTypes, "bathroom") + roomTypeCount(roomTypes, "utility") + roomTypeCount(roomTypes, "laundry");
  const publicRoomCount = roomTypeCount(roomTypes, "living") + roomTypeCount(roomTypes, "dining") + roomTypeCount(roomTypes, "kitchen");
  const circulationArea = Math.max(plotArea * 0.08, toUnit(brief, 3.5) * Math.min(brief.plotDepth, brief.plotWidth) * (roomCount > 5 ? 1.4 : 1));
  const serviceBuffer = Math.max(plotArea * 0.04, wetRoomCount * toUnit(brief, 8));
  const publicBuffer = publicRoomCount > 2 ? toUnit(brief, 24) : 0;
  const requiredArea = requiredRoomsArea + circulationArea + serviceBuffer + publicBuffer;
  const pressure = requiredArea / Math.max(1, plotArea);
  const shortSide = Math.min(brief.plotWidth, brief.plotDepth);
  const longSide = Math.max(brief.plotWidth, brief.plotDepth);

  if (brief.plotWidth <= 0 || brief.plotDepth <= 0) {
    add(issues, "error", "Plot dimensions must be greater than zero.");
  }

  if (pressure > 1) {
    add(issues, "error", `The requested spaces need about ${formatArea(requiredArea, brief.unit)}, but the plot provides only ${formatArea(plotArea, brief.unit)}.`);
  } else if (pressure > 0.88) {
    add(issues, "warning", `This is a tight fit: the minimum program uses about ${Math.round(pressure * 100)}% of the plot before design breathing room.`);
  }

  if (roomTypeCount(roomTypes, "garage") > 0) {
    const rule = ROOM_RULES.garage;
    if (shortSide < toUnit(brief, rule.minWidth) || longSide < toUnit(brief, rule.minDepth)) {
      add(issues, "error", `A one-car garage needs at least ${rule.minWidth} ft x ${rule.minDepth} ft clear space.`);
    }
  }

  if (roomTypeCount(roomTypes, "stairs") > 0) {
    const rule = ROOM_RULES.stairs;
    if (shortSide < toUnit(brief, rule.minWidth) || longSide < toUnit(brief, rule.minDepth)) {
      add(issues, "error", `Internal stairs need at least ${rule.minWidth} ft x ${rule.minDepth} ft clear space.`);
    }
  }

  if (roomTypeCount(roomTypes, "bedroom") >= 3 && shortSide < toUnit(brief, 24)) {
    add(issues, "warning", `Three or more bedrooms usually need a plot width of at least ${formatLength(toUnit(brief, 24), brief.unit)} for usable circulation.`);
  }

  if (brief.livingRooms + brief.kitchens + brief.diningRooms === 0) {
    add(issues, "error", "The plan needs at least one public living, kitchen, or dining space.");
  }

  const errors = [...new Set(issues.filter(issue => issue.severity === "error").map(issue => issue.message))];
  const warnings = [...new Set(issues.filter(issue => issue.severity === "warning").map(issue => issue.message))];
  const score = Math.max(0, Math.round(100 - errors.length * 35 - warnings.length * 10 - Math.max(0, pressure - 0.72) * 35));

  return {
    canGenerate: errors.length === 0,
    score,
    plotArea,
    requiredArea,
    issues,
    errors,
    warnings,
  };
}
