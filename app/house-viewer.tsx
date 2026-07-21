"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls, PointerLockControls, Text } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, Color, Vector3 } from "three";
import { FloorPlan, MaterialSet, Room } from "./studio-types";
import { buildPlan3DGeometry, WallSegment3D } from "./plan-3d-geometry";
import { getDoorLeafPlacement, getEntryPath, getMainEntryPlacement, getPlanOpeningPlacements, OpeningPlacement } from "./plan-openings";

const WALK_EYE_HEIGHT = 5.4;
const ROOM_HEIGHT = 9;
const PLAYER_RADIUS = 0.72;

type WalkKeys = { forward: boolean; back: boolean; left: boolean; right: boolean };
const MOVEMENT_KEY_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

type WallCollider = { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };

const PALETTE = {
  exterior: "#EDE8DF",
  interior: "#F7F4EE",
  trim: "#D9D2C4",
  slab: "#B7AFA2",
  wood: "#8B6B4A",
  woodDark: "#6A4F38",
  glass: "#9EC4D4",
  site: "#7F9678",
  siteDeep: "#6E8568",
  path: "#D4CBB8",
  sky: "#D6DFE4",
  ceiling: "#F7F5F1",
};

const DEFAULT_MATERIAL: MaterialSet = { wall: PALETTE.interior, floor: "#D2C9B8", ceiling: PALETTE.ceiling, accent: "#BFAE98" };

function getWalkSpawn(plan: FloorPlan): { position: [number, number, number]; lookAt: [number, number, number] } {
  const eyeY = plan.elevation + WALK_EYE_HEIGHT;
  const toWorld = (lx: number, lz: number): [number, number, number] => [lx - plan.width / 2, eyeY, lz - plan.depth / 2];
  const entry = getMainEntryPlacement(plan);

  if (entry) {
    const { room, opening } = entry;
    const cx = room.x + room.width / 2;
    const cz = room.y + room.depth / 2;
    const inset = 2.4;
    let lx = cx;
    let lz = cz;
    if (opening.wall === "north") lz = Math.min(room.y + room.depth - 1.4, room.y + inset);
    else if (opening.wall === "south") lz = Math.max(room.y + 1.4, room.y + room.depth - inset);
    else if (opening.wall === "west") lx = Math.min(room.x + room.width - 1.4, room.x + inset);
    else lx = Math.max(room.x + 1.4, room.x + room.width - inset);

    const lookLX = lx + (opening.wall === "west" ? 5 : opening.wall === "east" ? -5 : 0);
    const lookLZ = lz + (opening.wall === "north" ? 5 : opening.wall === "south" ? -5 : 0);
    return { position: toWorld(lx, lz), lookAt: toWorld(lookLX, lookLZ) };
  }

  const foyer = plan.rooms.find(room => room.type === "foyer" || room.type === "hallway" || room.type === "living");
  const room = foyer ?? plan.rooms[0];
  const lx = room ? room.x + room.width / 2 : plan.width / 2;
  const lz = room ? room.y + room.depth / 2 : plan.depth / 2;
  return { position: toWorld(lx, lz), lookAt: toWorld(lx + 2, lz + 2) };
}

function getWalkTargetY(plans: FloorPlan[], width: number, depth: number, worldX: number, worldZ: number, currentY: number) {
  const localX = worldX + width / 2;
  const localZ = worldZ + depth / 2;
  const orderedPlans = [...plans].sort((a, b) => a.elevation - b.elevation);

  for (let index = 0; index < orderedPlans.length - 1; index += 1) {
    const plan = orderedPlans[index];
    const nextPlan = orderedPlans[index + 1];
    const stairRoom = plan.rooms.find(room => room.type === "stairs");
    if (!stairRoom) continue;
    const insideStair = localX >= stairRoom.x && localX <= stairRoom.x + stairRoom.width && localZ >= stairRoom.y && localZ <= stairRoom.y + stairRoom.depth;
    if (!insideStair) continue;
    const alongZ = stairRoom.depth >= stairRoom.width;
    const rawProgress = alongZ ? (localZ - stairRoom.y) / stairRoom.depth : (localX - stairRoom.x) / stairRoom.width;
    const progress = Math.max(0, Math.min(1, rawProgress));
    return plan.elevation + WALK_EYE_HEIGHT + progress * (nextPlan.elevation - plan.elevation);
  }

  return orderedPlans.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(currentY - (nearest.elevation + WALK_EYE_HEIGHT));
    const candidateDistance = Math.abs(currentY - (candidate.elevation + WALK_EYE_HEIGHT));
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, orderedPlans[0]).elevation + WALK_EYE_HEIGHT;
}

