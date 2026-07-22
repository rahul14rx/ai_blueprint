"use client";
import { Arc, Circle, Layer, Line, Path, Rect, Stage, Text, Transformer, Group, Ellipse } from "react-konva";
import { useEffect, useRef } from "react";
import Konva from "konva";
import { FloorPlan, Opening, Room, Furniture, RoomType } from "./studio-types";
import { getEntryPath, getMainEntryPlacement, getOpeningPlacement } from "./plan-openings";

const OFFSET = 62;
const WALL = "#111713";
const INTERNAL_WALL = "#24302A";
const PAPER = "#FFFFFF";
const SYMBOL = "#3E4742";

function getRoomFillProps(roomType: RoomType, w: number, h: number) {
  const gradients: Record<RoomType, { stops: (string | number)[]; start?: {x: number, y: number}; end?: {x: number, y: number} }> = {
    living: { stops: [0, "#F5EAD4", 1, "#EBD8B3"] },
    bedroom: { stops: [0, "#EAE5DE", 1, "#DFD7CE"] },
    dining: { stops: [0, "#F4E2C7", 1, "#E8CEA6"] },
    kitchen: { stops: [0, "#F3F4F6", 1, "#E5E7EB"] },
    bathroom: { stops: [0, "#E0F2FE", 1, "#BAE6FD"] },
    garage: { stops: [0, "#E5E7EB", 1, "#D1D5DB"] },
    stairs: { stops: [0, "#F5E4B8", 1, "#E6D095"] },
    foyer: { stops: [0, "#FEF3C7", 1, "#FDE68A"] },
    hallway: { stops: [0, "#FAFAF9", 1, "#F5F5F4"] },
    utility: { stops: [0, "#ECFDF5", 1, "#D1FAE5"] },
    laundry: { stops: [0, "#E0F2FE", 1, "#BAE6FD"] },
    study: { stops: [0, "#EEF2F6", 1, "#E2E8F0"] },
    pantry: { stops: [0, "#FDF2E9", 1, "#FAE5D3"] },
    storage: { stops: [0, "#F4F4F5", 1, "#E4E4E7"] },
    porch: { stops: [0, "#ECE4D9", 1, "#DCD0BD"] },
    open: { stops: [0, "#FFFDF6", 1, "#FFF9E6"] },
  };

  const g = gradients[roomType] || { stops: [0, "#FFFFFC", 1, "#F4F4F0"] };
  return {
    fillLinearGradientStartPoint: g.start || { x: 0, y: 0 },
    fillLinearGradientEndPoint: g.end || { x: w, y: h },
    fillLinearGradientColorStops: g.stops,
  };
}

