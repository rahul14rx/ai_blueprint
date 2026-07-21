"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Environment, Grid, OrbitControls, PointerLockControls, Text } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState } from "react";
import { Vector3 } from "three";
import { FloorPlan, MaterialSet, Room } from "./studio-types";
import { buildPlan3DGeometry, WallSegment3D } from "./plan-3d-geometry";
import { getDoorLeafPlacement, getEntryPath, getMainEntryPlacement, getPlanOpeningPlacements, OpeningPlacement } from "./plan-openings";

const WALK_EYE_HEIGHT = 5.5;

function getWalkSpawn(plan: FloorPlan): { position: [number, number, number]; lookAt: [number, number, number] } {
  const eyeY = plan.elevation + WALK_EYE_HEIGHT;
  const toWorld = (lx: number, lz: number): [number, number, number] => [lx - plan.width / 2, eyeY, lz - plan.depth / 2];
  const entry = getMainEntryPlacement(plan);

  if (entry) {
    const { room, opening } = entry;
    const cx = room.x + room.width / 2;
    const cz = room.y + room.depth / 2;
    const inset = 2;
    let lx = cx;
    let lz = cz;
    if (opening.wall === "north") lz = Math.min(room.y + room.depth - 1.2, room.y + inset);
    else if (opening.wall === "south") lz = Math.max(room.y + 1.2, room.y + room.depth - inset);
    else if (opening.wall === "west") lx = Math.min(room.x + room.width - 1.2, room.x + inset);
    else lx = Math.max(room.x + 1.2, room.x + room.width - inset);

    const lookLX = lx + (opening.wall === "west" ? 4 : opening.wall === "east" ? -4 : 0);
    const lookLZ = lz + (opening.wall === "north" ? 4 : opening.wall === "south" ? -4 : 0);
    return { position: toWorld(lx, lz), lookAt: toWorld(lookLX, lookLZ) };
  }

  const foyer = plan.rooms.find(room => room.type === "foyer" || room.type === "hallway" || room.type === "living");
  const room = foyer ?? plan.rooms[0];
  const lx = room ? room.x + room.width / 2 : plan.width / 2;
  const lz = room ? room.y + room.depth / 2 : plan.depth / 2;
  return { position: toWorld(lx, lz), lookAt: toWorld(lx + 2, lz + 2) };
}

function WalkMovement({ active, eyeY, speed = 10 }: { active: boolean; eyeY: number; speed?: number }) {
  const keys = useRef({ forward: false, back: false, left: false, right: false });

  useEffect(() => {
    if (!active) return;
    const movementKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const setKey = (code: string, down: boolean) => {
      if (code === "KeyW" || code === "ArrowUp") keys.current.forward = down;
      if (code === "KeyS" || code === "ArrowDown") keys.current.back = down;
      if (code === "KeyA" || code === "ArrowLeft") keys.current.left = down;
      if (code === "KeyD" || code === "ArrowRight") keys.current.right = down;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!movementKeys.has(event.code)) return;
      event.preventDefault();
      setKey(event.code, true);
    };
    const onKeyUp = (event: KeyboardEvent) => setKey(event.code, false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      keys.current = { forward: false, back: false, left: false, right: false };
    };
  }, [active]);

  useFrame(({ camera }, delta) => {
    if (!active) return;
    const { forward: moveForward, back, left, right: moveRight } = keys.current;
    const forward = new Vector3();
    const right = new Vector3();
    const up = new Vector3(0, 1, 0);
    if (moveForward || back || left || moveRight) {
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 0) forward.normalize();
      right.crossVectors(forward, up).normalize();
      const step = speed * delta;
      if (moveForward) camera.position.addScaledVector(forward, step);
      if (back) camera.position.addScaledVector(forward, -step);
      if (left) camera.position.addScaledVector(right, -step);
      if (moveRight) camera.position.addScaledVector(right, step);
    }
    camera.position.y = eyeY;
  });

  return null;
}

function WalkCameraRig({ plan, active }: { plan: FloorPlan; active: boolean }) {
  const camera = useThree(state => state.camera);

  useEffect(() => {
    if (!active) return;
    const spawn = getWalkSpawn(plan);
    camera.position.set(...spawn.position);
    camera.lookAt(...spawn.lookAt);
  }, [active, plan, camera]);

  return null;
}

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

function EntryWalkway({ plan, showLabel }: { plan: FloorPlan; showLabel: boolean }) {
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
    {showLabel && <Text position={[x, plan.elevation + 0.19, z]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.45} color="#53695B" anchorX="center" anchorY="middle">ENTRY PATH</Text>}
  </group>;
}