function buildWallColliders(plans: FloorPlan[], width: number, depth: number): WallCollider[] {
  const offsetX = -width / 2;
  const offsetZ = -depth / 2;
  const colliders: WallCollider[] = [];

  for (const plan of plans) {
    const walls = buildPlan3DGeometry(plan).walls;
    for (const wall of walls) {
      // Skip high lintels — only block with mass the body can hit.
      if (wall.bottom > 4.5) continue;
      const half = wall.thickness / 2 + 0.08;
      const minY = plan.elevation + wall.bottom;
      const maxY = plan.elevation + wall.bottom + wall.height;
      if (wall.orientation === "horizontal") {
        colliders.push({
          minX: Math.min(wall.x1, wall.x2) + offsetX,
          maxX: Math.max(wall.x1, wall.x2) + offsetX,
          minZ: wall.z1 - half + offsetZ,
          maxZ: wall.z1 + half + offsetZ,
          minY,
          maxY,
        });
      } else {
        colliders.push({
          minX: wall.x1 - half + offsetX,
          maxX: wall.x1 + half + offsetX,
          minZ: Math.min(wall.z1, wall.z2) + offsetZ,
          maxZ: Math.max(wall.z1, wall.z2) + offsetZ,
          minY,
          maxY,
        });
      }
    }
  }
  return colliders;
}

function hitsWall(x: number, y: number, z: number, radius: number, colliders: WallCollider[]) {
  const bodyMinY = y - WALK_EYE_HEIGHT + 0.35;
  const bodyMaxY = y - 0.35;
  for (const collider of colliders) {
    if (bodyMaxY < collider.minY || bodyMinY > collider.maxY) continue;
    const nearestX = Math.max(collider.minX, Math.min(x, collider.maxX));
    const nearestZ = Math.max(collider.minZ, Math.min(z, collider.maxZ));
    const dx = x - nearestX;
    const dz = z - nearestZ;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

function pushOutOfWalls(x: number, y: number, z: number, radius: number, colliders: WallCollider[]) {
  let nextX = x;
  let nextZ = z;
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (const collider of colliders) {
      const bodyMinY = y - WALK_EYE_HEIGHT + 0.35;
      const bodyMaxY = y - 0.35;
      if (bodyMaxY < collider.minY || bodyMinY > collider.maxY) continue;
      const nearestX = Math.max(collider.minX, Math.min(nextX, collider.maxX));
      const nearestZ = Math.max(collider.minZ, Math.min(nextZ, collider.maxZ));
      const dx = nextX - nearestX;
      const dz = nextZ - nearestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= radius * radius || distSq < 1e-8) continue;
      const dist = Math.sqrt(distSq);
      const push = (radius - dist) + 0.05;
      nextX += (dx / dist) * push;
      nextZ += (dz / dist) * push;
      moved = true;
    }
    if (!moved) break;
  }
  return { x: nextX, z: nextZ };
}

function resolveWalkPosition(x: number, y: number, z: number, colliders: WallCollider[]) {
  if (!hitsWall(x, y, z, PLAYER_RADIUS, colliders)) return { x, y, z };
  for (let ring = 1; ring <= 12; ring += 1) {
    const step = ring * 0.85;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const candidateX = x + Math.cos(angle) * step;
      const candidateZ = z + Math.sin(angle) * step;
      if (!hitsWall(candidateX, y, candidateZ, PLAYER_RADIUS, colliders)) {
        return { x: candidateX, y, z: candidateZ };
      }
    }
  }
  const pushed = pushOutOfWalls(x, y, z, PLAYER_RADIUS, colliders);
  return { x: pushed.x, y, z: pushed.z };
}

function collidersForWalkLevel(plans: FloorPlan[], width: number, depth: number, eyeY: number) {
  const activePlan = [...plans].sort((a, b) => {
    const aDistance = Math.abs(eyeY - (a.elevation + WALK_EYE_HEIGHT));
    const bDistance = Math.abs(eyeY - (b.elevation + WALK_EYE_HEIGHT));
    return aDistance - bDistance;
  })[0];
  return buildWallColliders(activePlan ? [activePlan] : plans, width, depth);
}

function getWalkPlan(plans: FloorPlan[], focusFloor: number | null) {
  if (focusFloor !== null) return plans.find(item => item.level === focusFloor) ?? plans[0];
  return [...plans].sort((a, b) => a.elevation - b.elevation)[0] ?? plans[0];
}

function setWalkKey(keys: { current: WalkKeys }, code: string, down: boolean) {
  if (code === "KeyW" || code === "ArrowUp") keys.current.forward = down;
  if (code === "KeyS" || code === "ArrowDown") keys.current.back = down;
  if (code === "KeyA" || code === "ArrowLeft") keys.current.left = down;
  if (code === "KeyD" || code === "ArrowRight") keys.current.right = down;
}

