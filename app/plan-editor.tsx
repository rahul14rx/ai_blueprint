"use client";
import { Arc, Circle, Layer, Line, Path, Rect, Stage, Text, Transformer } from "react-konva";
import { useEffect, useRef } from "react";
import Konva from "konva";
import { FloorPlan, Opening, Room } from "./studio-types";
import { getEntryPath, getMainEntryPlacement, getOpeningPlacement } from "./plan-openings";

const OFFSET = 62;
const WALL = "#111713";
const INTERNAL_WALL = "#24302A";
const PAPER = "#FFFFFF";
const ROOM_FILL = "#FFFFFC";
const SELECTED_FILL = "#FFF9F0";
const SYMBOL = "#3E4742";

function RoomSymbol({ room, scale }: { room: Room; scale: number }) {
  const x = OFFSET + room.x * scale;
  const y = OFFSET + room.y * scale;
  const w = room.width * scale;
  const h = room.depth * scale;
  const pad = Math.min(18, Math.max(7, Math.min(w, h) * 0.13));
  const compact = Math.min(w, h) < 58;
  if (w < 48 || h < 42) return null;

  if (room.type === "bedroom" || room.type === "study") return <>
    <Rect x={x + pad} y={y + pad + 10} width={w * 0.36} height={h * 0.32} stroke={SYMBOL} strokeWidth={0.9} fill="#F8F8F4" listening={false}/>
    <Rect x={x + pad + 3} y={y + pad + 13} width={w * 0.14} height={h * 0.1} stroke={SYMBOL} strokeWidth={0.7} listening={false}/>
    <Line points={[x + pad, y + pad + 10 + h * 0.19, x + pad + w * 0.36, y + pad + 10 + h * 0.19]} stroke={SYMBOL} strokeWidth={0.7} listening={false}/>
  </>;

  if (room.type === "living") return <>
    <Rect x={x + pad} y={y + pad + 11} width={w * 0.44} height={h * 0.15} stroke={SYMBOL} strokeWidth={0.9} cornerRadius={3} listening={false}/>
    <Rect x={x + pad} y={y + pad + h * 0.25} width={w * 0.2} height={h * 0.15} stroke={SYMBOL} strokeWidth={0.8} cornerRadius={3} listening={false}/>
    <Rect x={x + w * 0.58} y={y + h * 0.46} width={w * 0.16} height={h * 0.14} stroke={SYMBOL} strokeWidth={0.8} listening={false}/>
  </>;

  if (compact && ["bathroom", "utility", "pantry", "laundry"].includes(room.type)) return null;

  if (room.type === "dining") return <>
    <Rect x={x + w * 0.34} y={y + h * 0.25} width={w * 0.28} height={h * 0.34} stroke={SYMBOL} strokeWidth={1.2} listening={false}/>
    {[0, 1, 2].map(i => <Rect key={`chair-l-${i}`} x={x + w * 0.24} y={y + h * (0.24 + i * 0.11)} width={w * 0.07} height={h * 0.07} stroke={SYMBOL} strokeWidth={0.8} listening={false}/>)}
    {[0, 1, 2].map(i => <Rect key={`chair-r-${i}`} x={x + w * 0.65} y={y + h * (0.24 + i * 0.11)} width={w * 0.07} height={h * 0.07} stroke={SYMBOL} strokeWidth={0.8} listening={false}/>)}
  </>;

  if (["kitchen", "utility", "pantry", "laundry"].includes(room.type)) return <>
    <Rect x={x + pad} y={y + pad} width={w * 0.18} height={h - pad * 2} stroke={SYMBOL} strokeWidth={1.2} listening={false}/>
    <Rect x={x + w * 0.42} y={y + h * 0.24} width={w * 0.18} height={h * 0.35} stroke={SYMBOL} strokeWidth={1} listening={false}/>
    <Circle x={x + pad + w * 0.09} y={y + pad + h * 0.18} radius={Math.min(w, h) * 0.045} stroke={SYMBOL} strokeWidth={0.8} listening={false}/>
  </>;

  if (room.type === "bathroom") return <>
    <Rect x={x + pad} y={y + pad} width={w * 0.42} height={h * 0.25} stroke={SYMBOL} strokeWidth={1} listening={false}/>
    <Circle x={x + w * 0.68} y={y + h * 0.38} radius={Math.min(w, h) * 0.11} stroke={SYMBOL} strokeWidth={1} listening={false}/>
    <Rect x={x + w * 0.56} y={y + h * 0.56} width={w * 0.28} height={h * 0.2} stroke={SYMBOL} strokeWidth={1} listening={false}/>
  </>;

  if (room.type === "stairs") return <>
    {Array.from({ length: 8 }, (_, i) => <Line key={i} points={[x + pad, y + pad + i * ((h - pad * 2) / 8), x + w - pad, y + pad + i * ((h - pad * 2) / 8)]} stroke={SYMBOL} strokeWidth={1} listening={false}/>)}
    <Line points={[x + w * 0.26, y + h * 0.78, x + w * 0.72, y + h * 0.22]} stroke={SYMBOL} strokeWidth={1.1} listening={false}/>
  </>;

  if (room.type === "garage") return <>
    <Rect x={x + w * 0.25} y={y + h * 0.22} width={w * 0.5} height={h * 0.5} stroke={SYMBOL} strokeWidth={1.2} cornerRadius={8} listening={false}/>
    <Circle x={x + w * 0.34} y={y + h * 0.76} radius={Math.min(w, h) * 0.055} stroke={SYMBOL} strokeWidth={1} listening={false}/>
    <Circle x={x + w * 0.66} y={y + h * 0.76} radius={Math.min(w, h) * 0.055} stroke={SYMBOL} strokeWidth={1} listening={false}/>
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

  return <>
    {room.shape === "rounded"
      ? <>
        <Path data={roundedRoomPath(x, y, w, h, room.curveSide)} fill={selected ? SELECTED_FILL : ROOM_FILL} stroke={selected ? "#D66A38" : INTERNAL_WALL} strokeWidth={selected ? 2.2 : 1.35} onClick={onSelect} onTap={onSelect}/>
        <Rect ref={shape} x={x} y={y} width={w} height={h} fill="transparent" stroke="transparent"
          onClick={onSelect} onTap={onSelect}
          onTransformEnd={() => { const n = shape.current!; const width = Math.max(4, n.width() * n.scaleX() / scale); const depth = Math.max(4, n.height() * n.scaleY() / scale); n.scaleX(1); n.scaleY(1); onChange({ ...room, x: Math.max(0, (n.x()-OFFSET) / scale), y: Math.max(0, (n.y()-OFFSET) / scale), width, depth }); }} />
      </>
      : <Rect ref={shape} x={x} y={y} width={w} height={h} fill={selected ? SELECTED_FILL : ROOM_FILL} stroke={selected ? "#D66A38" : INTERNAL_WALL} strokeWidth={selected ? 2.2 : 1.35}
        onClick={onSelect} onTap={onSelect}
        onTransformEnd={() => { const n = shape.current!; const width = Math.max(4, n.width() * n.scaleX() / scale); const depth = Math.max(4, n.height() * n.scaleY() / scale); n.scaleX(1); n.scaleY(1); onChange({ ...room, x: Math.max(0, (n.x()-OFFSET) / scale), y: Math.max(0, (n.y()-OFFSET) / scale), width, depth }); }} />}
    <RoomSymbol room={room} scale={scale}/>
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
    <Line points={gap} stroke={PAPER} strokeWidth={7} listening={false}/>
    {horizontal
      ? <><Line points={[x, y - 3, x + w, y - 3]} stroke={WALL} strokeWidth={1}/><Line points={[x, y + 3, x + w, y + 3]} stroke={WALL} strokeWidth={1}/></>
      : <><Line points={[x - 3, y, x - 3, y + w]} stroke={WALL} strokeWidth={1}/><Line points={[x + 3, y, x + 3, y + w]} stroke={WALL} strokeWidth={1}/></>}
  </>;

  if (opening.kind === "vent") return <>
    <Line points={gap} stroke={PAPER} strokeWidth={6} listening={false}/>
    {horizontal
      ? <><Line points={[x, y - 2, x + w, y - 2]} stroke={ventStroke} strokeWidth={1}/><Line points={[x, y + 2, x + w, y + 2]} stroke={ventStroke} strokeWidth={1}/><Line points={[x + w * 0.25, y - 4, x + w * 0.25, y + 4]} stroke={ventStroke} strokeWidth={0.8}/><Line points={[x + w * 0.5, y - 4, x + w * 0.5, y + 4]} stroke={ventStroke} strokeWidth={0.8}/><Line points={[x + w * 0.75, y - 4, x + w * 0.75, y + 4]} stroke={ventStroke} strokeWidth={0.8}/></>
      : <><Line points={[x - 2, y, x - 2, y + w]} stroke={ventStroke} strokeWidth={1}/><Line points={[x + 2, y, x + 2, y + w]} stroke={ventStroke} strokeWidth={1}/><Line points={[x - 4, y + w * 0.25, x + 4, y + w * 0.25]} stroke={ventStroke} strokeWidth={0.8}/><Line points={[x - 4, y + w * 0.5, x + 4, y + w * 0.5]} stroke={ventStroke} strokeWidth={0.8}/><Line points={[x - 4, y + w * 0.75, x + 4, y + w * 0.75]} stroke={ventStroke} strokeWidth={0.8}/></>}
  </>;

  const leaf = horizontal ? [x, y, x + w, y] : [x, y, x, y + w];
  return <>
    <Line points={gap} stroke={PAPER} strokeWidth={8} listening={false}/>
    <Line points={leaf} stroke={doorStroke} strokeWidth={1.4} listening={false}/>
    <Arc x={x} y={y} innerRadius={0} outerRadius={w} angle={90} rotation={opening.wall === "north" ? 0 : opening.wall === "south" ? 180 : opening.wall === "east" ? 90 : 270} stroke={doorStroke} strokeWidth={1.1} listening={false}/>
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
    <Rect x={x} y={y} width={width} height={height} fill="#E8E0CF" stroke="#53695B" strokeWidth={1} dash={[5, 4]} listening={false}/>
    <Text x={x - 8} y={y + height / 2 - 5} width={width + 16} text="ENTRY PATH" align="center" fontFamily="Arial" fontStyle="bold" fontSize={8} fill="#53695B" listening={false}/>
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
    <Line points={arrowPoints} stroke="#1F4D38" strokeWidth={1.5} listening={false}/>
    <Text x={labelX} y={labelY} width={68} text="ENTRY / GATE" align="center" fontFamily="Arial" fontStyle="bold" fontSize={9} fill="#1F4D38" listening={false}/>
  </>;
}

