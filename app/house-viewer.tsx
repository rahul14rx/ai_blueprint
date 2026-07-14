"use client";
import { Canvas } from "@react-three/fiber";
import { Environment, FirstPersonControls, Grid, OrbitControls, Text } from "@react-three/drei";
import { Suspense } from "react";
import { FloorPlan, MaterialSet, Room } from "./studio-types";

function Wall({ position, size, color, id, selected, onSelect }: { position: [number, number, number]; size: [number, number, number]; color: string; id: string; selected: boolean; onSelect: (id: string) => void }) {
  return <mesh position={position} castShadow receiveShadow onClick={e => { e.stopPropagation(); onSelect(id); }}>
    <boxGeometry args={size} /><meshStandardMaterial color={selected ? "#EF7545" : color} roughness={.72} />
  </mesh>;
}

function Furniture({ room, y, color }: { room: Room; y: number; color: string }) {
  if (room.type === "bathroom" || room.type === "stairs") return null;
  const w = Math.min(room.width * .46, room.type === "living" ? 2.4 : 1.8); const d = Math.min(room.depth * .32, 1.1);
  return <group position={[room.x + room.width / 2, y + .22, room.y + room.depth / 2]}>
    <mesh castShadow><boxGeometry args={[w, .42, d]} /><meshStandardMaterial color={color} roughness={.55} /></mesh>
    {room.type === "kitchen" && <mesh position={[0, .55, 0]} castShadow><boxGeometry args={[w * .75, .7, .42]} /><meshStandardMaterial color="#E9E4DA" /></mesh>}
  </group>;
}

function RoomGeometry({ room, plan, material, activeFloor, showCeiling, cutaway, selectedId, onSelect, interiors }: { room: Room; plan: FloorPlan; material: MaterialSet; activeFloor: number; showCeiling: boolean; cutaway: boolean; selectedId?: string; onSelect: (id: string) => void; interiors: boolean }) {
  const y = plan.elevation; const h = 2.8; const t = .14; const cx = room.x + room.width / 2; const cz = room.y + room.depth / 2;
  const visible = activeFloor === -1 || activeFloor === plan.level;
  if (!visible) return null;
  return <group>
    <mesh position={[cx, y + .04, cz]} receiveShadow onClick={e => { e.stopPropagation(); onSelect(room.id); }}>
      <boxGeometry args={[room.width - .08, .08, room.depth - .08]} /><meshStandardMaterial color={selectedId === room.id ? "#F2A17D" : material.floor} roughness={.76} />
    </mesh>
    <Wall id={`${room.id}:north`} selected={selectedId === `${room.id}:north`} onSelect={onSelect} position={[cx, y + h / 2, room.y]} size={[room.width, h, t]} color={material.wall} />
    {!cutaway && <Wall id={`${room.id}:south`} selected={selectedId === `${room.id}:south`} onSelect={onSelect} position={[cx, y + h / 2, room.y + room.depth]} size={[room.width, h, t]} color={material.wall} />}
    <Wall id={`${room.id}:west`} selected={selectedId === `${room.id}:west`} onSelect={onSelect} position={[room.x, y + h / 2, cz]} size={[t, h, room.depth]} color={material.wall} />
    {!cutaway && <Wall id={`${room.id}:east`} selected={selectedId === `${room.id}:east`} onSelect={onSelect} position={[room.x + room.width, y + h / 2, cz]} size={[t, h, room.depth]} color={material.wall} />}
    {showCeiling && <mesh position={[cx, y + h, cz]} receiveShadow><boxGeometry args={[room.width, .08, room.depth]} /><meshStandardMaterial color={material.ceiling} transparent opacity={.9} /></mesh>}
    {interiors && <Furniture room={room} y={y} color={material.accent} />}
    <Text position={[cx, y + .08, cz]} rotation={[-Math.PI/2, 0, 0]} fontSize={.24} color="#3E4D45" anchorX="center" anchorY="middle">{room.name}</Text>
  </group>;
}

export default function HouseViewer({ plans, materials, selectedId, onSelect, activeFloor, showCeiling, cutaway, mode, interiors }: { plans: FloorPlan[]; materials: Record<string, MaterialSet>; selectedId?: string; onSelect: (id: string) => void; activeFloor: number; showCeiling: boolean; cutaway: boolean; mode: "orbit" | "walk"; interiors: boolean }) {
  const width = plans[0]?.width || 14; const depth = plans[0]?.depth || 18;
  return <div className="three-canvas">
    <Canvas shadows camera={{ position: [width * 1.15, 12, depth * 1.2], fov: 42 }} onPointerMissed={() => onSelect("")}>
      <color attach="background" args={["#E9EFE9"]} /><fog attach="fog" args={["#E9EFE9", 35, 75]} />
      <ambientLight intensity={1.25} /><directionalLight position={[10, 18, 8]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
      <Suspense fallback={null}>
        <group position={[-width/2, 0, -depth/2]}>{plans.flatMap(plan => plan.rooms.map(room => <RoomGeometry key={room.id} room={room} plan={plan} material={materials[room.id]} activeFloor={activeFloor} showCeiling={showCeiling} cutaway={cutaway} selectedId={selectedId} onSelect={onSelect} interiors={interiors} />))}</group>
        <Environment preset="apartment" />
      </Suspense>
      <Grid args={[80, 80]} cellSize={1} cellThickness={.5} cellColor="#9DAAA2" sectionSize={5} sectionThickness={1} sectionColor="#728078" fadeDistance={55} infiniteGrid />
      {mode === "orbit" ? <OrbitControls makeDefault target={[0, 2.5, 0]} maxPolarAngle={Math.PI / 2.02} /> : <FirstPersonControls makeDefault movementSpeed={4} lookSpeed={.08} />}
    </Canvas>
  </div>;
}