function fadeProps(opacity: number) {
  const faded = opacity < 0.99;
  return { transparent: faded, opacity, depthWrite: !faded };
}

function floorTone(room: Room, material?: MaterialSet) {
  if (material?.floor) return material.floor;
  if (room.type === "bathroom" || room.type === "utility" || room.type === "laundry") return "#E4E0D8";
  if (room.type === "kitchen") return "#E8E2D6";
  if (room.type === "bedroom") return "#D9CFC0";
  if (room.type === "garage") return "#C9C6BF";
  return "#D2C9B8";
}

function WalkMovement({ active, plans, width, depth, colliders, speed = 8.5 }: { active: boolean; plans: FloorPlan[]; width: number; depth: number; colliders: WallCollider[]; speed?: number }) {
  const camera = useThree(state => state.camera);
  const keys = useRef<WalkKeys>({ forward: false, back: false, left: false, right: false });
  const forward = useMemo(() => new Vector3(), []);
  const right = useMemo(() => new Vector3(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);
  const fallbackForward = useMemo(() => new Vector3(0, 0, -1), []);

  useEffect(() => {
    if (!active) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!MOVEMENT_KEY_CODES.has(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      setWalkKey(keys, event.code, true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!MOVEMENT_KEY_CODES.has(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      setWalkKey(keys, event.code, false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      keys.current = { forward: false, back: false, left: false, right: false };
    };
  }, [active]);

  useFrame((_, delta) => {
    if (!active) return;
    const { forward: moveForward, back, left, right: moveRight } = keys.current;
    const targetY = getWalkTargetY(plans, width, depth, camera.position.x, camera.position.z, camera.position.y);
    camera.position.y += (targetY - camera.position.y) * Math.min(1, delta * 7);
    const levelColliders = collidersForWalkLevel(plans, width, depth, camera.position.y);

    if (moveForward || back || left || moveRight) {
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.copy(fallbackForward);
      forward.normalize();
      right.crossVectors(forward, up).normalize();
      const step = speed * delta;
      let nextX = camera.position.x;
      let nextZ = camera.position.z;
      if (moveForward) { nextX += forward.x * step; nextZ += forward.z * step; }
      if (back) { nextX -= forward.x * step; nextZ -= forward.z * step; }
      if (left) { nextX -= right.x * step; nextZ -= right.z * step; }
      if (moveRight) { nextX += right.x * step; nextZ += right.z * step; }

      const y = camera.position.y;
      if (!hitsWall(nextX, y, camera.position.z, PLAYER_RADIUS, levelColliders)) camera.position.x = nextX;
      if (!hitsWall(camera.position.x, y, nextZ, PLAYER_RADIUS, levelColliders)) camera.position.z = nextZ;
    }

    const cleared = pushOutOfWalls(camera.position.x, camera.position.y, camera.position.z, PLAYER_RADIUS, levelColliders);
    camera.position.x = cleared.x;
    camera.position.z = cleared.z;
  });

  return null;
}

function WalkCameraRig({ plan, active, colliders }: { plan: FloorPlan; active: boolean; colliders: WallCollider[] }) {
  const camera = useThree(state => state.camera);

  useEffect(() => {
    if (!active) return;
    const spawn = getWalkSpawn(plan);
    const cleared = resolveWalkPosition(spawn.position[0], spawn.position[1], spawn.position[2], colliders);
    camera.position.set(cleared.x, cleared.y, cleared.z);
    camera.lookAt(...spawn.lookAt);
  }, [active, plan, camera, colliders]);

  return null;
}

function FocusFraming({ elevation, span, active }: { elevation: number; span: number; active: boolean }) {
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls) as { target?: Vector3; update?: () => void } | null;

  useEffect(() => {
    if (!active) return;
    const distance = span * 0.78;
    const height = Math.max(26, span * 0.55) + elevation;
    camera.position.set(distance, height, distance * 0.92);
    const targetY = elevation + 2.8;
    camera.lookAt(0, targetY, 0);
    if (controls?.target) {
      controls.target.set(0, targetY, 0);
      controls.update?.();
    }
  }, [active, elevation, span, camera, controls]);

  return null;
}

function SceneTone() {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.08;
    gl.shadowMap.enabled = true;
    scene.background = new Color(PALETTE.sky);
    scene.fog = null;
  }, [gl, scene]);
  return null;
}

function Wall({ position, size, color, id, selected, onSelect, opacity = 1 }: { position: [number, number, number]; size: [number, number, number]; color: string; id: string; selected: boolean; onSelect: (id: string) => void; opacity?: number }) {
  return <mesh position={position} castShadow={opacity > 0.5} receiveShadow={opacity > 0.5} onClick={e => { e.stopPropagation(); onSelect(id); }}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={selected ? "#C4785A" : color} {...fadeProps(opacity)} roughness={0.88} metalness={0.02} />
  </mesh>;
}

function SiteGround({ width, depth }: { width: number; depth: number }) {
  const siteSize = Math.max(width, depth) * 3.2;
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.22, 0]} receiveShadow>
      <planeGeometry args={[siteSize, siteSize]} />
      <meshStandardMaterial color={PALETTE.site} roughness={0.98} metalness={0} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]} receiveShadow>
      <circleGeometry args={[Math.max(width, depth) * 0.92, 64]} />
      <meshStandardMaterial color={PALETTE.siteDeep} roughness={0.97} metalness={0} />
    </mesh>
  </group>;
}