function Furniture({ room, y, color }: { room: Room; y: number; color: string }) {
  if (room.type === "bathroom" || room.type === "stairs" || room.type === "hallway") return null;
  // Units are feet — size furniture like real pieces so rooms don't look empty/congested.
  const maxW = room.type === "living" || room.type === "dining" ? 9 : room.type === "bedroom" ? 7 : 6;
  const maxD = room.type === "living" || room.type === "dining" ? 4.5 : room.type === "bedroom" ? 5.5 : 3.2;
  const w = Math.min(room.width * 0.42, maxW);
  const d = Math.min(room.depth * 0.3, maxD);
  const height = room.type === "bedroom" ? 1.4 : 1.1;
  return <group position={[room.x + room.width / 2, y + height / 2 + 0.08, room.y + room.depth / 2]}>
    <mesh castShadow><boxGeometry args={[w, height, d]} /><meshStandardMaterial color={color} roughness={.55} /></mesh>
    {room.type === "kitchen" && <mesh position={[0, 1.1, 0]} castShadow><boxGeometry args={[w * .75, 2.2, 1.4]} /><meshStandardMaterial color="#E9E4DA" /></mesh>}
  </group>;
}

function Staircase({ room, y, selected, onSelect }: { room: Room; y: number; selected: boolean; onSelect: (id: string) => void }) {
  const alongZ = room.depth >= room.width;
  const steps = Math.max(7, Math.min(12, Math.floor((alongZ ? room.depth : room.width) / 1.05)));
  const run = Math.max(0.55, Math.min(1.05, (alongZ ? room.depth : room.width) * 0.74 / steps));
  const stairWidth = Math.max(2.8, Math.min((alongZ ? room.width : room.depth) * 0.64, 5.2));
  const startX = room.x + room.width / 2;
  const startZ = room.y + room.depth / 2;
  const totalRun = run * steps;
  const baseOffset = -totalRun / 2 + run / 2;
  const rotationY = alongZ ? 0 : Math.PI / 2;
  const color = selected ? "#EF7545" : "#D8BE82";
  const railLength = totalRun + 0.3;
  const railOffset = stairWidth / 2 + 0.28;

  return <group position={[startX, y + 0.22, startZ]} rotation={[0, rotationY, 0]} onClick={event => { event.stopPropagation(); onSelect(room.id); }}>
    {Array.from({ length: steps }, (_, index) => {
      const height = 0.18 + index * 0.22;
      const z = baseOffset + index * run;
      return <mesh key={`${room.id}-step-${index}`} position={[0, height / 2, z]} castShadow receiveShadow>
        <boxGeometry args={[stairWidth, height, run * 0.92]} />
        <meshStandardMaterial color={color} roughness={0.68} />
      </mesh>;
    })}
    <mesh position={[0, 1.65, totalRun / 2 - run * 0.8]} castShadow receiveShadow>
      <boxGeometry args={[stairWidth + 0.35, 0.16, run * 1.35]} />
      <meshStandardMaterial color={selected ? "#EF7545" : "#BCA26A"} roughness={0.7} />
    </mesh>
    {[-railOffset, railOffset].map((x, index) => <group key={`${room.id}-rail-${index}`} position={[x, 1.15, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.08, 0.12, railLength]} />
        <meshStandardMaterial color="#6B5A3D" roughness={0.55} />
      </mesh>
      <mesh position={[0, -0.55, -railLength / 2 + 0.25]} castShadow>
        <boxGeometry args={[0.09, 1.1, 0.09]} />
        <meshStandardMaterial color="#6B5A3D" roughness={0.55} />
      </mesh>
      <mesh position={[0, -0.35, railLength / 2 - 0.25]} castShadow>
        <boxGeometry args={[0.09, 1.5, 0.09]} />
        <meshStandardMaterial color="#6B5A3D" roughness={0.55} />
      </mesh>
    </group>)}
    <Text position={[0, 0.08, -totalRun / 2 - 0.8]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.42} color="#5B4931" anchorX="center" anchorY="middle">UP</Text>
    <mesh position={[0, 0.1, -totalRun / 2 - 0.15]} rotation={[0, 0, Math.PI / 4]} receiveShadow>
      <boxGeometry args={[0.55, 0.05, 0.12]} />
      <meshStandardMaterial color="#5B4931" roughness={0.5} />
    </mesh>
  </group>;
}

function RoomLabel({ room, y, selected, onSelect, visible }: { room: Room; y: number; selected: boolean; onSelect: (id: string) => void; visible: boolean }) {
  if (!visible) return null;
  const cx = room.x + room.width / 2;
  const cz = room.y + room.depth / 2;
  const smallestSide = Math.min(room.width, room.depth);
  // Skip labels in skinny corridors — they make the model look congested.
  if (smallestSide < 6) return null;
  const fontSize = Math.max(0.9, Math.min(1.8, smallestSide * 0.09));
  const maxWidth = Math.max(5, Math.min(room.width, room.depth) * 0.8);

  return <Billboard position={[cx, y + 10.2, cz]} follow lockX={false} lockY={false} lockZ={false}>
    <Text
      fontSize={fontSize}
      maxWidth={maxWidth}
      lineHeight={0.92}
      textAlign="center"
      color={selected ? "#EF7545" : "#17352B"}
      outlineColor="#FFFDF4"
      outlineWidth={0.08}
      anchorX="center"
      anchorY="middle"
      onClick={event => { event.stopPropagation(); onSelect(room.id); }}
    >
      {room.name.toUpperCase()}
    </Text>
  </Billboard>;
}