function FurnitureAsset({ item, x, y, w, h, scale }: { item: Furniture; x: number; y: number; w: number; h: number; scale: number }) {
  const name = item.name.toLowerCase();
  
  const strokeColor = "#374151";
  const strokeWidth = 1;
  const shadowProps = {
    shadowColor: "#000000",
    shadowBlur: 5,
    shadowOffset: { x: 2, y: 2 },
    shadowOpacity: 0.16,
  };

  // Carpet Area Rug
  if (name.includes("rug") || name.includes("carpet")) {
    return (
      <Group x={x} y={y} listening={false}>
        {/* Carpet body (Warm fabric look) */}
        <Rect width={w} height={h} fill="#F5EFE6" stroke="#D7C49E" strokeWidth={1} strokeScaleEnabled={false} dash={[4, 2]} />
        {/* Fringe lines at left and right */}
        <Line points={[0, 0, 0, h]} stroke="#D7C49E" strokeWidth={1.5} dash={[2, 2]} />
        <Line points={[w, 0, w, h]} stroke="#D7C49E" strokeWidth={1.5} dash={[2, 2]} />
        {/* Geometric diamond pattern inside */}
        <Line points={[w * 0.1, h * 0.5, w * 0.5, h * 0.1, w * 0.9, h * 0.5, w * 0.5, h * 0.9, w * 0.1, h * 0.5]} stroke="#E2D4BC" strokeWidth={0.8} />
        <Text x={0} y={h / 2 - 4} width={w} text="RUG" align="center" fontSize={Math.max(5.5, w * 0.1)} fill="#A3906B" opacity={0.6} />
      </Group>
    );
  }

  // 1. BEDS
  if (name.includes("bed") && !name.includes("bedside")) {
    const isSingle = w < 4.5 * scale;
    const pillowW = isSingle ? w * 0.65 : w * 0.38;
    const pillowH = h * 0.16;
    const pillowY = h * 0.08 + 3;
    const headboardH = Math.max(4, h * 0.08);

    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        {/* Bed Frame Base */}
        <Rect width={w} height={h} fill="#E5E7EB" stroke={strokeColor} strokeWidth={strokeWidth} cornerRadius={2} />
        {/* Headboard */}
        <Rect width={w} height={headboardH} fill="#4B5563" stroke={strokeColor} strokeWidth={ headboardH * 0.08 } cornerRadius={1} />
        
        {/* Mattress (Inset) */}
        <Rect x={2} y={headboardH + 2} width={w - 4} height={h - headboardH - 4} fill="#FFFFFF" stroke="#D1D5DB" strokeWidth={1} cornerRadius={1} />
        
        {/* Mattress Quilting Lines */}
        <Line points={[4, headboardH + 10, w - 4, headboardH + 25]} stroke="#F3F4F6" strokeWidth={1} />
        <Line points={[4, headboardH + 25, w - 4, headboardH + 40]} stroke="#F3F4F6" strokeWidth={1} />
        <Line points={[4, headboardH + 40, w - 4, headboardH + 55]} stroke="#F3F4F6" strokeWidth={1} />

        {/* Pillows */}
        {isSingle ? (
          <Group x={(w - pillowW) / 2} y={pillowY}>
            <Rect width={pillowW} height={pillowH} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={0.8} cornerRadius={2} />
            <Line points={[pillowW * 0.1, pillowH / 2, pillowW * 0.9, pillowH / 2]} stroke="#E5E7EB" strokeWidth={0.8} />
          </Group>
        ) : (
          <>
            <Group x={w * 0.08} y={pillowY}>
              <Rect width={pillowW} height={pillowH} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={0.8} cornerRadius={2} />
              <Line points={[pillowW * 0.1, pillowH / 2, pillowW * 0.9, pillowH / 2]} stroke="#E5E7EB" strokeWidth={0.8} />
            </Group>
            <Group x={w * 0.54} y={pillowY}>
              <Rect width={pillowW} height={pillowH} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={0.8} cornerRadius={2} />
              <Line points={[pillowW * 0.1, pillowH / 2, pillowW * 0.9, pillowH / 2]} stroke="#E5E7EB" strokeWidth={0.8} />
            </Group>
          </>
        )}

        {/* Layered Duvet/Blanket Overlay */}
        <Rect
          x={2}
          y={h * 0.36}
          width={w - 4}
          height={h * 0.64 - 2}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: 0, y: h * 0.64 }}
          fillLinearGradientColorStops={[0, "#D1FAE5", 1, "#A7F3D0"]}
          stroke="#A7F3D0"
          strokeWidth={0.5}
          cornerRadius={1}
        />
        <Rect x={2} y={h * 0.36 - h * 0.06} width={w - 4} height={h * 0.06} fill="#FFFFFF" stroke="#D1D5DB" strokeWidth={0.5} />
        <Line points={[2, h * 0.36, w - 2, h * 0.36]} stroke="#34D399" strokeWidth={1} />
        
        {/* Label */}
        <Text x={0} y={h - 13} width={w} text={item.name} align="center" fontStyle="bold" fontSize={Math.max(5.5, w * 0.11)} fill="#374151" />
      </Group>
    );
  }

  // Bedside Tables / Nightstands
  if (name.includes("bedside") || name.includes("nightstand")) {
    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        <Rect width={w} height={h} fill="#F5EAD4" stroke="#B45309" strokeWidth={strokeWidth} cornerRadius={1} />
        <Line points={[2, h * 0.25, w - 2, h * 0.25]} stroke="#DDBE99" strokeWidth={0.8} />
        {/* Table Lamp (yellow glow circular light source) */}
        <Circle x={w * 0.5} y={h * 0.5} radius={Math.min(w, h) * 0.24} fill="#FDE68A" stroke="#F59E0B" strokeWidth={0.6} />
        <Circle x={w * 0.5} y={h * 0.5} radius={2} fill="#FFFFFF" />
        <Text x={0} y={h - 9} width={w} text="NIGHTSTAND" align="center" fontSize={Math.max(4.5, w * 0.08)} fill="#78350F" />
      </Group>
    );
  }

  // 2. SOFAS / COUCHES
  if (name.includes("sofa") || name.includes("couch") || name.includes("lounge") || name.includes("armchair") || name.includes("seat")) {
    const isArmchair = w < 3.5 * scale;
    const numCushions = isArmchair ? 1 : w > 6 * scale ? 3 : 2;
    const backrestDepth = Math.max(3.5, h * 0.18);
    const armrestWidth = Math.max(3.0, w * 0.08);

    const cushions = [];
    const cushionW = (w - armrestWidth * 2) / numCushions;
    for (let i = 0; i < numCushions; i++) {
      cushions.push(
        <Rect
          key={i}
          x={armrestWidth + i * cushionW + 1}
          y={backrestDepth + 1}
          width={cushionW - 2}
          height={h - backrestDepth * 2 - 2}
          fill="#FFFFFF"
          stroke="#9CA3AF"
          strokeWidth={0.8}
          cornerRadius={2}
        />
      );
    }

    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        {/* Sofa Frame */}
        <Rect width={w} height={h} fill="#F4F4F5" stroke={strokeColor} strokeWidth={strokeWidth} cornerRadius={3} />
        {/* Cushions */}
        {cushions}
        {/* Backrest */}
        <Rect x={armrestWidth} y={0} width={w - armrestWidth * 2} height={backrestDepth} fill="#E4E4E7" stroke="#9CA3AF" strokeWidth={0.8} cornerRadius={1} />
        {/* Armrests */}
        <Rect x={0} y={0} width={armrestWidth} height={h} fill="#E4E4E7" stroke="#9CA3AF" strokeWidth={0.8} cornerRadius={1} />
        <Rect x={w - armrestWidth} y={0} width={armrestWidth} height={h} fill="#E4E4E7" stroke="#9CA3AF" strokeWidth={0.8} cornerRadius={1} />
        
        {/* Throw Pillows */}
        <Rect x={armrestWidth + 2} y={backrestDepth + 1} width={w * 0.09} height={w * 0.09} rotation={12} fill="#D97706" stroke="#B45309" strokeWidth={0.5} cornerRadius={1} />
        {!isArmchair && (
          <Rect x={w - armrestWidth - 2 - w * 0.09} y={backrestDepth + 1} width={w * 0.09} height={w * 0.09} rotation={-12} fill="#D97706" stroke="#B45309" strokeWidth={0.5} cornerRadius={1} />
        )}

        <Text x={0} y={h - 11} width={w} text={item.name} align="center" fontStyle="bold" fontSize={Math.max(5.5, w * 0.11)} fill="#374151" />
      </Group>
    );
  }

  // Coffee Table with tray, pot, and books
  if (name.includes("coffee table")) {
    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        <Rect width={w} height={h} fill="#E0F2FE" stroke="#0284C7" strokeWidth={1.5} cornerRadius={4} opacity={0.85} />
        <Rect x={3} y={3} width={w - 6} height={h - 6} fill="#F5EAD4" opacity={0.3} />
        
        <Group x={w * 0.25} y={h * 0.25}>
          <Circle radius={Math.min(w, h) * 0.18} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={0.8} />
          <Circle radius={Math.min(w, h) * 0.06} fill="#F59E0B" />
          <Circle radius={Math.min(w, h) * 0.04} fill="#10B981" />
        </Group>

        <Rect x={w * 0.58} y={h * 0.3} width={w * 0.22} height={h * 0.4} rotation={-8} fill="#3B82F6" stroke="#1D4ED8" strokeWidth={0.5} cornerRadius={0.5} />
        <Rect x={w * 0.6} y={h * 0.35} width={w * 0.18} height={h * 0.3} rotation={-8} fill="#FFFFFF" opacity={0.8} />

        <Text x={0} y={h - 9} width={w} text="COFFEE TABLE" align="center" fontSize={Math.max(5, w * 0.08)} fill="#0369A1" />
      </Group>
    );
  }

  // TV Console / Unit
  if (name.includes("tv unit") || name.includes("tv console") || name.includes("entertainment") || name.includes("media")) {
    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        <Rect width={w} height={h} fill="#DDBE99" stroke="#78350F" strokeWidth={strokeWidth} cornerRadius={1} />
        <Line points={[w * 0.25, 0, w * 0.25, h]} stroke="#78350F" strokeWidth={0.5} />
        <Line points={[w * 0.75, 0, w * 0.75, h]} stroke="#78350F" strokeWidth={0.5} />
        
        <Rect x={w * 0.4} y={h * 0.3} width={w * 0.2} height={h * 0.4} fill="#1F2937" stroke="#111827" strokeWidth={1} />
        <Rect x={w * 0.1} y={h * 0.45} width={w * 0.8} height={4} fill="#111827" stroke="#000000" strokeWidth={1} />
        <Line points={[w * 0.15, h * 0.45 + 1, w * 0.3, h * 0.45 + 1]} stroke="#FFFFFF" strokeWidth={0.8} opacity={0.6} />
        
        <Text x={0} y={h - 8} width={w} text={item.name} align="center" fontSize={Math.max(5, w * 0.1)} fill="#78350F" />
      </Group>
    );
  }

  // Dining Table or general Desk
  if (name.includes("table") || name.includes("desk")) {
    const isDiningTable = name.includes("dining");
    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        <Rect width={w} height={h} fill="#F5EAD4" stroke="#B45309" strokeWidth={1.5} cornerRadius={2} />
        <Rect x={3} y={3} width={w - 6} height={h - 6} stroke="#E5C595" strokeWidth={0.8} />

        {name.includes("desk") && (
          <Group x={w / 2 - 10} y={h / 2 - 8}>
            <Rect x={0} y={4} width={20} height={7} fill="#E5E7EB" stroke="#9CA3AF" strokeWidth={0.5} cornerRadius={1} />
            <Rect x={1.5} y={0} width={17} height={4} fill="#1F2937" stroke="#111827" strokeWidth={0.5} />
            <Line points={[2, 2, 12, 2]} stroke="#FFFFFF" strokeWidth={0.5} opacity={0.4} />
          </Group>
        )}

        {isDiningTable && (
          <>
            <Rect x={w * 0.15} y={-3} width={w * 0.22} height={3} fill="#4B5563" stroke="#374151" strokeWidth={0.5} cornerRadius={0.5} />
            <Rect x={w * 0.63} y={-3} width={w * 0.22} height={3} fill="#4B5563" stroke="#374151" strokeWidth={0.5} cornerRadius={0.5} />
            <Rect x={w * 0.15} y={h} width={w * 0.22} height={3} fill="#4B5563" stroke="#374151" strokeWidth={0.5} cornerRadius={0.5} />
            <Rect x={w * 0.63} y={h} width={w * 0.22} height={3} fill="#4B5563" stroke="#374151" strokeWidth={0.5} cornerRadius={0.5} />
          </>
        )}

        <Text x={0} y={h / 2 - 4} width={w} text={item.name} align="center" fontStyle="bold" fontSize={Math.max(5.5, w * 0.11)} fill="#4B5563" />
      </Group>
    );
  }

  // Refrigerator (Fridge with double doors handles)
  if (name.includes("fridge") || name.includes("refrigerator")) {
    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        <Rect width={w} height={h} fill="#E5E7EB" stroke={strokeColor} strokeWidth={strokeWidth} cornerRadius={1} />
        {/* Freezer box line */}
        <Line points={[0, h * 0.35, w, h * 0.35]} stroke="#9CA3AF" strokeWidth={0.8} />
        {/* Double-door swing divider */}
        <Line points={[w / 2, 0, w / 2, h]} stroke="#9CA3AF" strokeWidth={1} />
        {/* Dual door handles */}
        <Rect x={w / 2 - 2.2} y={2} width={1} height={h * 0.2} fill="#374151" />
        <Rect x={w / 2 + 1.2} y={2} width={1} height={h * 0.2} fill="#374151" />
        <Text x={0} y={h - 10} width={w} text="FRIDGE" align="center" fontStyle="bold" fontSize={Math.max(5.5, w * 0.1)} fill="#374151" />
      </Group>
    );
  }

  // 3. KITCHEN COUNTERS, SINK, STOVE, ISLAND & STOOLS
  if (name.includes("counter") || name.includes("sink") || name.includes("stove") || name.includes("range") || name.includes("cabinet") || name.includes("island")) {
    const isSink = name.includes("sink");
    const isStove = name.includes("stove") || name.includes("range");
    const isIsland = name.includes("island");

    if (isIsland) {
      return (
        <Group x={x} y={y} {...shadowProps} listening={false}>
          <Rect width={w} height={h} fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: w, y: h }} fillLinearGradientColorStops={[0, "#FFFFFF", 1, "#E5E7EB"]} stroke={strokeColor} strokeWidth={1.5} cornerRadius={2} />
          <Rect x={2} y={2} width={w - 4} height={h - 4} stroke="#D1D5DB" strokeWidth={0.8} />

          <Line points={[w * 0.2, 4, w * 0.4, h - 4]} stroke="#D1D5DB" strokeWidth={0.5} opacity={0.6} />
          <Line points={[w * 0.7, 4, w * 0.8, h * 0.6]} stroke="#D1D5DB" strokeWidth={0.5} opacity={0.6} />

          {w > 20 && (
            <>
              <Circle x={w * 0.3} y={h + 4} radius={4} fill="#4B5563" stroke="#374151" strokeWidth={0.8} />
              <Rect x={w * 0.3 - 3.5} y={h + 7} width={7} height={1.5} fill="#1F2937" />
              <Circle x={w * 0.7} y={h + 4} radius={4} fill="#4B5563" stroke="#374151" strokeWidth={0.8} />
              <Rect x={w * 0.7 - 3.5} y={h + 7} width={7} height={1.5} fill="#1F2937" />
            </>
          )}

          <Text x={0} y={h / 2 - 4} width={w} text="KITCHEN ISLAND" align="center" fontStyle="bold" fontSize={Math.max(5.5, w * 0.1)} fill="#374151" />
        </Group>
      );
    }

    // Standard counter: draw vertical cabinet panels
    const cabinetLines = [];
    const numCabinets = Math.max(2, Math.floor(w / (2 * scale)));
    const cabinetW = w / numCabinets;
    for (let i = 1; i < numCabinets; i++) {
      cabinetLines.push(<Line key={i} points={[i * cabinetW, 0, i * cabinetW, h]} stroke="#E5E7EB" strokeWidth={0.6} />);
    }

    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        <Rect width={w} height={h} fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: 0, y: h }} fillLinearGradientColorStops={[0, "#FCFDFD", 1, "#F3F4F6"]} stroke={strokeColor} strokeWidth={strokeWidth} />
        {cabinetLines}
        <Line points={[0, h - 3, w, h - 3]} stroke="#D1D5DB" strokeWidth={1} />
        
        {isSink && (
          <Group x={w / 2 - 11} y={h / 2 - 7}>
            <Rect x={0} y={0} width={22} height={14} fill="#D1D5DB" stroke="#9CA3AF" strokeWidth={1} cornerRadius={2} />
            <Rect x={1} y={1} width={9} height={12} fill="#E5E7EB" stroke="#A7F3D0" strokeWidth={0.5} />
            <Rect x={12} y={1} width={9} height={12} fill="#E5E7EB" stroke="#A7F3D0" strokeWidth={0.5} />
            <Circle x={11} y={12} radius={1.2} fill="#9CA3AF" />
            <Line points={[11, 12, 11, 8]} stroke="#9CA3AF" strokeWidth={1.5} />
          </Group>
        )}

        {isStove && (
          <Group x={w / 2 - 10} y={h / 2 - 10}>
            <Rect width={20} height={20} fill="#111827" stroke="#1F2937" strokeWidth={0.8} cornerRadius={2} />
            <Circle x={5} y={5} radius={3.2} stroke="#DC2626" strokeWidth={0.8} opacity={0.8} />
            <Circle x={15} y={5} radius={2.5} stroke="#D1D5DB" strokeWidth={0.8} />
            <Circle x={5} y={15} radius={2.5} stroke="#D1D5DB" strokeWidth={0.8} />
            <Circle x={15} y={15} radius={3.2} stroke="#DC2626" strokeWidth={0.8} opacity={0.8} />
            <Circle x={10} y={18} radius={0.8} fill="#EF4444" />
            <Circle x={8} y={18} radius={0.6} fill="#9CA3AF" />
            <Circle x={12} y={18} radius={0.6} fill="#9CA3AF" />
          </Group>
        )}

        <Text x={0} y={h - 10} width={w} text={item.name} align="center" fontSize={Math.max(5, w * 0.09)} fill="#4B5563" />
      </Group>
    );
  }

  // 4. BATHROOM PORCELAIN FIXTURES
  if (name.includes("toilet") || name.includes("wc") || name.includes("bathtub") || name.includes("bath") || name.includes("shower") || name.includes("vanity") || name.includes("sink")) {
    const isToilet = name.includes("toilet") || name.includes("wc");
    const isBathtub = name.includes("bathtub") || name.includes("bath");
    const isShower = name.includes("shower");

    if (isToilet) {
      const tankD = Math.max(3, h * 0.28);
      return (
        <Group x={x} y={y} {...shadowProps} listening={false}>
          {/* Realistic Oval Toilet using Ellipse */}
          <Ellipse x={w / 2} y={tankD + (h - tankD) / 2} radiusX={w * 0.3} radiusY={(h - tankD) * 0.42} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={1.2} />
          <Ellipse x={w / 2} y={tankD + (h - tankD) / 2} radiusX={w * 0.22} radiusY={(h - tankD) * 0.32} fill="#F9FAFB" stroke="#D1D5DB" strokeWidth={0.8} />
          <Rect x={w * 0.08} y={0} width={w * 0.84} height={tankD} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={1} cornerRadius={1} />
          <Circle x={w / 2} y={tankD / 2} radius={1.2} fill="#9CA3AF" />
          <Text x={0} y={h - 8} width={w} text="TOILET" align="center" fontSize={Math.max(4.5, w * 0.1)} fill="#4B5563" />
        </Group>
      );
    }

    if (isBathtub) {
      return (
        <Group x={x} y={y} {...shadowProps} listening={false}>
          <Rect width={w} height={h} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={1.5} cornerRadius={3} />
          {/* Bathtub with water shading and curved inside rim */}
          <Rect
            x={3}
            y={3}
            width={w - 6}
            height={h - 6}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: w, y: h }}
            fillLinearGradientColorStops={[0, "#F0F9FF", 0.5, "#E0F2FE", 1, "#BAE6FD"]}
            stroke="#9CA3AF"
            strokeWidth={0.8}
            cornerRadius={Math.min(w, h) * 0.18}
          />
          <Circle x={w / 2} y={h * 0.88} radius={1.2} fill="#9CA3AF" stroke="#64748B" strokeWidth={0.5} />
          <Line points={[w / 2 - 3, h * 0.94, w / 2 + 3, h * 0.94]} stroke="#9CA3AF" strokeWidth={1.5} />
          <Text x={0} y={h / 2 - 4} width={w} text="BATHTUB" align="center" fontStyle="bold" fontSize={Math.max(5.5, w * 0.1)} fill="#0369A1" />
        </Group>
      );
    }

    if (isShower) {
      return (
        <Group x={x} y={y} {...shadowProps} listening={false}>
          <Rect width={w} height={h} fill="#F8FAFC" stroke="#9CA3AF" strokeWidth={1.2} />
          <Line points={[0, 0, w, h]} stroke="#CBD5E1" strokeWidth={0.5} />
          <Line points={[w, 0, 0, h]} stroke="#CBD5E1" strokeWidth={0.5} />
          <Circle x={w / 2} y={h / 2} radius={2} fill="#9CA3AF" stroke="#64748B" strokeWidth={0.8} />
          <Text x={0} y={h - 10} width={w} text="SHOWER" align="center" fontSize={Math.max(5, w * 0.09)} fill="#4B5563" />
        </Group>
      );
    }

    // Vanity / Sink (includes circular undermount basin basin)
    return (
      <Group x={x} y={y} {...shadowProps} listening={false}>
        <Rect width={w} height={h} fill="#F3E8FF" stroke="#8B5A2B" strokeWidth={1.2} cornerRadius={2} />
        {/* Circular sink basin */}
        <Circle x={w / 2} y={h / 2} radius={Math.min(w, h) * 0.28} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={1} />
        {/* Faucet details */}
        <Circle x={w / 2} y={h * 0.2} radius={1} fill="#9CA3AF" />
        <Line points={[w / 2, h * 0.2, w / 2, h * 0.4]} stroke="#9CA3AF" strokeWidth={1.5} />
        <Text x={0} y={h - 9} width={w} text={item.name} align="center" fontSize={Math.max(5, w * 0.08)} fill="#4B5563" />
      </Group>
    );
  }

  // 5. DEFAULT BOX
  return (
    <Group x={x} y={y} {...shadowProps} listening={false}>
      <Rect width={w} height={h} fill="#F9FAFB" stroke={strokeColor} strokeWidth={strokeWidth} cornerRadius={1.5} />
      <Text x={0} y={h / 2 - 4} width={w} text={item.name} align="center" verticalAlign="middle" fontSize={Math.max(5.5, w * 0.12)} fill="#374151" />
    </Group>
  );
}