function SharedWall({ wall, y, selectedId, onSelect, opacity = 1 }: { wall: WallSegment3D; y: number; selectedId?: string; onSelect: (id: string) => void; opacity?: number }) {
  const length = wall.orientation === "horizontal" ? wall.x2 - wall.x1 : wall.z2 - wall.z1;
  const position: [number, number, number] = wall.orientation === "horizontal"
    ? [(wall.x1 + wall.x2) / 2, y + wall.bottom + wall.height / 2, wall.z1]
    : [wall.x1, y + wall.bottom + wall.height / 2, (wall.z1 + wall.z2) / 2];
  const size: [number, number, number] = wall.orientation === "horizontal"
    ? [length, wall.height, wall.thickness]
    : [wall.thickness, wall.height, length];
  const color = wall.kind === "exterior" ? PALETTE.exterior : PALETTE.interior;

  return <Wall id={wall.id} selected={selectedId === wall.id} onSelect={onSelect} position={position} size={size} color={color} opacity={opacity} />;
}

function OpeningMarker({ placement, y, selectedId, onSelect, opacity = 1 }: { placement: OpeningPlacement; y: number; selectedId?: string; onSelect: (id: string) => void; opacity?: number }) {
  const { opening } = placement;
  const length = placement.end - placement.start;
  const horizontal = placement.orientation === "horizontal";
  const id = `opening-${opening.id}`;
  const isSelected = selectedId === id;

  if (opening.kind === "door") {
    const position: [number, number, number] = horizontal
      ? [placement.center, y + 0.06, placement.coord]
      : [placement.coord, y + 0.06, placement.center];
    const size: [number, number, number] = horizontal ? [length, 0.12, 0.28] : [0.28, 0.12, length];
    const isPassage = opening.id.startsWith("passage-");
    const isGarage = placement.room.type === "garage";
    const leaf = getDoorLeafPlacement(placement);
    const doorHeight = isGarage ? 7.2 : 6.9;
    const doorColor = isSelected ? "#C4785A" : isGarage ? "#6E736F" : PALETTE.wood;

    return <group onClick={event => { event.stopPropagation(); onSelect(id); }}>
      <mesh position={position} receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={isSelected ? "#C4785A" : isPassage ? "#CDB89A" : "#B08968"} {...fadeProps(opacity)} roughness={0.7} />
      </mesh>
      {isGarage && <mesh position={horizontal ? [placement.center, y + doorHeight / 2, placement.coord] : [placement.coord, y + doorHeight / 2, placement.center]} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [length, doorHeight, 0.16] : [0.16, doorHeight, length]} />
        <meshStandardMaterial color={doorColor} {...fadeProps(opacity)} roughness={0.78} metalness={0.08} />
      </mesh>}
      {!isGarage && !isPassage && <group position={[leaf.hingeX, y + doorHeight / 2, leaf.hingeZ]} rotation={[0, leaf.rotationY, 0]}>
        <mesh position={leaf.orientation === "horizontal" ? [leaf.length / 2, 0, 0] : [0, 0, leaf.length / 2]} castShadow receiveShadow>
          <boxGeometry args={leaf.orientation === "horizontal" ? [leaf.length, doorHeight, 0.14] : [0.14, doorHeight, leaf.length]} />
          <meshStandardMaterial color={doorColor} {...fadeProps(opacity)} roughness={0.62} metalness={0.04} />
        </mesh>
        <mesh position={leaf.orientation === "horizontal" ? [leaf.length * 0.82, 0.15, 0.1] : [0.1, 0.15, leaf.length * 0.82]} castShadow>
          <boxGeometry args={[0.12, 0.12, 0.12]} />
          <meshStandardMaterial color="#2C2E2B" {...fadeProps(opacity)} roughness={0.3} metalness={0.4} />
        </mesh>
      </group>}
    </group>;
  }

  const height = opening.kind === "window" ? 2.45 : 1.1;
  const sill = opening.kind === "window" ? 3.15 : 6.2;
  const position: [number, number, number] = horizontal
    ? [placement.center, y + sill + height / 2, placement.coord]
    : [placement.coord, y + sill + height / 2, placement.center];
  const frameSize: [number, number, number] = horizontal ? [length + 0.16, height + 0.16, 0.14] : [0.14, height + 0.16, length + 0.16];
  const glassSize: [number, number, number] = horizontal ? [length - 0.08, height - 0.08, 0.04] : [0.04, height - 0.08, length - 0.08];

  return <group onClick={event => { event.stopPropagation(); onSelect(id); }}>
    <mesh position={position} castShadow>
      <boxGeometry args={frameSize} />
      <meshStandardMaterial color={isSelected ? "#8FB8C9" : PALETTE.trim} {...fadeProps(opacity)} roughness={0.7} />
    </mesh>
    <mesh position={position}>
      <boxGeometry args={glassSize} />
      <meshStandardMaterial color={PALETTE.glass} transparent opacity={0.42 * opacity} roughness={0.12} metalness={0.15} depthWrite={false} />
    </mesh>
  </group>;
}

