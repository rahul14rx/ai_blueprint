"use client";
import { Canvas } from "@react-three/fiber";
import { Environment, FirstPersonControls, Grid, OrbitControls, Text } from "@react-three/drei";
import { Suspense } from "react";
import { FloorPlan, MaterialSet, Room } from "./studio-types";
import { buildPlan3DGeometry, WallSegment3D } from "./plan-3d-geometry";
import { getDoorLeafPlacement, getEntryPath, getPlanOpeningPlacements, OpeningPlacement } from "./plan-openings";

function Wall({ position, size, color, id, selected, onSelect }: { position: [number, number, number]; size: [number, number, number]; color: string; id: string; selected: boolean; onSelect: (id: string) => void }) {
  return <mesh position={position} castShadow receiveShadow onClick={e => { e.stopPropagation(); onSelect(id); }}>
    <boxGeometry args={size} /><meshStandardMaterial color={selected ? "#EF7545" : color} roughness={.72} />
  </mesh>;
}

function GrassGround({ width, depth }: { width: number; depth: number }) {
  const siteSize = Math.max(width, depth) * 3;
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, 0]} receiveShadow>
    <planeGeometry args={[siteSize, siteSize, 24, 24]} />
    <meshStandardMaterial color="#6F8F62" roughness={0.96} />
  </mesh>;
}

function SharedWall({ wall, y, selectedId, onSelect }: { wall: WallSegment3D; y: number; selectedId?: string; onSelect: (id: string) => void }) {
  const length = wall.orientation === "horizontal" ? wall.x2 - wall.x1 : wall.z2 - wall.z1;
  const position: [number, number, number] = wall.orientation === "horizontal"
    ? [(wall.x1 + wall.x2) / 2, y + wall.bottom + wall.height / 2, wall.z1]
    : [wall.x1, y + wall.bottom + wall.height / 2, (wall.z1 + wall.z2) / 2];
  const size: [number, number, number] = wall.orientation === "horizontal"
    ? [length, wall.height, wall.thickness]
    : [wall.thickness, wall.height, length];
  const color = wall.kind === "exterior" ? "#F5F2EA" : "#FFFFFF";

  return <Wall id={wall.id} selected={selectedId === wall.id} onSelect={onSelect} position={position} size={size} color={color} />;
}

function OpeningMarker({ placement, y, selectedId, onSelect }: { placement: OpeningPlacement; y: number; selectedId?: string; onSelect: (id: string) => void }) {
  const { opening } = placement;
  const length = placement.end - placement.start;
  const horizontal = placement.orientation === "horizontal";
  const id = `opening-${opening.id}`;
  const isSelected = selectedId === id;

  if (opening.kind === "door") {
    const position: [number, number, number] = horizontal
      ? [placement.center, y + 0.08, placement.coord]
      : [placement.coord, y + 0.08, placement.center];
    const size: [number, number, number] = horizontal ? [length, 0.16, 0.34] : [0.34, 0.16, length];
    const isPassage = opening.id.startsWith("passage-");
    const isGarage = placement.room.type === "garage";
    const leaf = getDoorLeafPlacement(placement);
    const doorHeight = isGarage ? 7.2 : 6.9;
    const doorColor = isSelected ? "#EF7545" : isGarage ? "#626C68" : "#855D3B";

    return <group onClick={event => { event.stopPropagation(); onSelect(id); }}>
      <mesh position={position} receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={isSelected ? "#EF7545" : isPassage ? "#D7B08B" : "#C8643C"} roughness={0.62} />
      </mesh>
      {isGarage && <mesh position={horizontal ? [placement.center, y + doorHeight / 2, placement.coord] : [placement.coord, y + doorHeight / 2, placement.center]} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [length, doorHeight, 0.18] : [0.18, doorHeight, length]} />
        <meshStandardMaterial color={doorColor} roughness={0.72} />
      </mesh>}
      {!isGarage && !isPassage && <group position={[leaf.hingeX, y + doorHeight / 2, leaf.hingeZ]} rotation={[0, leaf.rotationY, 0]}>
        <mesh position={leaf.orientation === "horizontal" ? [leaf.length / 2, 0, 0] : [0, 0, leaf.length / 2]} castShadow receiveShadow>
          <boxGeometry args={leaf.orientation === "horizontal" ? [leaf.length, doorHeight, 0.16] : [0.16, doorHeight, leaf.length]} />
          <meshStandardMaterial color={doorColor} roughness={0.58} />
        </mesh>
        <mesh position={leaf.orientation === "horizontal" ? [leaf.length * 0.82, 0.2, 0.12] : [0.12, 0.2, leaf.length * 0.82]} castShadow>
          <boxGeometry args={[0.16, 0.16, 0.16]} />
          <meshStandardMaterial color="#2F312D" roughness={0.35} />
        </mesh>
      </group>}
    </group>;
  }

  const height = opening.kind === "window" ? 2.35 : 1.1;
  const sill = opening.kind === "window" ? 3.2 : 6.2;
  const position: [number, number, number] = horizontal
    ? [placement.center, y + sill + height / 2, placement.coord]
    : [placement.coord, y + sill + height / 2, placement.center];
  const size: [number, number, number] = horizontal ? [length, height, 0.08] : [0.08, height, length];

  return <mesh position={position} onClick={event => { event.stopPropagation(); onSelect(id); }}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={isSelected ? "#7FC7DC" : "#A9D6DF"} transparent opacity={0.62} roughness={0.25} />
  </mesh>;
}