function FurnitureShape({ room, scale }: { room: Room; scale: number }) {
  let new_ = room.furniture;
  if (!new_ || new_.length === 0) return null;

  return <>
    {new_.map((item: Furniture, i: number) => {
      let x = OFFSET + (room.x + item.x) * scale;
      let y = OFFSET + (room.y + item.y) * scale;
      let w = item.width * scale;
      let h = item.depth * scale;

      return <FurnitureAsset key={item.id || i} item={item} x={x} y={y} w={w} h={h} scale={scale} />;
    })}
  </>;
}

function RoomSymbol({ room, scale }: { room: Room; scale: number }) {
  const x = OFFSET + room.x * scale;
  const y = OFFSET + room.y * scale;
  const w = room.width * scale;
  const h = room.depth * scale;
  const pad = Math.min(18, Math.max(7, Math.min(w, h) * 0.13));
  const compact = Math.min(w, h) < 58;
  if (w < 48 || h < 42) return null;

  if (room.type === "bedroom" || room.type === "study") return <>
    <Rect x={x + pad} y={y + pad + 10} width={w * 0.36} height={h * 0.32} stroke={SYMBOL} strokeWidth={0.9} fill="#F8F8F4" listening={false} />
    <Rect x={x + pad + 3} y={y + pad + 13} width={w * 0.14} height={h * 0.1} stroke={SYMBOL} strokeWidth={0.7} listening={false} />
    <Line points={[x + pad, y + pad + 10 + h * 0.19, x + pad + w * 0.36, y + pad + 10 + h * 0.19]} stroke={SYMBOL} strokeWidth={0.7} listening={false} />
  </>;

  if (room.type === "living") return <>
    <Rect x={x + pad} y={y + pad + 11} width={w * 0.44} height={h * 0.15} stroke={SYMBOL} strokeWidth={0.9} cornerRadius={3} listening={false} />
    <Rect x={x + pad} y={y + pad + h * 0.25} width={w * 0.2} height={h * 0.15} stroke={SYMBOL} strokeWidth={0.8} cornerRadius={3} listening={false} />
    <Rect x={x + w * 0.58} y={y + h * 0.46} width={w * 0.16} height={h * 0.14} stroke={SYMBOL} strokeWidth={0.8} listening={false} />
  </>;

  if (compact && ["bathroom", "utility", "pantry", "laundry"].includes(room.type)) return null;

  if (room.type === "dining") return <>
    <Rect x={x + w * 0.34} y={y + h * 0.25} width={w * 0.28} height={h * 0.34} stroke={SYMBOL} strokeWidth={1.2} listening={false} />
    {[0, 1, 2].map(i => <Rect key={`chair-l-${i}`} x={x + w * 0.24} y={y + h * (0.24 + i * 0.11)} width={w * 0.07} height={h * 0.07} stroke={SYMBOL} strokeWidth={0.8} listening={false} />)}
    {[0, 1, 2].map(i => <Rect key={`chair-r-${i}`} x={x + w * 0.65} y={y + h * (0.24 + i * 0.11)} width={w * 0.07} height={h * 0.07} stroke={SYMBOL} strokeWidth={0.8} listening={false} />)}
  </>;

  if (["kitchen", "utility", "pantry", "laundry"].includes(room.type)) return <>
    <Rect x={x + pad} y={y + pad} width={w * 0.18} height={h - pad * 2} stroke={SYMBOL} strokeWidth={1.2} listening={false} />
    <Rect x={x + w * 0.42} y={y + h * 0.24} width={w * 0.18} height={h * 0.35} stroke={SYMBOL} strokeWidth={1} listening={false} />
    <Circle x={x + pad + w * 0.09} y={y + pad + h * 0.18} radius={Math.min(w, h) * 0.045} stroke={SYMBOL} strokeWidth={0.8} listening={false} />
  </>;

  if (room.type === "bathroom") return <>
    <Rect x={x + pad} y={y + pad} width={w * 0.42} height={h * 0.25} stroke={SYMBOL} strokeWidth={1} listening={false} />
    <Circle x={x + w * 0.68} y={y + h * 0.38} radius={Math.min(w, h) * 0.11} stroke={SYMBOL} strokeWidth={1} listening={false} />
    <Rect x={x + w * 0.56} y={y + h * 0.56} width={w * 0.28} height={h * 0.2} stroke={SYMBOL} strokeWidth={1} listening={false} />
  </>;

  if (room.type === "stairs") return <>
    {Array.from({ length: 8 }, (_, i) => <Line key={i} points={[x + pad, y + pad + i * ((h - pad * 2) / 8), x + w - pad, y + pad + i * ((h - pad * 2) / 8)]} stroke={SYMBOL} strokeWidth={1} listening={false} />)}
    <Line points={[x + w * 0.26, y + h * 0.78, x + w * 0.72, y + h * 0.22]} stroke={SYMBOL} strokeWidth={1.1} listening={false} />
  </>;

  if (room.type === "garage") return <>
    <Rect x={x + w * 0.25} y={y + h * 0.22} width={w * 0.5} height={h * 0.5} stroke={SYMBOL} strokeWidth={1.2} cornerRadius={8} listening={false} />
    <Circle x={x + w * 0.34} y={y + h * 0.76} radius={Math.min(w, h) * 0.055} stroke={SYMBOL} strokeWidth={1} listening={false} />
    <Circle x={x + w * 0.66} y={y + h * 0.76} radius={Math.min(w, h) * 0.055} stroke={SYMBOL} strokeWidth={1} listening={false} />
  </>;

  return null;
}