function FloorSlab({ plan, material, opacity = 1 }: { plan: FloorPlan; material?: MaterialSet; opacity?: number }) {
  const y = plan.elevation;
  const cx = plan.width / 2;
  const cz = plan.depth / 2;
  const floorColor = material?.floor ?? "#D2C9B8";

  return <group>
    <mesh position={[cx, y - 0.05, cz]} receiveShadow={opacity > 0.5} castShadow={opacity > 0.5}>
      <boxGeometry args={[plan.width + 0.7, 0.2, plan.depth + 0.7]} />
      <meshStandardMaterial color={PALETTE.slab} {...fadeProps(opacity)} roughness={0.92} />
    </mesh>
    <mesh position={[cx, y + 0.04, cz]} receiveShadow={opacity > 0.5}>
      <boxGeometry args={[plan.width, 0.04, plan.depth]} />
      <meshStandardMaterial color={floorColor} {...fadeProps(opacity)} roughness={0.82} metalness={0.02} />
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

  return <mesh position={[x, plan.elevation + 0.1, z]} receiveShadow castShadow>
    <boxGeometry args={[width, 0.08, depth]} />
    <meshStandardMaterial color={PALETTE.path} roughness={0.9} />
  </mesh>;
}

function Furniture({ room, y, opacity = 1 }: { room: Room; y: number; opacity?: number }) {
  if (room.type === "bathroom" || room.type === "stairs" || room.type === "hallway" || room.type === "foyer" || room.type === "garage") return null;

  const cx = room.x + room.width / 2;
  const cz = room.y + room.depth / 2;

  if (room.type === "bedroom") {
    const w = Math.min(room.width * 0.38, 6.5);
    const d = Math.min(room.depth * 0.42, 7);
    return <group position={[cx, y + 0.08, cz]}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 1.1, d]} />
        <meshStandardMaterial color="#C9B8A4" {...fadeProps(opacity)} roughness={0.78} />
      </mesh>
      <mesh position={[0, 1.25, -d * 0.28]} castShadow>
        <boxGeometry args={[w * 0.92, 0.45, d * 0.28]} />
        <meshStandardMaterial color="#EDE6DC" {...fadeProps(opacity)} roughness={0.85} />
      </mesh>
      <mesh position={[-w * 0.55, 1.1, -d * 0.1]} castShadow>
        <boxGeometry args={[1.4, 2.2, 1.4]} />
        <meshStandardMaterial color={PALETTE.woodDark} {...fadeProps(opacity)} roughness={0.65} />
      </mesh>
    </group>;
  }

  if (room.type === "kitchen") {
    const run = Math.min(room.width * 0.7, 12);
    return <group position={[cx, y + 0.08, cz]}>
      <mesh position={[0, 1.55, room.depth * 0.28]} castShadow receiveShadow>
        <boxGeometry args={[run, 3.0, 2.0]} />
        <meshStandardMaterial color="#ECE7DF" {...fadeProps(opacity)} roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh position={[0, 1.55, -room.depth * 0.22]} castShadow receiveShadow>
        <boxGeometry args={[run * 0.55, 3.0, 2.0]} />
        <meshStandardMaterial color="#E4DFD6" {...fadeProps(opacity)} roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh position={[0, 3.2, room.depth * 0.28]} castShadow>
        <boxGeometry args={[run * 0.45, 0.08, 2.2]} />
        <meshStandardMaterial color="#C7C2B8" {...fadeProps(opacity)} roughness={0.35} metalness={0.25} />
      </mesh>
    </group>;
  }

  if (room.type === "living" || room.type === "dining" || room.type === "open") {
    const sofaW = Math.min(room.width * 0.42, 9);
    const sofaD = Math.min(room.depth * 0.22, 3.4);
    return <group position={[cx, y + 0.08, cz]}>
      <mesh position={[0, 0.85, sofaD * 0.6]} castShadow receiveShadow>
        <boxGeometry args={[sofaW, 1.7, sofaD]} />
        <meshStandardMaterial color="#9A8B78" {...fadeProps(opacity)} roughness={0.82} />
      </mesh>
      <mesh position={[0, 0.7, -sofaD * 0.8]} castShadow receiveShadow>
        <boxGeometry args={[sofaW * 0.55, 1.2, sofaD * 0.85]} />
        <meshStandardMaterial color="#B7A894" {...fadeProps(opacity)} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.95, 0]} castShadow>
        <boxGeometry args={[sofaW * 0.38, 0.55, sofaD * 0.7]} />
        <meshStandardMaterial color={PALETTE.wood} {...fadeProps(opacity)} roughness={0.55} />
      </mesh>
    </group>;
  }

  const w = Math.min(room.width * 0.35, 5);
  const d = Math.min(room.depth * 0.28, 3.2);
  return <group position={[cx, y + 0.7, cz]}>
    <mesh castShadow receiveShadow>
      <boxGeometry args={[w, 1.2, d]} />
      <meshStandardMaterial color="#BFAE98" {...fadeProps(opacity)} roughness={0.75} />
    </mesh>
  </group>;
}