function FloorSlab({ plan, material }: { plan: FloorPlan; material?: MaterialSet }) {
  const y = plan.elevation;
  const cx = plan.width / 2;
  const cz = plan.depth / 2;
  const floorColor = material?.floor ?? "#D5D0C6";

  return <group>
    <mesh position={[cx, y - 0.04, cz]} receiveShadow>
      <boxGeometry args={[plan.width + 0.5, 0.16, plan.depth + 0.5]} />
      <meshStandardMaterial color="#BFB8A9" roughness={0.82} />
    </mesh>
    <mesh position={[cx, y + 0.055, cz]} receiveShadow>
      <boxGeometry args={[plan.width, 0.045, plan.depth]} />
      <meshStandardMaterial color={floorColor} roughness={0.78} />
    </mesh>
  </group>;
}

function EntryWalkway({ plan }: { plan: FloorPlan }) {
  const path = getEntryPath(plan);
  if (!path) return null;

  const x = (path.x1 + path.x2) / 2;
  const z = (path.z1 + path.z2) / 2;
  const width = Math.abs(path.x2 - path.x1);
  const depth = Math.abs(path.z2 - path.z1);

  return <group>
    <mesh position={[x, plan.elevation + 0.12, z]} receiveShadow>
      <boxGeometry args={[width, 0.1, depth]} />
      <meshStandardMaterial color="#C9BFA9" roughness={0.88} />
    </mesh>
    <Text position={[x, plan.elevation + 0.19, z]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.45} color="#53695B" anchorX="center" anchorY="middle">ENTRY PATH</Text>
  </group>;
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
    <mesh position={[cx, y + .105, cz]} receiveShadow onClick={e => { e.stopPropagation(); onSelect(room.id); }}>
      <boxGeometry args={[room.width - .18, .026, room.depth - .18]} />
      <meshStandardMaterial color={selectedId === room.id ? "#F2A17D" : room.color} transparent opacity={selectedId === room.id ? 0.82 : 0.34} roughness={.82} />
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
      <color attach="background" args={["#DDE9D6"]} />
      <ambientLight intensity={1.25} /><directionalLight position={[10, 18, 8]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
      <Suspense fallback={null}>
        <GrassGround width={width} depth={depth} />
        <group position={[-width/2, 0, -depth/2]}>
          {plans.flatMap(plan => {
            const visible = activeFloor === -1 || activeFloor === plan.level;
            if (!visible) return [];
            const geometry = buildPlan3DGeometry(plan);
            const walls = cutaway ? geometry.walls.filter(wall => !(wall.kind === "exterior" && (wall.x1 >= plan.width - 0.03 || wall.z1 >= plan.depth - 0.03))) : geometry.walls;
            const firstMaterial = materials[plan.rooms[0]?.id];
            return [
              <FloorSlab key={`${plan.id}-slab`} plan={plan} material={firstMaterial} />,
              <EntryWalkway key={`${plan.id}-entry-path`} plan={plan} />,
              ...plan.rooms.map(room => <RoomGeometry key={room.id} room={room} plan={plan} material={materials[room.id]} activeFloor={activeFloor} showCeiling={showCeiling} selectedId={selectedId} onSelect={onSelect} interiors={interiors} />),
              ...walls.map(wall => <SharedWall key={wall.id} wall={wall} y={plan.elevation} selectedId={selectedId} onSelect={onSelect} />),
              ...getPlanOpeningPlacements(plan).map(placement => <OpeningMarker key={placement.opening.id} placement={placement} y={plan.elevation} selectedId={selectedId} onSelect={onSelect} />),
            ];
          })}
        </group>
        <Environment preset="apartment" />
      </Suspense>
      <Grid args={[80, 80]} cellSize={1} cellThickness={.25} cellColor="#89A177" sectionSize={5} sectionThickness={0.45} sectionColor="#68825E" fadeDistance={55} infiniteGrid />
      {mode === "orbit" ? <OrbitControls makeDefault target={[0, 2.5, 0]} maxPolarAngle={Math.PI / 2.02} /> : <FirstPersonControls makeDefault movementSpeed={4} lookSpeed={.08} />}
    </Canvas>
  </div>;
}