function roomLabel(room: Room) {
  if (room.type === "hallway" && room.name.toLowerCase().includes("central")) return "CENTRAL HALL";
  return room.name.toUpperCase();
}

function roundedRoomPath(x: number, y: number, w: number, h: number, side: Room["curveSide"] = "east") {
  const curve = Math.min(w, h) * 0.24;
  if (side === "west") return `M ${x + curve} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x + curve} ${y + h} Q ${x} ${y + h / 2} ${x + curve} ${y} Z`;
  if (side === "north") return `M ${x} ${y + curve} Q ${x + w / 2} ${y} ${x + w} ${y + curve} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  if (side === "south") return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h - curve} Q ${x + w / 2} ${y + h} ${x} ${y + h - curve} Z`;
  return `M ${x} ${y} L ${x + w - curve} ${y} Q ${x + w} ${y + h / 2} ${x + w - curve} ${y + h} L ${x} ${y + h} Z`;
}

function RoomShape({ room, scale, unitMark, selected, onSelect, onChange }: { room: Room; scale: number; unitMark: string; selected: boolean; onSelect: () => void; onChange: (room: Room) => void }) {
  const shape = useRef<Konva.Rect>(null);
  const transformer = useRef<Konva.Transformer>(null);
  useEffect(() => {
    if (selected && transformer.current && shape.current) {
      transformer.current.nodes([shape.current]);
      transformer.current.getLayer()?.batchDraw();
    }
  }, [selected]);

  const x = OFFSET + room.x * scale;
  const y = OFFSET + room.y * scale;
  const w = room.width * scale;
  const h = room.depth * scale;
  const narrow = w < 48 && h > w * 1.8;
  const compact = w < 78 || h < 58;
  const fontSize = compact ? 7 : 9;
  const labelY = y + (compact ? 5 : 7);
  const label = `${roomLabel(room)}\n${room.width.toFixed(1)}${unitMark} x ${room.depth.toFixed(1)}${unitMark}`;

  const fillProps = getRoomFillProps(room.type, w, h);
  const shadowProps = selected
    ? { shadowColor: "#D66A38", shadowBlur: 8, shadowOffset: { x: 0, y: 0 }, shadowOpacity: 0.6 }
    : { shadowColor: "#000000", shadowBlur: 4, shadowOffset: { x: 1.5, y: 1.5 }, shadowOpacity: 0.12 };

  return <>
    {room.shape === "rounded"
      ? <>
        <Path data={roundedRoomPath(x, y, w, h, room.curveSide)} {...fillProps} stroke={selected ? "#D66A38" : INTERNAL_WALL} strokeWidth={selected ? 2.2 : 1.35} {...shadowProps} onClick={onSelect} onTap={onSelect} />
        <Rect ref={shape} x={x} y={y} width={w} height={h} fill="transparent" stroke="transparent"
          onClick={onSelect} onTap={onSelect}
          onTransformEnd={() => { const n = shape.current!; const width = Math.max(4, n.width() * n.scaleX() / scale); const depth = Math.max(4, n.height() * n.scaleY() / scale); n.scaleX(1); n.scaleY(1); onChange({ ...room, x: Math.max(0, (n.x() - OFFSET) / scale), y: Math.max(0, (n.y() - OFFSET) / scale), width, depth }); }} />
      </>
      : <Rect ref={shape} x={x} y={y} width={w} height={h} {...fillProps} stroke={selected ? "#D66A38" : INTERNAL_WALL} strokeWidth={selected ? 2.2 : 1.35} {...shadowProps}
        onClick={onSelect} onTap={onSelect}
        onTransformEnd={() => { const n = shape.current!; const width = Math.max(4, n.width() * n.scaleX() / scale); const depth = Math.max(4, n.height() * n.scaleY() / scale); n.scaleX(1); n.scaleY(1); onChange({ ...room, x: Math.max(0, (n.x() - OFFSET) / scale), y: Math.max(0, (n.y() - OFFSET) / scale), width, depth }); }} />}
    {(!room.furniture || room.furniture.length === 0) && <RoomSymbol room={room} scale={scale} />}
    <FurnitureShape room={room} scale={scale} />
    {narrow
      ? <Text x={x + w / 2 + 4} y={y + h - 8} width={Math.max(40, h - 16)} text={label} rotation={-90} align="center" fontFamily="Arial" fontStyle="bold" fontSize={fontSize} lineHeight={1.18} fill={WALL} listening={false} />
      : <Text x={x + 5} y={labelY} width={Math.max(35, w - 10)} text={label} align="center" fontFamily="Arial" fontStyle="bold" fontSize={fontSize} lineHeight={1.18} fill={WALL} listening={false} />}
    {selected && <Transformer ref={transformer} rotateEnabled={false} resizeEnabled={false} borderStroke="#EF7545" />}
  </>;
}