function Staircase({ room, y, selected, onSelect, opacity = 1, rise = 3.2, showLabel }: { room: Room; y: number; selected: boolean; onSelect: (id: string) => void; opacity?: number; rise?: number; showLabel: boolean }) {
  const alongZ = room.depth >= room.width;
  const steps = Math.max(10, Math.min(14, Math.floor((alongZ ? room.depth : room.width) / 0.95)));
  const run = Math.max(0.55, Math.min(0.95, (alongZ ? room.depth : room.width) * 0.78 / steps));
  const stairWidth = Math.max(2.8, Math.min((alongZ ? room.width : room.depth) * 0.62, 5));
  const startX = room.x + room.width / 2;
  const startZ = room.y + room.depth / 2;
  const totalRun = run * steps;
  const baseOffset = -totalRun / 2 + run / 2;
  const rotationY = alongZ ? 0 : Math.PI / 2;
  const color = selected ? "#C4785A" : "#C4A574";
  const railLength = totalRun + 0.25;
  const railOffset = stairWidth / 2 + 0.22;

  return <group position={[startX, y + 0.18, startZ]} rotation={[0, rotationY, 0]} onClick={event => { event.stopPropagation(); onSelect(room.id); }}>
    {Array.from({ length: steps }, (_, index) => {
      const stairHeight = Math.min(rise - 0.18, Math.max(0.16, (rise / steps) * (index + 1)));
      const z = baseOffset + index * run;
      return <mesh key={`${room.id}-step-${index}`} position={[0, stairHeight / 2, z]} castShadow receiveShadow>
        <boxGeometry args={[stairWidth, stairHeight, run * 0.9]} />
        <meshStandardMaterial color={color} {...fadeProps(opacity)} roughness={0.72} />
      </mesh>;
    })}
    <mesh position={[0, rise - 0.05, totalRun / 2 - run * 0.7]} castShadow receiveShadow>
      <boxGeometry args={[stairWidth + 0.25, 0.12, run * 1.2]} />
      <meshStandardMaterial color={selected ? "#C4785A" : "#B89564"} {...fadeProps(opacity)} roughness={0.7} />
    </mesh>
    {[-railOffset, railOffset].map((x, index) => <group key={`${room.id}-rail-${index}`} position={[x, rise * 0.42, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.07, 0.1, railLength]} />
        <meshStandardMaterial color="#5C5042" {...fadeProps(opacity)} roughness={0.5} metalness={0.15} />
      </mesh>
      <mesh position={[0, -rise * 0.18, -railLength / 2 + 0.2]} castShadow>
        <boxGeometry args={[0.07, rise * 0.45, 0.07]} />
        <meshStandardMaterial color="#5C5042" {...fadeProps(opacity)} roughness={0.5} metalness={0.15} />
      </mesh>
      <mesh position={[0, -rise * 0.08, railLength / 2 - 0.2]} castShadow>
        <boxGeometry args={[0.07, rise * 0.55, 0.07]} />
        <meshStandardMaterial color="#5C5042" {...fadeProps(opacity)} roughness={0.5} metalness={0.15} />
      </mesh>
    </group>)}
    {showLabel && <Text position={[0, 0.06, -totalRun / 2 - 0.7]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.32} color="#6B5E4E" anchorX="center" anchorY="middle" fillOpacity={0.55}>Up</Text>}
  </group>;
}