export default function PlanEditor({ plan, selectedId, onSelect, onUpdate, showEntry = true }: { plan: FloorPlan; selectedId?: string; onSelect: (id: string) => void; onUpdate: (room: Room) => void; showEntry?: boolean }) {
  const scale = Math.min(9, 520 / plan.depth, 560 / plan.width);
  const unitMark = plan.unit === "feet" ? "'" : "m";
  const hiddenEntryOpeningId = showEntry ? "" : getMainEntryPlacement(plan)?.opening.id ?? "";

  return <div className="plan-canvas" aria-label="Generated structured floor plan">
    <Stage width={plan.width * scale + OFFSET * 2 + 80} height={plan.depth * scale + OFFSET * 2}>
      <Layer>
        <Rect x={OFFSET - 18} y={OFFSET - 18} width={plan.width * scale + 36} height={plan.depth * scale + 36} fill={PAPER}/>
        {showEntry && <EntryPathShape plan={plan} scale={scale}/>}
        <Rect x={OFFSET} y={OFFSET} width={plan.width * scale} height={plan.depth * scale} fill={PAPER} stroke={WALL} strokeWidth={4.2} />
        {plan.rooms.map(room => <RoomShape key={room.id} room={room} scale={scale} unitMark={unitMark} selected={room.id === selectedId} onSelect={() => onSelect(room.id)} onChange={onUpdate} />)}
        {plan.openings.map(opening => {
          if (opening.id === hiddenEntryOpeningId) return null;
          const room = plan.rooms.find(room => room.id === opening.roomId);
          return room ? <OpeningShape key={opening.id} opening={opening} room={room} scale={scale}/> : null;
        })}
        {showEntry && <EntryMarker plan={plan} scale={scale}/>}
        <Rect x={OFFSET} y={OFFSET} width={plan.width * scale} height={plan.depth * scale} stroke={WALL} strokeWidth={4.2} listening={false}/>
        <Text x={OFFSET} y={8} width={plan.width * scale} text={`${plan.width.toFixed(1)}${unitMark}`} align="center" fontStyle="bold" fontSize={12}/>
        <Text x={6} y={OFFSET + plan.depth * scale / 2 - 10} text={`${plan.depth.toFixed(1)}${unitMark}`} rotation={-90} fontStyle="bold" fontSize={12}/>
        <Text x={OFFSET + plan.width * scale + 20} y={OFFSET + 12} text={`N\nUP\n\nFacing\n${plan.facing.toUpperCase()}`} align="center" fontStyle="bold" fontSize={11} lineHeight={1.15}/>
        <Text x={OFFSET + plan.width * scale + 18} y={OFFSET + plan.depth * scale / 2 - 35} width={62} text={`ROAD\n${plan.roadSide.toUpperCase()} SIDE`} align="center" fontStyle="bold" fontSize={10} lineHeight={1.35} fill="#496A59"/>
      </Layer>
    </Stage>
  </div>;
}