function OpeningShape({ opening, room, scale }: { opening: Opening; room: Room; scale: number }) {
  const doorStroke = "#B85832";
  const ventStroke = "#517466";
  const placement = getOpeningPlacement(opening, room);
  const horizontal = placement.orientation === "horizontal";
  const w = opening.width * scale;
  const x = OFFSET + (horizontal ? placement.start : placement.coord) * scale;
  const y = OFFSET + (horizontal ? placement.coord : placement.start) * scale;
  const gap = horizontal ? [x, y, x + w, y] : [x, y, x, y + w];

  if (opening.kind === "window") return <>
    <Line points={gap} stroke={PAPER} strokeWidth={7} listening={false} />
    {horizontal
      ? <><Line points={[x, y - 3, x + w, y - 3]} stroke={WALL} strokeWidth={1} /><Line points={[x, y + 3, x + w, y + 3]} stroke={WALL} strokeWidth={1} /></>
      : <><Line points={[x - 3, y, x - 3, y + w]} stroke={WALL} strokeWidth={1} /><Line points={[x + 3, y, x + 3, y + w]} stroke={WALL} strokeWidth={1} /></>}
  </>;

  if (opening.kind === "vent") return <>
    <Line points={gap} stroke={PAPER} strokeWidth={6} listening={false} />
    {horizontal
      ? <><Line points={[x, y - 2, x + w, y - 2]} stroke={ventStroke} strokeWidth={1} /><Line points={[x, y + 2, x + w, y + 2]} stroke={ventStroke} strokeWidth={1} /><Line points={[x + w * 0.25, y - 4, x + w * 0.25, y + 4]} stroke={ventStroke} strokeWidth={0.8} /><Line points={[x + w * 0.5, y - 4, x + w * 0.5, y + 4]} stroke={ventStroke} strokeWidth={0.8} /><Line points={[x + w * 0.75, y - 4, x + w * 0.75, y + 4]} stroke={ventStroke} strokeWidth={0.8} /></>
      : <><Line points={[x - 2, y, x - 2, y + w]} stroke={ventStroke} strokeWidth={1} /><Line points={[x + 2, y, x + 2, y + w]} stroke={ventStroke} strokeWidth={1} /><Line points={[x - 4, y + w * 0.25, x + 4, y + w * 0.25]} stroke={ventStroke} strokeWidth={0.8} /><Line points={[x - 4, y + w * 0.5, x + 4, y + w * 0.5]} stroke={ventStroke} strokeWidth={0.8} /><Line points={[x - 4, y + w * 0.75, x + 4, y + w * 0.75]} stroke={ventStroke} strokeWidth={0.8} /></>}
  </>;

  const leaf = horizontal ? [x, y, x + w, y] : [x, y, x, y + w];
  return <>
    <Line points={gap} stroke={PAPER} strokeWidth={8} listening={false} />
    <Line points={leaf} stroke={doorStroke} strokeWidth={1.4} listening={false} />
    <Arc x={x} y={y} innerRadius={0} outerRadius={w} angle={90} rotation={opening.wall === "north" ? 0 : opening.wall === "south" ? 180 : opening.wall === "east" ? 90 : 270} stroke={doorStroke} strokeWidth={1.1} listening={false} />
  </>;
}

