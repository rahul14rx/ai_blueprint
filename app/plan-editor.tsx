"use client";
import { Arc, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import { useEffect, useRef } from "react";
import Konva from "konva";
import { FloorPlan, Room } from "./studio-types";

const SCALE = 9;
const OFFSET = 34;

function RoomShape({ room, selected, onSelect, onChange }: { room: Room; selected: boolean; onSelect: () => void; onChange: (room: Room) => void }) {
  const shape = useRef<Konva.Rect>(null); const transformer = useRef<Konva.Transformer>(null);
  useEffect(() => { if (selected && transformer.current && shape.current) { transformer.current.nodes([shape.current]); transformer.current.getLayer()?.batchDraw(); } }, [selected]);
  return <>
    <Rect ref={shape} x={OFFSET + room.x * SCALE} y={OFFSET + room.y * SCALE} width={room.width * SCALE} height={room.depth * SCALE} fill={room.color} stroke={selected ? "#F06D3A" : "#28362F"} strokeWidth={selected ? 3 : 1.5}
      onClick={onSelect} onTap={onSelect}
      onTransformEnd={() => { const n = shape.current!; const width = Math.max(4, n.width() * n.scaleX() / SCALE); const depth = Math.max(4, n.height() * n.scaleY() / SCALE); n.scaleX(1); n.scaleY(1); onChange({ ...room, x: Math.max(0, (n.x()-OFFSET) / SCALE), y: Math.max(0, (n.y()-OFFSET) / SCALE), width, depth }); }} />
    <Text x={OFFSET + room.x * SCALE + 5} y={OFFSET + room.y * SCALE + 6} width={Math.max(35, room.width * SCALE - 10)} text={`${room.name}\n${room.width.toFixed(0)}′ × ${room.depth.toFixed(0)}′`} align="center" fontFamily="Arial" fontStyle="bold" fontSize={room.width < 7 ? 8 : 10} lineHeight={1.35} fill="#26352E" listening={false} />
    {selected && <Transformer ref={transformer} rotateEnabled={false} resizeEnabled={false} borderStroke="#EF7545" />}
  </>;
}

export default function PlanEditor({ plan, selectedId, onSelect, onUpdate }: { plan: FloorPlan; selectedId?: string; onSelect: (id: string) => void; onUpdate: (room: Room) => void }) {
  return <div className="plan-canvas" aria-label="Generated structured floor plan">
    <Stage width={plan.width * SCALE + OFFSET * 2 + 80} height={plan.depth * SCALE + OFFSET * 2}>
      <Layer>
        <Rect x={OFFSET} y={OFFSET} width={plan.width * SCALE} height={plan.depth * SCALE} fill="#FBFBF7" stroke="#18251F" strokeWidth={5} />
        {plan.rooms.map(room => <RoomShape key={room.id} room={room} selected={room.id === selectedId} onSelect={() => onSelect(room.id)} onChange={onUpdate} />)}
        {plan.openings.map(opening => {
          const r = plan.rooms.find(room => room.id === opening.roomId); if (!r) return null;
          const w = opening.width * SCALE; const horizontal = opening.wall === "north" || opening.wall === "south";
          const x = OFFSET + (r.x + (horizontal ? (r.width-opening.width)*opening.offset : opening.wall === "east" ? r.width : 0)) * SCALE;
          const y = OFFSET + (r.y + (!horizontal ? (r.depth-opening.width)*opening.offset : opening.wall === "south" ? r.depth : 0)) * SCALE;
          if (opening.kind === "window") return horizontal
            ? <Line key={opening.id} points={[x,y-2,x+w,y-2]} stroke="#2D84A7" strokeWidth={4}/>
            : <Line key={opening.id} points={[x-2,y,x-2,y+w]} stroke="#2D84A7" strokeWidth={4}/>;
          return <Arc key={opening.id} x={x} y={y} innerRadius={0} outerRadius={w} angle={90} rotation={opening.wall === "north" ? 0 : opening.wall === "south" ? 180 : opening.wall === "east" ? 90 : 270} stroke="#C1643E" strokeWidth={1.5}/>;
        })}
        <Text x={OFFSET} y={8} width={plan.width*SCALE} text={`${plan.width.toFixed(0)}′`} align="center" fontStyle="bold" fontSize={12}/>
        <Text x={6} y={OFFSET+plan.depth*SCALE/2-10} text={`${plan.depth.toFixed(0)}′`} rotation={-90} fontStyle="bold" fontSize={12}/>
        <Text x={OFFSET+plan.width*SCALE+20} y={OFFSET+12} text="N\n↑" align="center" fontStyle="bold" fontSize={15} lineHeight={1.1}/>
        <Text x={OFFSET+plan.width*SCALE+18} y={OFFSET+plan.depth*SCALE/2-35} width={55} text="ROAD\nEAST\n→" align="center" fontStyle="bold" fontSize={11} lineHeight={1.35} fill="#496A59"/>
      </Layer>
    </Stage>
  </div>;
}