function RoomGeometry({ room, plan, material, activeFloor, showCeiling, selectedId, onSelect, interiors, showLabels }: { room: Room; plan: FloorPlan; material: MaterialSet; activeFloor: number; showCeiling: boolean; selectedId?: string; onSelect: (id: string) => void; interiors: boolean; showLabels: boolean }) {
  const y = plan.elevation; const h = 9; const cx = room.x + room.width / 2; const cz = room.y + room.depth / 2;
  const visible = activeFloor === -1 || activeFloor === plan.level;
  const selected = selectedId === room.id;
  if (!visible) return null;
  return <group>
    <mesh position={[cx, y + .105, cz]} receiveShadow onClick={e => { e.stopPropagation(); onSelect(room.id); }}>
      <boxGeometry args={[room.width - .18, .026, room.depth - .18]} />
      <meshStandardMaterial color={selected ? "#F2A17D" : room.color} transparent opacity={selected ? 0.82 : 0.34} roughness={.82} />
    </mesh>
    {showCeiling && <mesh position={[cx, y + h, cz]} receiveShadow><boxGeometry args={[room.width, .08, room.depth]} /><meshStandardMaterial color={material.ceiling} transparent opacity={.9} /></mesh>}
    {interiors && <Furniture room={room} y={y} color={material.accent} />}
    {interiors && room.type === "stairs" && <Staircase room={room} y={y} selected={selected} onSelect={onSelect} />}
    <RoomLabel room={room} y={y} selected={selected} onSelect={onSelect} visible={showLabels} />
  </group>;
}

export default function HouseViewer({ plans, materials, selectedId, onSelect, activeFloor, showCeiling, cutaway, mode, interiors }: { plans: FloorPlan[]; materials: Record<string, MaterialSet>; selectedId?: string; onSelect: (id: string) => void; activeFloor: number; showCeiling: boolean; cutaway: boolean; mode: "orbit" | "walk"; interiors: boolean }) {
  const plan = plans[0];
  const width = plan?.width || 14;
  const depth = plan?.depth || 18;
  const span = Math.max(width, depth);
  const walking = mode === "walk";
  const eyeY = (plan?.elevation ?? 0) + WALK_EYE_HEIGHT;
  // Frame closer and higher so the house fills the view instead of reading as a tiny congested diagram.
  const cameraDistance = span * 0.72;
  const cameraHeight = Math.max(28, span * 0.62);
  const lightReach = span * 1.2;
  const [walkLocked, setWalkLocked] = useState(false);

  useEffect(() => {
    if (walking) return;
    document.exitPointerLock?.();
  }, [walking]);

  return <div className={`three-canvas${walking ? " walk-mode" : ""}`}>
    {walking && <div className="walk-hint">{walkLocked ? "WASD to move · Esc to release mouse" : "Click canvas to look · WASD to move"}</div>}
    <Canvas shadows camera={{ position: [cameraDistance, cameraHeight, cameraDistance], fov: walking ? 72 : 36 }} onPointerMissed={() => !walking && onSelect("")}>
      <color attach="background" args={["#DDE9D6"]} />
      <ambientLight intensity={1.25} /><directionalLight position={[lightReach * 0.6, lightReach, lightReach * 0.45]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
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
              <EntryWalkway key={`${plan.id}-entry-path`} plan={plan} showLabel={!walking} />,
              ...plan.rooms.map(room => <RoomGeometry key={room.id} room={room} plan={plan} material={materials[room.id]} activeFloor={activeFloor} showCeiling={showCeiling} selectedId={selectedId} onSelect={onSelect} interiors={interiors} showLabels={!walking} />),
              ...walls.map(wall => <SharedWall key={wall.id} wall={wall} y={plan.elevation} selectedId={selectedId} onSelect={onSelect} />),
              ...getPlanOpeningPlacements(plan).map(placement => <OpeningMarker key={placement.opening.id} placement={placement} y={plan.elevation} selectedId={selectedId} onSelect={onSelect} />),
            ];
          })}
        </group>
        <Environment preset="apartment" />
      </Suspense>
      {!walking && <Grid args={[Math.max(120, span * 3), Math.max(120, span * 3)]} cellSize={2} cellThickness={.25} cellColor="#89A177" sectionSize={10} sectionThickness={0.45} sectionColor="#68825E" fadeDistance={span * 2.5} infiniteGrid />}
      {plan && walking && <>
        <WalkCameraRig plan={plan} active={walking} />
        <WalkMovement active={walking} eyeY={eyeY} />
        <PointerLockControls
          makeDefault
          selector=".three-canvas.walk-mode canvas"
          onLock={() => setWalkLocked(true)}
          onUnlock={() => setWalkLocked(false)}
        />
      </>}
      {mode === "orbit" && <OrbitControls makeDefault target={[0, 3, 0]} maxPolarAngle={Math.PI / 2.05} minDistance={span * 0.35} maxDistance={span * 1.8} />}
    </Canvas>
  </div>;
}