function EntryPathShape({ plan, scale }: { plan: FloorPlan; scale: number }) {
  const path = getEntryPath(plan);
  if (!path) return null;

  const x = OFFSET + Math.min(path.x1, path.x2) * scale;
  const y = OFFSET + Math.min(path.z1, path.z2) * scale;
  const width = Math.abs(path.x2 - path.x1) * scale;
  const height = Math.abs(path.z2 - path.z1) * scale;

  return <>
    <Rect x={x} y={y} width={width} height={height} fill="#E8E0CF" stroke="#53695B" strokeWidth={1} dash={[5, 4]} listening={false} />
    <Text x={x - 8} y={y + height / 2 - 5} width={width + 16} text="ENTRY PATH" align="center" fontFamily="Arial" fontStyle="bold" fontSize={8} fill="#53695B" listening={false} />
  </>;
}

function EntryMarker({ plan, scale }: { plan: FloorPlan; scale: number }) {
  const placement = getMainEntryPlacement(plan);
  if (!placement) return null;
  const mainDoor = placement.opening;
  const horizontal = placement.orientation === "horizontal";
  const x = OFFSET + (horizontal ? placement.start : placement.coord) * scale;
  const y = OFFSET + (horizontal ? placement.coord : placement.start) * scale;
  const labelX = mainDoor.wall === "east" ? x + 10 : mainDoor.wall === "west" ? x - 58 : x - 24;
  const labelY = mainDoor.wall === "south" ? y + 10 : mainDoor.wall === "north" ? y - 24 : y - 8;
  const arrowPoints = mainDoor.wall === "south" ? [x, y + 14, x, y + 2] : mainDoor.wall === "north" ? [x, y - 14, x, y - 2] : mainDoor.wall === "east" ? [x + 14, y, x + 2, y] : [x - 14, y, x - 2, y];

  return <>
    <Line points={arrowPoints} stroke="#1F4D38" strokeWidth={1.5} listening={false} />
    <Text x={labelX} y={labelY} width={68} text="ENTRY / GATE" align="center" fontFamily="Arial" fontStyle="bold" fontSize={9} fill="#1F4D38" listening={false} />
  </>;
}