function RoomLabel({ room, y, selected, onSelect, visible }: { room: Room; y: number; selected: boolean; onSelect: (id: string) => void; visible: boolean }) {
  if (!visible) return null;
  const cx = room.x + room.width / 2;
  const cz = room.y + room.depth / 2;
  const smallestSide = Math.min(room.width, room.depth);
  if (smallestSide < 7) return null;
  const fontSize = Math.max(0.55, Math.min(1.05, smallestSide * 0.055));

  return <Text
    position={[cx, y + 0.12, cz]}
    rotation={[-Math.PI / 2, 0, 0]}
    fontSize={fontSize}
    color={selected ? "#C4785A" : "#5C675F"}
    fillOpacity={selected ? 0.9 : 0.45}
    anchorX="center"
    anchorY="middle"
    onClick={event => { event.stopPropagation(); onSelect(room.id); }}
  >
    {room.name}
  </Text>;
}

function RoomGeometry({ room, plan, material, activeFloor, showCeiling, selectedId, onSelect, interiors, showLabels, opacity = 1, stairRise = 3.2, presentation }: { room: Room; plan: FloorPlan; material: MaterialSet; activeFloor: number; showCeiling: boolean; selectedId?: string; onSelect: (id: string) => void; interiors: boolean; showLabels: boolean; opacity?: number; stairRise?: number; presentation: boolean }) {
  const y = plan.elevation;
  const h = ROOM_HEIGHT;
  const cx = room.x + room.width / 2;
  const cz = room.y + room.depth / 2;
  const visible = activeFloor === -1 || activeFloor === plan.level;
  const selected = selectedId === room.id;
  if (!visible) return null;

  const tone = floorTone(room, material);
  const floorOpacity = presentation ? (selected ? 0.92 : 0.98) : (selected ? 0.88 : 0.55);

  return <group>
    <mesh position={[cx, y + 0.09, cz]} receiveShadow onClick={e => { e.stopPropagation(); onSelect(room.id); }}>
      <boxGeometry args={[room.width - 0.2, 0.03, room.depth - 0.2]} />
      <meshStandardMaterial
        color={selected ? "#E8C4B0" : presentation ? tone : room.color}
        transparent={!presentation || selected}
        opacity={floorOpacity * opacity}
        depthWrite={opacity >= 0.99}
        roughness={0.86}
        metalness={0.02}
      />
    </mesh>
    {/* subtle skirting */}
    {presentation && opacity > 0.9 && <>
      <mesh position={[cx, y + 0.28, room.y + 0.12]} receiveShadow>
        <boxGeometry args={[room.width - 0.35, 0.35, 0.08]} />
        <meshStandardMaterial color={PALETTE.trim} roughness={0.75} />
      </mesh>
      <mesh position={[cx, y + 0.28, room.y + room.depth - 0.12]} receiveShadow>
        <boxGeometry args={[room.width - 0.35, 0.35, 0.08]} />
        <meshStandardMaterial color={PALETTE.trim} roughness={0.75} />
      </mesh>
    </>}
    {showCeiling && <mesh position={[cx, y + h - 0.04, cz]} receiveShadow>
      <boxGeometry args={[room.width - 0.1, 0.08, room.depth - 0.1]} />
      <meshStandardMaterial color={material.ceiling || PALETTE.ceiling} transparent opacity={0.96 * opacity} depthWrite={opacity >= 0.99} roughness={0.92} />
    </mesh>}
    {interiors && <Furniture room={room} y={y} opacity={opacity} />}
    {interiors && room.type === "stairs" && <Staircase room={room} y={y} selected={selected} onSelect={onSelect} opacity={opacity} rise={stairRise} showLabel={!presentation} />}
    <RoomLabel room={room} y={y} selected={selected} onSelect={onSelect} visible={showLabels && opacity > 0.75} />
  </group>;
}

