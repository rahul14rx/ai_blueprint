"use client";
import { Canvas } from "@react-three/fiber";
import { Environment, FirstPersonControls, Grid, OrbitControls, Text } from "@react-three/drei";
import { Suspense } from "react";
import { FloorPlan, MaterialSet, Room } from "./studio-types";
import { buildPlan3DGeometry, WallSegment3D } from "./plan-3d-geometry";

function Wall({ position, size, color, id, selected, onSelect }: { position: [number, number, number]; size: [number, number, number]; color: string; id: string; selected: boolean; onSelect: (id: string) => void }) {
  return <mesh position={position} castShadow receiveShadow onClick={e => { e.stopPropagation(); onSelect(id); }}>
    <boxGeometry args={size} /><meshStandardMaterial color={selected ? "#EF7545" : color} roughness={.72} />
  </mesh>;
}

function SharedWall({ wall, y, selectedId, onSelect }: { wall: WallSegment3D; y: number; selectedId?: string; onSelect: (id: string) => void }) {
  const length = wall.orientation === "horizontal" ? wall.x2 - wall.x1 : wall.z2 - wall.z1;
  const position: [number, number, number] = wall.orientation === "horizontal"
    ? [(wall.x1 + wall.x2) / 2, y + wall.height / 2, wall.z1]
    : [wall.x1, y + wall.height / 2, (wall.z1 + wall.z2) / 2];
  const size: [number, number, number] = wall.orientation === "horizontal"
    ? [length, wall.height, wall.thickness]
    : [wall.thickness, wall.height, length];
  const color = wall.kind === "exterior" ? "#F5F2EA" : "#FFFFFF";

  return <Wall id={wall.id} selected={selectedId === wall.id} onSelect={onSelect} position={position} size={size} color={color} />;
}

function Furniture({ room, y, color }: { room: Room; y: number; color: string }) {
  if (room.type === "bathroom" || room.type === "stairs") return null;
  const w = Math.min(room.width * .46, room.type === "living" ? 2.4 : 1.8); const d = Math.min(room.depth * .32, 1.1);
  return <group position={[room.x + room.width / 2, y + .22, room.y + room.depth / 2]}>
    <mesh castShadow><boxGeometry args={[w, .42, d]} /><meshStandardMaterial color={color} roughness={.55} /></mesh>
    {room.type === "kitchen" && <mesh position={[0, .55, 0]} castShadow><boxGeometry args={[w * .75, .7, .42]} /><meshStandardMaterial color="#E9E4DA" /></mesh>}
  </group>;
}

function RoomGeometry({ room, plan, material, activeFloor, showCeiling, selectedId, onSelect, interiors }: { room: Room; plan: FloorPlan; material: MaterialSet; activeFloor: number; showCeiling: boolean; selectedId?: string; onSelect: (id: string) => void; interiors: boolean }) {
  const y = plan.elevation; const h = 9; const cx = room.x + room.width / 2; const cz = room.y + room.depth / 2;
  const visible = activeFloor === -1 || activeFloor === plan.level;
  if (!visible) return null;
  return <group>
    <mesh position={[cx, y + .04, cz]} receiveShadow onClick={e => { e.stopPropagation(); onSelect(room.id); }}>
      <boxGeometry args={[room.width - .08, .08, room.depth - .08]} /><meshStandardMaterial color={selectedId === room.id ? "#F2A17D" : material.floor} roughness={.76} />
    </mesh>
    {showCeiling && <mesh position={[cx, y + h, cz]} receiveShadow><boxGeometry args={[room.width, .08, room.depth]} /><meshStandardMaterial color={material.ceiling} transparent opacity={.9} /></mesh>}
    {interiors && <Furniture room={room} y={y} color={material.accent} />}
    <Text position={[cx, y + .08, cz]} rotation={[-Math.PI/2, 0, 0]} fontSize={.24} color="#3E4D45" anchorX="center" anchorY="middle">{room.name}</Text>
  </group>;
}

export default function HouseViewer({ plans, materials, selectedId, onSelect, activeFloor, showCeiling, cutaway, mode, interiors }: { plans: FloorPlan[]; materials: Record<string, MaterialSet>; selectedId?: string; onSelect: (id: string) => void; activeFloor: number; showCeiling: boolean; cutaway: boolean; mode: "orbit" | "walk"; interiors: boolean }) {
  const width = plans[0]?.width || 14; const depth = plans[0]?.depth || 18;
  return <div className="three-canvas">
    <Canvas shadows camera={{ position: [width * 1.15, 12, depth * 1.2], fov: 42 }} onPointerMissed={() => onSelect("")}>
      <color attach="background" args={["#E9EFE9"]} />
      <ambientLight intensity={1.25} /><directionalLight position={[10, 18, 8]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
      <Suspense fallback={null}>
        <group position={[-width/2, 0, -depth/2]}>
          {plans.flatMap(plan => {
            const visible = activeFloor === -1 || activeFloor === plan.level;
            if (!visible) return [];
            const geometry = buildPlan3DGeometry(plan);
            const walls = cutaway ? geometry.walls.filter(wall => !(wall.kind === "exterior" && (wall.x1 >= plan.width - 0.03 || wall.z1 >= plan.depth - 0.03))) : geometry.walls;
            return [
              ...plan.rooms.map(room => <RoomGeometry key={room.id} room={room} plan={plan} material={materials[room.id]} activeFloor={activeFloor} showCeiling={showCeiling} selectedId={selectedId} onSelect={onSelect} interiors={interiors} />),
              ...walls.map(wall => <SharedWall key={wall.id} wall={wall} y={plan.elevation} selectedId={selectedId} onSelect={onSelect} />),
            ];
          })}
        </group>
        <Environment preset="apartment" />
      </Suspense>
      <Grid args={[80, 80]} cellSize={1} cellThickness={.5} cellColor="#9DAAA2" sectionSize={5} sectionThickness={1} sectionColor="#728078" fadeDistance={55} infiniteGrid />
      {mode === "orbit" ? <OrbitControls makeDefault target={[0, 2.5, 0]} maxPolarAngle={Math.PI / 2.02} /> : <FirstPersonControls makeDefault movementSpeed={4} lookSpeed={.08} />}
    </Canvas>
  </div>;
}