export default function PlanEditor({ plan, selectedId, onSelect, onUpdate, onCapture }: { plan: FloorPlan; selectedId?: string; onSelect: (id: string) => void; onUpdate: (room: Room) => void; onCapture?: (base64: string) => void }) {
  const scale = Math.min(9, 520 / plan.depth, 560 / plan.width);
  const unitMark = plan.unit === "feet" ? "'" : "m";
  const stageRef = useRef<any>(null);

  useEffect(() => {
    if (stageRef.current && onCapture) {
      try {
        const dataUrl = stageRef.current.toDataURL({ pixelRatio: 1.5 });
        const rawBase64 = dataUrl.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
        onCapture(rawBase64);
      } catch (err) {
        console.warn("Failed to capture Konva stage:", err);
      }
    }
  });

  return <div className="plan-canvas" aria-label="Generated structured floor plan">
    <Stage ref={stageRef} width={plan.width * scale + OFFSET * 2 + 80} height={plan.depth * scale + OFFSET * 2}>
      <Layer>
        <Rect x={OFFSET - 18} y={OFFSET - 18} width={plan.width * scale + 36} height={plan.depth * scale + 36} fill={PAPER} />
        <EntryPathShape plan={plan} scale={scale} />
        <Rect x={OFFSET} y={OFFSET} width={plan.width * scale} height={plan.depth * scale} fill={PAPER} stroke={WALL} strokeWidth={4.2}
          shadowColor="#000000" shadowBlur={8} shadowOffset={{ x: 3, y: 3 }} shadowOpacity={0.16} />
        {plan.rooms.map(room => <RoomShape key={room.id} room={room} scale={scale} unitMark={unitMark} selected={room.id === selectedId} onSelect={() => onSelect(room.id)} onChange={onUpdate} />)}
        {plan.openings.map(opening => {
          const room = plan.rooms.find(room => room.id === opening.roomId);
          return room ? <OpeningShape key={opening.id} opening={opening} room={room} scale={scale} /> : null;
        })}
        <EntryMarker plan={plan} scale={scale} />
        <Rect x={OFFSET} y={OFFSET} width={plan.width * scale} height={plan.depth * scale} stroke={WALL} strokeWidth={4.2} listening={false} />
        <Text x={OFFSET} y={8} width={plan.width * scale} text={`${plan.width.toFixed(1)}${unitMark}`} align="center" fontStyle="bold" fontSize={12} />
        <Text x={6} y={OFFSET + plan.depth * scale / 2 - 10} text={`${plan.depth.toFixed(1)}${unitMark}`} rotation={-90} fontStyle="bold" fontSize={12} />
        <Text x={OFFSET + plan.width * scale + 20} y={OFFSET + 12} text={`N\nUP\n\nFacing\n${plan.facing.toUpperCase()}`} align="center" fontStyle="bold" fontSize={11} lineHeight={1.15} />
        <Text x={OFFSET + plan.width * scale + 18} y={OFFSET + plan.depth * scale / 2 - 35} width={62} text={`ROAD\n${plan.roadSide.toUpperCase()} SIDE`} align="center" fontStyle="bold" fontSize={10} lineHeight={1.35} fill="#496A59" />
      </Layer>
    </Stage>
  </div>;
}