export default function HouseViewer({ plans, materials, selectedId, onSelect, activeFloor, showCeiling, cutaway, mode, interiors, focusFloor = null }: { plans: FloorPlan[]; materials: Record<string, MaterialSet>; selectedId?: string; onSelect: (id: string) => void; activeFloor: number; showCeiling: boolean; cutaway: boolean; mode: "orbit" | "walk"; interiors: boolean; focusFloor?: number | null }) {
  const walkPlan = getWalkPlan(plans, focusFloor);
  const plan = walkPlan;
  const width = plan?.width || 14;
  const depth = plan?.depth || 18;
  const span = Math.max(width, depth);
  const focusElevation = plan?.elevation ?? 0;
  const walking = mode === "walk";
  const presentation = true;
  const cameraDistance = span * 0.78;
  const cameraHeight = Math.max(26, span * 0.55) + focusElevation;
  const lightReach = span * 1.35;
  const renderPlans = focusFloor === null ? plans : plans.filter(item => item.level === focusFloor);
  const [walkLocked, setWalkLocked] = useState(false);
  const colliders = useMemo(
    () => buildWallColliders(walkPlan ? [walkPlan] : plans, width, depth),
    [walkPlan, plans, width, depth],
  );

  useEffect(() => {
    if (!walking) {
      document.exitPointerLock?.();
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, [walking]);

  return <div className={`three-canvas${walking ? " walk-mode" : ""}`}>
    {walking && <div className="walk-hint">{walkLocked ? "WASD move · walls block · Esc release mouse" : "Click canvas to look · WASD move · click outside text boxes first"}</div>}
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
      camera={{ position: [cameraDistance, cameraHeight, cameraDistance * 0.92], fov: walking ? 68 : 38 }}
      onPointerMissed={() => !walking && onSelect("")}
    >
      <SceneTone />
      <hemisphereLight args={["#F5F2EA", "#7F9678", 0.62]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[lightReach * 0.55, lightReach * 0.95, lightReach * 0.35]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00015}
        shadow-normalBias={0.04}
        shadow-camera-near={1}
        shadow-camera-far={lightReach * 3}
        shadow-camera-left={-span * 1.2}
        shadow-camera-right={span * 1.2}
        shadow-camera-top={span * 1.2}
        shadow-camera-bottom={-span * 1.2}
      />
      <directionalLight position={[-lightReach * 0.4, lightReach * 0.5, -lightReach * 0.3]} intensity={0.45} color="#DDE6EF" />
      <Suspense fallback={null}>
        <SiteGround width={width} depth={depth} />
        <group position={[-width / 2, 0, -depth / 2]}>
          {renderPlans.flatMap(renderPlan => {
            const visible = activeFloor === -1 || activeFloor === renderPlan.level;
            if (!visible) return [];
            const hiddenEntryOpeningId = renderPlan.level > 0 ? getMainEntryPlacement(renderPlan)?.opening.id : "";
            const planForRender = hiddenEntryOpeningId ? { ...renderPlan, openings: renderPlan.openings.filter(opening => opening.id !== hiddenEntryOpeningId) } : renderPlan;
            const geometry = buildPlan3DGeometry(planForRender);
            const walls = cutaway ? geometry.walls.filter(wall => !(wall.kind === "exterior" && (wall.x1 >= planForRender.width - 0.03 || wall.z1 >= planForRender.depth - 0.03))) : geometry.walls;
            const firstMaterial = materials[planForRender.rooms[0]?.id] ?? DEFAULT_MATERIAL;
            const nextPlan = plans.find(candidate => candidate.level === planForRender.level + 1);
            const stairRise = nextPlan ? nextPlan.elevation - planForRender.elevation : 3.2;
            return [
              <FloorSlab key={`${planForRender.id}-slab`} plan={planForRender} material={firstMaterial} opacity={1} />,
              planForRender.level === 0 ? <EntryWalkway key={`${planForRender.id}-entry-path`} plan={planForRender} /> : null,
              ...planForRender.rooms.map(room => (
                <RoomGeometry
                  key={room.id}
                  room={room}
                  plan={planForRender}
                  material={materials[room.id] ?? DEFAULT_MATERIAL}
                  activeFloor={activeFloor}
                  showCeiling={showCeiling || walking}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  interiors={interiors}
                  showLabels={!walking}
                  opacity={1}
                  stairRise={stairRise}
                  presentation={presentation}
                />
              )),
              ...walls.map(wall => <SharedWall key={wall.id} wall={wall} y={planForRender.elevation} selectedId={selectedId} onSelect={onSelect} opacity={1} />),
              ...getPlanOpeningPlacements(planForRender).map(placement => <OpeningMarker key={placement.opening.id} placement={placement} y={planForRender.elevation} selectedId={selectedId} onSelect={onSelect} opacity={1} />),
            ];
          })}
        </group>
        <Environment preset="apartment" environmentIntensity={0.38} />
        {!walking && <ContactShadows position={[0, Math.max(0.01, focusElevation - 0.05), 0]} opacity={0.32} scale={span * 2.4} blur={2.4} far={span} />}
      </Suspense>
      {!walking && <FocusFraming elevation={focusElevation} span={span} active={!walking} />}
      {plan && walking && <>
        <WalkCameraRig plan={plan} active={walking} colliders={colliders} />
        <WalkMovement active={walking} plans={plans} width={width} depth={depth} colliders={colliders} />
        <PointerLockControls
          makeDefault
          selector=".three-canvas.walk-mode canvas"
          onLock={() => setWalkLocked(true)}
          onUnlock={() => setWalkLocked(false)}
        />
      </>}
      {mode === "orbit" && <OrbitControls makeDefault target={[0, focusElevation + 2.8, 0]} maxPolarAngle={Math.PI / 2.08} minDistance={span * 0.4} maxDistance={span * 2.1} enableDamping dampingFactor={0.08} />}
    </Canvas>
  </div>;
}
