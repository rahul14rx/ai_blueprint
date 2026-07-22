"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Environment, Grid, OrbitControls, PointerLockControls, Text } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Vector3 } from "three";
import { FloorPlan, MaterialSet, Room, RoofTemplate, WallSide } from "./studio-types";
import { buildPlan3DGeometry, WallSegment3D } from "./plan-3d-geometry";
import { getDoorLeafPlacement, getEntryPath, getMainEntryPlacement, getPlanOpeningPlacements, OpeningPlacement } from "./plan-openings";

const WALK_EYE_HEIGHT = 5.05;
const ROOM_HEIGHT = 9;
const WALK_RADIUS = 0.9;
const SPIRAL_ANGLE_START = -Math.PI * 0.68;
const SPIRAL_ANGLE_SPAN = Math.PI * 1.65;
const DOOR_INTERACTION_DISTANCE = 3.2;

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

function getWalkTargetY(plans: FloorPlan[], width: number, depth: number, worldX: number, worldZ: number, currentY: number) {
  const localX = worldX + width / 2;
  const localZ = worldZ + depth / 2;
  const orderedPlans = [...plans].sort((a, b) => a.elevation - b.elevation);
  const nearestPlanIndex = Math.max(0, orderedPlans.findIndex(plan => plan.id === nearestWalkPlan(orderedPlans, currentY).id));

  for (const index of [nearestPlanIndex, nearestPlanIndex - 1, nearestPlanIndex + 1]) {
    if (index < 0 || index >= orderedPlans.length - 1) continue;
    const plan = orderedPlans[index];
    const nextPlan = orderedPlans[index + 1];
    const stairRoom = plan.rooms.find(room => room.type === "stairs");
    if (!stairRoom) continue;
    const insideStair = localX >= stairRoom.x && localX <= stairRoom.x + stairRoom.width && localZ >= stairRoom.y && localZ <= stairRoom.y + stairRoom.depth;
    if (!insideStair) continue;
    const progress = getSpiralStairProgress(stairRoom, localX, localZ);
    return plan.elevation + WALK_EYE_HEIGHT + progress * (nextPlan.elevation - plan.elevation);
  }

  return orderedPlans.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(currentY - (nearest.elevation + WALK_EYE_HEIGHT));
    const candidateDistance = Math.abs(currentY - (candidate.elevation + WALK_EYE_HEIGHT));
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, orderedPlans[0]).elevation + WALK_EYE_HEIGHT;
}

function nearestWalkPlan(plans: FloorPlan[], currentY: number) {
  return [...plans].sort((a, b) => Math.abs(currentY - (a.elevation + WALK_EYE_HEIGHT)) - Math.abs(currentY - (b.elevation + WALK_EYE_HEIGHT)))[0] ?? plans[0];
}

function getSpiralStairProgress(room: Room, localX: number, localZ: number) {
  const centerX = room.x + room.width / 2;
  const centerZ = room.y + room.depth / 2;
  const angle = Math.atan2(localZ - centerZ, localX - centerX);
  const start = SPIRAL_ANGLE_START;
  const end = SPIRAL_ANGLE_START + SPIRAL_ANGLE_SPAN;
  const candidates = [-2, -1, 0, 1, 2].map(turn => angle + turn * Math.PI * 2);
  const unwrapped = candidates.reduce((best, candidate) => {
    const bestDistance = candidate < start ? start - candidate : candidate > end ? candidate - end : 0;
    const candidateDistance = best < start ? start - best : best > end ? best - end : 0;
    return candidateDistance < bestDistance ? candidate : best;
  }, candidates[0]);
  return Math.max(0, Math.min(1, (unwrapped - start) / SPIRAL_ANGLE_SPAN));
}

function isInteractiveDoor(placement: OpeningPlacement) {
  return placement.opening.kind === "door" && !placement.opening.id.startsWith("passage-");
}

function isBalconyDoorPlacement(placement: OpeningPlacement, plan: FloorPlan) {
  if (placement.room.type === "balcony") return true;
  return plan.rooms.some(room => room.type === "balcony" && roomSharedWall(placement.room, room) === placement.opening.wall);
}

function doorStateId(plan: FloorPlan, placement: OpeningPlacement) {
  return `${plan.id}:${placement.opening.id}`;
}

function doorBlockerSegment(placement: OpeningPlacement): WallSegment3D {
  const isGarage = placement.room.type === "garage";
  return placement.orientation === "horizontal"
    ? {
      id: `door-blocker-${placement.opening.id}`,
      kind: "interior",
      orientation: "horizontal",
      x1: placement.start,
      z1: placement.coord,
      x2: placement.end,
      z2: placement.coord,
      bottom: 0,
      height: isGarage ? 7.2 : 6.9,
      thickness: isGarage ? 0.36 : 0.22,
    }
    : {
      id: `door-blocker-${placement.opening.id}`,
      kind: "interior",
      orientation: "vertical",
      x1: placement.coord,
      z1: placement.start,
      x2: placement.coord,
      z2: placement.end,
      bottom: 0,
      height: isGarage ? 7.2 : 6.9,
      thickness: isGarage ? 0.36 : 0.22,
    };
}

function distanceToDoor(placement: OpeningPlacement, localX: number, localZ: number) {
  const along = placement.orientation === "horizontal" ? localX : localZ;
  const clampedAlong = Math.max(placement.start, Math.min(placement.end, along));
  const clampedAcross = placement.coord;
  const dx = placement.orientation === "horizontal" ? localX - clampedAlong : localX - clampedAcross;
  const dz = placement.orientation === "horizontal" ? localZ - clampedAcross : localZ - clampedAlong;
  return Math.hypot(dx, dz);
}

function nearestInteractiveDoor(placements: OpeningPlacement[], localX: number, localZ: number) {
  return placements.reduce<{ placement: OpeningPlacement | null; distance: number }>((nearest, placement) => {
    const distance = distanceToDoor(placement, localX, localZ);
    return distance < nearest.distance ? { placement, distance } : nearest;
  }, { placement: null, distance: DOOR_INTERACTION_DISTANCE }).placement;
}

function planWithoutUpperEntry(plan: FloorPlan) {
  const hiddenEntryOpeningId = plan.level > 0 ? getMainEntryPlacement(plan)?.opening.id : "";
  return hiddenEntryOpeningId ? { ...plan, openings: plan.openings.filter(opening => opening.id !== hiddenEntryOpeningId) } : plan;
}

function resolveWalkCollision(plan: FloorPlan, walls: WallSegment3D[], currentX: number, currentZ: number, desiredX: number, desiredZ: number) {
  const previousLocalX = currentX + plan.width / 2;
  const previousLocalZ = currentZ + plan.depth / 2;
  let localX = Math.max(WALK_RADIUS, Math.min(plan.width - WALK_RADIUS, desiredX + plan.width / 2));
  let localZ = Math.max(WALK_RADIUS, Math.min(plan.depth - WALK_RADIUS, desiredZ + plan.depth / 2));

  for (let pass = 0; pass < 3; pass += 1) {
    for (const wall of walls) {
      if (wall.bottom > WALK_EYE_HEIGHT || wall.bottom + wall.height < 1.2) continue;
      const buffer = WALK_RADIUS + wall.thickness / 2;
      const ax = wall.x1;
      const az = wall.z1;
      const bx = wall.x2;
      const bz = wall.z2;
      const vx = bx - ax;
      const vz = bz - az;
      const lengthSq = vx * vx + vz * vz;
      if (lengthSq <= 0.0001) continue;
      const t = Math.max(0, Math.min(1, ((localX - ax) * vx + (localZ - az) * vz) / lengthSq));
      const closestX = ax + vx * t;
      const closestZ = az + vz * t;
      let dx = localX - closestX;
      let dz = localZ - closestZ;
      let distance = Math.hypot(dx, dz);
      if (distance >= buffer) continue;
      if (distance < 0.0001) {
        dx = previousLocalX - closestX;
        dz = previousLocalZ - closestZ;
        distance = Math.hypot(dx, dz) || 1;
      }
      const push = buffer - distance;
      localX += (dx / distance) * push;
      localZ += (dz / distance) * push;
    }
    localX = Math.max(WALK_RADIUS, Math.min(plan.width - WALK_RADIUS, localX));
    localZ = Math.max(WALK_RADIUS, Math.min(plan.depth - WALK_RADIUS, localZ));
  }

  return { x: localX - plan.width / 2, z: localZ - plan.depth / 2 };
}

function WalkMovement({ active, plans, width, depth, openDoorIds, onToggleDoor, onDoorHintChange, speed = 10 }: { active: boolean; plans: FloorPlan[]; width: number; depth: number; openDoorIds: Set<string>; onToggleDoor: (id: string) => void; onDoorHintChange: (hint: string) => void; speed?: number }) {
  const keys = useRef({ forward: false, back: false, left: false, right: false });
  const nearbyDoor = useRef<OpeningPlacement | null>(null);
  const nearbyDoorPlan = useRef<FloorPlan | null>(null);
  const lastDoorHint = useRef("");
  const collisionPlans = useMemo(() => plans.map(plan => {
    const walkPlan = planWithoutUpperEntry(plan);
    const doorPlacements = getPlanOpeningPlacements(walkPlan, ["door"]).filter(placement => isInteractiveDoor(placement) && !isBalconyDoorPlacement(placement, walkPlan));
    const closedDoorWalls = doorPlacements.filter(placement => !openDoorIds.has(doorStateId(walkPlan, placement))).map(doorBlockerSegment);
    return { plan: walkPlan, walls: [...buildPlan3DGeometry(walkPlan).walls, ...closedDoorWalls], doorPlacements };
  }), [plans, openDoorIds]);

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
      if (event.code === "KeyE" && nearbyDoor.current && !event.repeat) {
        event.preventDefault();
        const doorPlan = nearbyDoorPlan.current;
        if (doorPlan) onToggleDoor(doorStateId(doorPlan, nearbyDoor.current));
        return;
      }
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
      nearbyDoor.current = null;
      nearbyDoorPlan.current = null;
      lastDoorHint.current = "";
      onDoorHintChange("");
    };
  }, [active, onDoorHintChange, onToggleDoor]);

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
      const desired = camera.position.clone();
      if (moveForward) desired.addScaledVector(forward, step);
      if (back) desired.addScaledVector(forward, -step);
      if (left) desired.addScaledVector(right, -step);
      if (moveRight) desired.addScaledVector(right, step);
      const activePlan = nearestWalkPlan(plans, camera.position.y);
      const collision = collisionPlans.find(item => item.plan.id === activePlan.id);
      const resolved = resolveWalkCollision(activePlan, collision?.walls ?? [], camera.position.x, camera.position.z, desired.x, desired.z);
      camera.position.x = resolved.x;
      camera.position.z = resolved.z;
    }
    const targetY = getWalkTargetY(plans, width, depth, camera.position.x, camera.position.z, camera.position.y);
    camera.position.y += (targetY - camera.position.y) * Math.min(1, delta * 7);

    const activePlan = nearestWalkPlan(plans, camera.position.y);
    const localX = camera.position.x + activePlan.width / 2;
    const localZ = camera.position.z + activePlan.depth / 2;
    const collision = collisionPlans.find(item => item.plan.id === activePlan.id);
    const door = nearestInteractiveDoor(collision?.doorPlacements ?? [], localX, localZ);
    nearbyDoor.current = door;
    nearbyDoorPlan.current = collision?.plan ?? null;
    const hint = door && collision ? `${openDoorIds.has(doorStateId(collision.plan, door)) ? "Press E to close" : "Press E to open"} ${door.room.name}` : "";
    if (hint !== lastDoorHint.current) {
      lastDoorHint.current = hint;
      onDoorHintChange(hint);
    }
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

function Wall({ position, size, color, id, selected, onSelect, opacity = 1 }: { position: [number, number, number]; size: [number, number, number]; color: string; id: string; selected: boolean; onSelect: (id: string) => void; opacity?: number }) {
  return <mesh position={position} castShadow={opacity > 0.5} receiveShadow={opacity > 0.5} onClick={e => { e.stopPropagation(); onSelect(id); }}>
    <boxGeometry args={size} /><meshStandardMaterial color={selected ? "#EF7545" : color} {...fadeProps(opacity)} roughness={.84} />
  </mesh>;
}

function GrassGround({ width, depth }: { width: number; depth: number }) {
  const siteSize = Math.max(width, depth) * 3;
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, 0]} receiveShadow>
    <planeGeometry args={[siteSize, siteSize, 24, 24]} />
    <meshStandardMaterial color="#6F8F62" roughness={0.96} />
  </mesh>;
}

function fadeProps(opacity: number) {
  const faded = opacity < 0.99;
  return { transparent: faded, opacity, depthWrite: !faded };
}

function getRoofBounds(plan: FloorPlan) {
  const roofRooms = plan.rooms.filter(room => room.type !== "balcony" && room.type !== "porch");
  const rooms = roofRooms.length ? roofRooms : plan.rooms;
  if (!rooms.length) return { minX: 0, maxX: plan.width, minZ: 0, maxZ: plan.depth };
  return rooms.reduce((bounds, room) => ({
    minX: Math.min(bounds.minX, room.x),
    maxX: Math.max(bounds.maxX, room.x + room.width),
    minZ: Math.min(bounds.minZ, room.y),
    maxZ: Math.max(bounds.maxZ, room.y + room.depth),
  }), { minX: rooms[0].x, maxX: rooms[0].x + rooms[0].width, minZ: rooms[0].y, maxZ: rooms[0].y + rooms[0].depth });
}

function createRoofSurface(points: Array<[number, number, number]>, indices: number[]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function RoofGeometry({ plan, template, opacity = 1 }: { plan: FloorPlan; template: RoofTemplate; opacity?: number }) {
  if (template === "none") return null;
  const bounds = getRoofBounds(plan);
  const overhang = 1.05;
  const roofY = plan.elevation + ROOM_HEIGHT + 0.38;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const roofWidth = bounds.maxX - bounds.minX + overhang * 2;
  const roofDepth = bounds.maxZ - bounds.minZ + overhang * 2;
  const roofColor = template === "designer" ? "#D8CDB8" : template === "flat" ? "#DAD4C8" : "#9D6842";
  const accentColor = template === "designer" ? "#6E816C" : "#6A4329";
  const roofOpacity = opacity;
  const roofMaterial = <meshStandardMaterial color={roofColor} roughness={0.72} metalness={0.02} {...fadeProps(roofOpacity)} />;
  const accentMaterial = <meshStandardMaterial color={accentColor} roughness={0.76} metalness={0.01} {...fadeProps(roofOpacity)} />;

  if (template === "flat") {
    const parapetHeight = 1.0;
    return <group>
      <mesh position={[centerX, roofY, centerZ]} castShadow receiveShadow>
        <boxGeometry args={[roofWidth, 0.32, roofDepth]} />
        {roofMaterial}
      </mesh>
      {[
        { position: [centerX, roofY + parapetHeight / 2, -overhang] as [number, number, number], size: [roofWidth, parapetHeight, 0.28] as [number, number, number] },
        { position: [centerX, roofY + parapetHeight / 2, plan.depth + overhang] as [number, number, number], size: [roofWidth, parapetHeight, 0.28] as [number, number, number] },
        { position: [-overhang, roofY + parapetHeight / 2, centerZ] as [number, number, number], size: [0.28, parapetHeight, roofDepth] as [number, number, number] },
        { position: [plan.width + overhang, roofY + parapetHeight / 2, centerZ] as [number, number, number], size: [0.28, parapetHeight, roofDepth] as [number, number, number] },
      ].map((edge, index) => <mesh key={`${plan.id}-flat-roof-${index}`} position={edge.position} castShadow receiveShadow>
        <boxGeometry args={edge.size} />
        {accentMaterial}
      </mesh>)}
    </group>;
  }

  if (template === "designer") {
    return <group>
      <mesh position={[centerX, roofY, centerZ]} castShadow receiveShadow>
        <boxGeometry args={[roofWidth, 0.3, roofDepth]} />
        {roofMaterial}
      </mesh>
      <mesh position={[plan.width * 0.74, roofY + 0.52, plan.depth * 0.28]} castShadow receiveShadow>
        <boxGeometry args={[Math.max(8, plan.width * 0.42), 0.5, Math.max(10, plan.depth * 0.36)]} />
        {accentMaterial}
      </mesh>
      <mesh position={[plan.width * 0.28, roofY + 0.42, plan.depth * 0.76]} rotation={[0, 0, -0.12]} castShadow receiveShadow>
        <boxGeometry args={[Math.max(9, plan.width * 0.48), 0.42, Math.max(8, plan.depth * 0.28)]} />
        <meshStandardMaterial color="#CBA77B" roughness={0.74} {...fadeProps(roofOpacity)} />
      </mesh>
    </group>;
  }

  if (template === "gable") {
    const left = bounds.minX - overhang;
    const right = bounds.maxX + overhang;
    const front = bounds.minZ - overhang;
    const back = bounds.maxZ + overhang;
    const eaveY = roofY + 0.26;
    const ridgeY = roofY + Math.max(3.2, Math.min(7.0, roofWidth * 0.15));
    const roofSurfaceMaterial = <meshStandardMaterial color="#A86E42" side={DoubleSide} roughness={0.78} metalness={0.01} />;
    const gableWallMaterial = <meshStandardMaterial color="#F0E8D9" side={DoubleSide} roughness={0.84} />;

    return <group>
      <mesh geometry={createRoofSurface([
        [left, eaveY, front],
        [centerX, ridgeY, front],
        [centerX, ridgeY, back],
        [left, eaveY, back],
      ], [0, 1, 2, 0, 2, 3])} castShadow receiveShadow>
        {roofSurfaceMaterial}
      </mesh>
      <mesh geometry={createRoofSurface([
        [centerX, ridgeY, front],
        [right, eaveY, front],
        [right, eaveY, back],
        [centerX, ridgeY, back],
      ], [0, 1, 2, 0, 2, 3])} castShadow receiveShadow>
        {roofSurfaceMaterial}
      </mesh>
      <mesh geometry={createRoofSurface([
        [left, eaveY - 0.08, front],
        [right, eaveY - 0.08, front],
        [centerX, ridgeY - 0.08, front],
      ], [0, 1, 2])} castShadow receiveShadow>
        {gableWallMaterial}
      </mesh>
      <mesh geometry={createRoofSurface([
        [right, eaveY - 0.08, back],
        [left, eaveY - 0.08, back],
        [centerX, ridgeY - 0.08, back],
      ], [0, 1, 2])} castShadow receiveShadow>
        {gableWallMaterial}
      </mesh>
      <mesh position={[centerX, ridgeY + 0.06, centerZ]} castShadow receiveShadow>
        <boxGeometry args={[0.36, 0.32, roofDepth + 0.42]} />
        {accentMaterial}
      </mesh>
      <mesh position={[left, eaveY - 0.04, centerZ]} castShadow receiveShadow>
        <boxGeometry args={[0.34, 0.5, roofDepth + 0.18]} />
        {accentMaterial}
      </mesh>
      <mesh position={[right, eaveY - 0.04, centerZ]} castShadow receiveShadow>
        <boxGeometry args={[0.34, 0.5, roofDepth + 0.18]} />
        {accentMaterial}
      </mesh>
      <mesh position={[centerX, eaveY - 0.06, front]} castShadow receiveShadow>
        <boxGeometry args={[roofWidth, 0.42, 0.28]} />
        {accentMaterial}
      </mesh>
      <mesh position={[centerX, eaveY - 0.06, back]} castShadow receiveShadow>
        <boxGeometry args={[roofWidth, 0.42, 0.28]} />
        {accentMaterial}
      </mesh>
    </group>;
  }

  if (template === "hip") {
    const left = bounds.minX - overhang;
    const right = bounds.maxX + overhang;
    const front = bounds.minZ - overhang;
    const back = bounds.maxZ + overhang;
    const eaveY = roofY + 0.26;
    const ridgeY = roofY + Math.max(3.0, Math.min(6.7, Math.min(roofWidth, roofDepth) * 0.22));
    const ridgeRunsDepth = roofDepth >= roofWidth;
    const ridgeHalf = ridgeRunsDepth
      ? Math.max(1.6, Math.max(0, roofDepth - roofWidth * 0.86) / 2)
      : Math.max(1.6, Math.max(0, roofWidth - roofDepth * 0.86) / 2);
    const roofSurfaceMaterial = <meshStandardMaterial color="#9B653F" side={DoubleSide} roughness={0.8} metalness={0.01} />;
    const edgeMaterial = <meshStandardMaterial color="#604026" roughness={0.78} metalness={0.01} />;

    if (ridgeRunsDepth) {
      const ridgeFront = centerZ - ridgeHalf;
      const ridgeBack = centerZ + ridgeHalf;
      return <group>
        <mesh geometry={createRoofSurface([[left, eaveY, front], [centerX, ridgeY, ridgeFront], [centerX, ridgeY, ridgeBack], [left, eaveY, back]], [0, 1, 2, 0, 2, 3])} castShadow receiveShadow>{roofSurfaceMaterial}</mesh>
        <mesh geometry={createRoofSurface([[centerX, ridgeY, ridgeFront], [right, eaveY, front], [right, eaveY, back], [centerX, ridgeY, ridgeBack]], [0, 1, 2, 0, 2, 3])} castShadow receiveShadow>{roofSurfaceMaterial}</mesh>
        <mesh geometry={createRoofSurface([[left, eaveY, front], [right, eaveY, front], [centerX, ridgeY, ridgeFront]], [0, 1, 2])} castShadow receiveShadow>{roofSurfaceMaterial}</mesh>
        <mesh geometry={createRoofSurface([[right, eaveY, back], [left, eaveY, back], [centerX, ridgeY, ridgeBack]], [0, 1, 2])} castShadow receiveShadow>{roofSurfaceMaterial}</mesh>
        <mesh position={[centerX, ridgeY + 0.06, centerZ]} castShadow receiveShadow><boxGeometry args={[0.32, 0.28, Math.max(1.2, ridgeBack - ridgeFront) + 0.45]} />{edgeMaterial}</mesh>
        {[
          { position: [left, eaveY - 0.04, centerZ] as [number, number, number], size: [0.32, 0.48, roofDepth] as [number, number, number] },
          { position: [right, eaveY - 0.04, centerZ] as [number, number, number], size: [0.32, 0.48, roofDepth] as [number, number, number] },
          { position: [centerX, eaveY - 0.04, front] as [number, number, number], size: [roofWidth, 0.48, 0.28] as [number, number, number] },
          { position: [centerX, eaveY - 0.04, back] as [number, number, number], size: [roofWidth, 0.48, 0.28] as [number, number, number] },
        ].map((edge, index) => <mesh key={`${plan.id}-hip-edge-${index}`} position={edge.position} castShadow receiveShadow><boxGeometry args={edge.size} />{edgeMaterial}</mesh>)}
      </group>;
    }

    const ridgeLeft = centerX - ridgeHalf;
    const ridgeRight = centerX + ridgeHalf;
    return <group>
      <mesh geometry={createRoofSurface([[left, eaveY, front], [ridgeLeft, ridgeY, centerZ], [ridgeRight, ridgeY, centerZ], [right, eaveY, front]], [0, 1, 2, 0, 2, 3])} castShadow receiveShadow>{roofSurfaceMaterial}</mesh>
      <mesh geometry={createRoofSurface([[right, eaveY, back], [ridgeRight, ridgeY, centerZ], [ridgeLeft, ridgeY, centerZ], [left, eaveY, back]], [0, 1, 2, 0, 2, 3])} castShadow receiveShadow>{roofSurfaceMaterial}</mesh>
      <mesh geometry={createRoofSurface([[left, eaveY, back], [left, eaveY, front], [ridgeLeft, ridgeY, centerZ]], [0, 1, 2])} castShadow receiveShadow>{roofSurfaceMaterial}</mesh>
      <mesh geometry={createRoofSurface([[right, eaveY, front], [right, eaveY, back], [ridgeRight, ridgeY, centerZ]], [0, 1, 2])} castShadow receiveShadow>{roofSurfaceMaterial}</mesh>
      <mesh position={[centerX, ridgeY + 0.06, centerZ]} castShadow receiveShadow><boxGeometry args={[Math.max(1.2, ridgeRight - ridgeLeft) + 0.45, 0.28, 0.32]} />{edgeMaterial}</mesh>
      {[
        { position: [left, eaveY - 0.04, centerZ] as [number, number, number], size: [0.32, 0.48, roofDepth] as [number, number, number] },
        { position: [right, eaveY - 0.04, centerZ] as [number, number, number], size: [0.32, 0.48, roofDepth] as [number, number, number] },
        { position: [centerX, eaveY - 0.04, front] as [number, number, number], size: [roofWidth, 0.48, 0.28] as [number, number, number] },
        { position: [centerX, eaveY - 0.04, back] as [number, number, number], size: [roofWidth, 0.48, 0.28] as [number, number, number] },
      ].map((edge, index) => <mesh key={`${plan.id}-hip-edge-wide-${index}`} position={edge.position} castShadow receiveShadow><boxGeometry args={edge.size} />{edgeMaterial}</mesh>)}
    </group>;
  }

  return null;
}

function SharedWall({ wall, y, selectedId, onSelect, opacity = 1, material }: { wall: WallSegment3D; y: number; selectedId?: string; onSelect: (id: string) => void; opacity?: number; material?: MaterialSet }) {
  const length = wall.orientation === "horizontal" ? wall.x2 - wall.x1 : wall.z2 - wall.z1;
  const position: [number, number, number] = wall.orientation === "horizontal"
    ? [(wall.x1 + wall.x2) / 2, y + wall.bottom + wall.height / 2, wall.z1]
    : [wall.x1, y + wall.bottom + wall.height / 2, (wall.z1 + wall.z2) / 2];
  const size: [number, number, number] = wall.orientation === "horizontal"
    ? [length, wall.height, wall.thickness]
    : [wall.thickness, wall.height, length];
  const color = wall.kind === "exterior" ? (material?.wall ?? "#EEE8DD") : "#DCD5C8";

  return <Wall id={wall.id} selected={selectedId === wall.id} onSelect={onSelect} position={position} size={size} color={color} opacity={opacity} />;
}

function sameLine(a: number, b: number) {
  return Math.abs(a - b) < 0.03;
}

function overlapLength(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

function roomSharedWall(a: Room, b: Room): WallSide | null {
  if (sameLine(a.x + a.width, b.x) && overlapLength(a.y, a.y + a.depth, b.y, b.y + b.depth) > 1) return "east";
  if (sameLine(a.x, b.x + b.width) && overlapLength(a.y, a.y + a.depth, b.y, b.y + b.depth) > 1) return "west";
  if (sameLine(a.y + a.depth, b.y) && overlapLength(a.x, a.x + a.width, b.x, b.x + b.width) > 1) return "south";
  if (sameLine(a.y, b.y + b.depth) && overlapLength(a.x, a.x + a.width, b.x, b.x + b.width) > 1) return "north";
  return null;
}

function balconyRailSides(room: Room, plan: FloorPlan): WallSide[] {
  if (room.type !== "balcony") return [];
  return (["north", "east", "south", "west"] as WallSide[]).filter(side => !plan.rooms.some(other => other.id !== room.id && roomSharedWall(room, other) === side));
}

function balconyRailIntervals(wall: WallSegment3D, plan: FloorPlan) {
  const intervals: Array<{ start: number; end: number }> = [];
  plan.rooms.filter(room => room.type === "balcony").forEach(room => {
    balconyRailSides(room, plan).forEach(side => {
      if (side === "north" && wall.orientation === "horizontal" && sameLine(wall.z1, room.y)) intervals.push({ start: room.x, end: room.x + room.width });
      if (side === "south" && wall.orientation === "horizontal" && sameLine(wall.z1, room.y + room.depth)) intervals.push({ start: room.x, end: room.x + room.width });
      if (side === "west" && wall.orientation === "vertical" && sameLine(wall.x1, room.x)) intervals.push({ start: room.y, end: room.y + room.depth });
      if (side === "east" && wall.orientation === "vertical" && sameLine(wall.x1, room.x + room.width)) intervals.push({ start: room.y, end: room.y + room.depth });
    });
  });
  return intervals;
}

function trimWallByIntervals(wall: WallSegment3D, intervals: Array<{ start: number; end: number }>) {
  if (wall.kind !== "exterior" || !intervals.length) return [wall];
  const wallStart = wall.orientation === "horizontal" ? wall.x1 : wall.z1;
  const wallEnd = wall.orientation === "horizontal" ? wall.x2 : wall.z2;
  let pieces = [{ start: wallStart, end: wallEnd }];

  intervals.forEach(interval => {
    pieces = pieces.flatMap(piece => {
      const start = Math.max(piece.start, interval.start);
      const end = Math.min(piece.end, interval.end);
      if (end - start <= 0.03) return [piece];
      return [
        { start: piece.start, end: start },
        { start: end, end: piece.end },
      ].filter(next => next.end - next.start > 0.05);
    });
  });

  return pieces.map((piece, index) => wall.orientation === "horizontal"
    ? { ...wall, id: `${wall.id}-balcony-trim-${index}`, x1: piece.start, x2: piece.end }
    : { ...wall, id: `${wall.id}-balcony-trim-${index}`, z1: piece.start, z2: piece.end });
}

function trimBalconyRailWalls(walls: WallSegment3D[], plan: FloorPlan) {
  return walls.flatMap(wall => trimWallByIntervals(wall, balconyRailIntervals(wall, plan)));
}

function BalconyRailing({ room, plan, y, selected, onSelect, opacity = 1 }: { room: Room; plan: FloorPlan; y: number; selected: boolean; onSelect: (id: string) => void; opacity?: number }) {
  const railColor = selected ? "#EF7545" : "#53695B";
  const curbColor = selected ? "#EF7545" : "#DAD2C1";
  const sides = balconyRailSides(room, plan);
  const railHeight = 3.2;
  const railThickness = 0.12;
  const makeRail = (side: WallSide) => {
    const horizontal = side === "north" || side === "south";
    const length = horizontal ? room.width : room.depth;
    const centerX = side === "west" ? room.x : side === "east" ? room.x + room.width : room.x + room.width / 2;
    const centerZ = side === "north" ? room.y : side === "south" ? room.y + room.depth : room.y + room.depth / 2;
    const postCount = Math.max(2, Math.ceil(length / 4) + 1);
    return <group key={`${room.id}-rail-${side}`}>
      <mesh position={[centerX, y + 0.48, centerZ]} castShadow receiveShadow onClick={event => { event.stopPropagation(); onSelect(room.id); }}>
        <boxGeometry args={horizontal ? [length, 0.9, 0.3] : [0.3, 0.9, length]} />
        <meshStandardMaterial color={curbColor} {...fadeProps(opacity)} roughness={0.74} />
      </mesh>
      <mesh position={[centerX, y + 1.95, centerZ]} receiveShadow>
        <boxGeometry args={horizontal ? [Math.max(0.4, length - 0.5), 1.55, 0.06] : [0.06, 1.55, Math.max(0.4, length - 0.5)]} />
        <meshStandardMaterial color="#BFD8D4" transparent opacity={0.34 * opacity} depthWrite={false} roughness={0.18} metalness={0.02} />
      </mesh>
      <mesh position={[centerX, y + railHeight, centerZ]} castShadow receiveShadow onClick={event => { event.stopPropagation(); onSelect(room.id); }}>
        <boxGeometry args={horizontal ? [length, railThickness, railThickness] : [railThickness, railThickness, length]} />
        <meshStandardMaterial color={railColor} {...fadeProps(opacity)} roughness={0.62} />
      </mesh>
      <mesh position={[centerX, y + railHeight * 0.55, centerZ]} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [length, railThickness, railThickness] : [railThickness, railThickness, length]} />
        <meshStandardMaterial color={railColor} {...fadeProps(opacity)} roughness={0.62} />
      </mesh>
      {Array.from({ length: postCount }, (_, index) => {
        const t = postCount === 1 ? 0.5 : index / (postCount - 1);
        const px = horizontal ? room.x + room.width * t : centerX;
        const pz = horizontal ? centerZ : room.y + room.depth * t;
        return <mesh key={`${room.id}-post-${side}-${index}`} position={[px, y + railHeight / 2, pz]} castShadow receiveShadow>
          <boxGeometry args={[0.16, railHeight, 0.16]} />
          <meshStandardMaterial color={railColor} {...fadeProps(opacity)} roughness={0.62} />
        </mesh>;
      })}
    </group>;
  };

  return <group>{sides.map(makeRail)}</group>;
}

function GhostFloorOutline({ walls, y }: { walls: WallSegment3D[]; y: number }) {
  return <group>
    {walls.map(wall => {
      const length = wall.orientation === "horizontal" ? wall.x2 - wall.x1 : wall.z2 - wall.z1;
      const position: [number, number, number] = wall.orientation === "horizontal"
        ? [(wall.x1 + wall.x2) / 2, y + 0.18, wall.z1]
        : [wall.x1, y + 0.18, (wall.z1 + wall.z2) / 2];
      const size: [number, number, number] = wall.orientation === "horizontal"
        ? [length, 0.1, wall.thickness * 1.4]
        : [wall.thickness * 1.4, 0.1, length];
      return <mesh key={`ghost-${wall.id}`} position={position}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={wall.kind === "exterior" ? "#2E4B3B" : "#7C8E7E"} transparent opacity={0.24} depthWrite={false} roughness={0.8} />
      </mesh>;
    })}
  </group>;
}

function OpeningMarker({ placement, y, selectedId, onSelect, opacity = 1, isOpen = false, alwaysOpen = false }: { placement: OpeningPlacement; y: number; selectedId?: string; onSelect: (id: string) => void; opacity?: number; isOpen?: boolean; alwaysOpen?: boolean }) {
  const { opening } = placement;
  const length = placement.end - placement.start;
  const horizontal = placement.orientation === "horizontal";
  const id = `opening-${opening.id}`;
  const isSelected = selectedId === id;
  const open = isOpen || alwaysOpen;

  if (opening.kind === "door") {
    const position: [number, number, number] = horizontal
      ? [placement.center, y + 0.08, placement.coord]
      : [placement.coord, y + 0.08, placement.center];
    const size: [number, number, number] = horizontal ? [length, 0.16, 0.34] : [0.34, 0.16, length];
    const isPassage = opening.id.startsWith("passage-");
    const isGarage = placement.room.type === "garage";
    const isBalconyStyle = alwaysOpen && !isGarage && !isPassage;
    const leaf = getDoorLeafPlacement(placement);
    const doorHeight = isGarage ? 7.2 : 6.9;
    const doorColor = isSelected ? "#EF7545" : isGarage ? "#626C68" : "#855D3B";
    const closedPosition: [number, number, number] = horizontal
      ? [placement.center, y + doorHeight / 2, placement.coord]
      : [placement.coord, y + doorHeight / 2, placement.center];
    const closedSize: [number, number, number] = horizontal ? [length, doorHeight, 0.16] : [0.16, doorHeight, length];
    const panelLength = Math.max(0.85, Math.min(length * 0.36, 2.1));
    const frameColor = isSelected ? "#EF7545" : "#53695B";

    return <group onClick={event => { event.stopPropagation(); onSelect(id); }}>
      <mesh position={position} receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={isSelected ? "#EF7545" : isPassage ? "#D7B08B" : "#C8643C"} {...fadeProps(opacity)} roughness={0.62} />
      </mesh>
      {isBalconyStyle && <>
        {[placement.start + panelLength / 2, placement.end - panelLength / 2].map((center, index) => <mesh key={`${opening.id}-slider-panel-${index}`} position={horizontal ? [center, y + 3.25, placement.coord] : [placement.coord, y + 3.25, center]} receiveShadow>
          <boxGeometry args={horizontal ? [panelLength, 5.9, 0.08] : [0.08, 5.9, panelLength]} />
          <meshStandardMaterial color="#BFD8D4" transparent opacity={0.44 * opacity} depthWrite={false} roughness={0.18} metalness={0.02} />
        </mesh>)}
        {[placement.start, placement.end].map((edge, index) => <mesh key={`${opening.id}-slider-post-${index}`} position={horizontal ? [edge, y + 3.25, placement.coord] : [placement.coord, y + 3.25, edge]} castShadow receiveShadow>
          <boxGeometry args={horizontal ? [0.12, 6.05, 0.12] : [0.12, 6.05, 0.12]} />
          <meshStandardMaterial color={frameColor} {...fadeProps(opacity)} roughness={0.52} />
        </mesh>)}
        <mesh position={horizontal ? [placement.center, y + 6.32, placement.coord] : [placement.coord, y + 6.32, placement.center]} castShadow receiveShadow>
          <boxGeometry args={horizontal ? [length, 0.14, 0.14] : [0.14, 0.14, length]} />
          <meshStandardMaterial color={frameColor} {...fadeProps(opacity)} roughness={0.52} />
        </mesh>
      </>}
      {isGarage && !open && <mesh position={closedPosition} castShadow receiveShadow>
        <boxGeometry args={horizontal ? [length, doorHeight, 0.18] : [0.18, doorHeight, length]} />
        <meshStandardMaterial color={doorColor} {...fadeProps(opacity)} roughness={0.72} />
      </mesh>}
      {!isGarage && !isPassage && !open && <mesh position={closedPosition} castShadow receiveShadow>
        <boxGeometry args={closedSize} />
        <meshStandardMaterial color={doorColor} {...fadeProps(opacity)} roughness={0.58} />
      </mesh>}
      {!isBalconyStyle && !isGarage && !isPassage && open && <group position={[leaf.hingeX, y + doorHeight / 2, leaf.hingeZ]} rotation={[0, leaf.rotationY, 0]}>
        <mesh position={leaf.orientation === "horizontal" ? [leaf.length / 2, 0, 0] : [0, 0, leaf.length / 2]} castShadow receiveShadow>
          <boxGeometry args={leaf.orientation === "horizontal" ? [leaf.length, doorHeight, 0.16] : [0.16, doorHeight, leaf.length]} />
          <meshStandardMaterial color={doorColor} {...fadeProps(opacity)} roughness={0.58} />
        </mesh>
        <mesh position={leaf.orientation === "horizontal" ? [leaf.length * 0.82, 0.2, 0.12] : [0.12, 0.2, leaf.length * 0.82]} castShadow>
          <boxGeometry args={[0.16, 0.16, 0.16]} />
          <meshStandardMaterial color="#2F312D" {...fadeProps(opacity)} roughness={0.35} />
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
    <meshStandardMaterial color={isSelected ? "#7FC7DC" : "#A9D6DF"} transparent opacity={0.62 * opacity} depthWrite={false} roughness={0.25} />
  </mesh>;
}

function SlabPiece({ x, z, width, depth, y, color, opacity, thickness }: { x: number; z: number; width: number; depth: number; y: number; color: string; opacity: number; thickness: number }) {
  if (width <= 0.05 || depth <= 0.05) return null;
  return <mesh position={[x + width / 2, y, z + depth / 2]} receiveShadow={opacity > 0.5}>
    <boxGeometry args={[width, thickness, depth]} />
    <meshStandardMaterial color={color} {...fadeProps(opacity)} roughness={0.86} />
  </mesh>;
}

function FloorSlab({ plan, material, opacity = 1, stairVoid }: { plan: FloorPlan; material?: MaterialSet; opacity?: number; stairVoid?: Room | null }) {
  const y = plan.elevation;
  const cx = plan.width / 2;
  const cz = plan.depth / 2;
  const floorColor = material?.floor ?? "#D5D0C6";
  const voidInset = 0.15;
  const voidX = stairVoid ? Math.max(0, stairVoid.x - voidInset) : 0;
  const voidZ = stairVoid ? Math.max(0, stairVoid.y - voidInset) : 0;
  const voidW = stairVoid ? Math.min(plan.width - voidX, stairVoid.width + voidInset * 2) : 0;
  const voidD = stairVoid ? Math.min(plan.depth - voidZ, stairVoid.depth + voidInset * 2) : 0;

  if (stairVoid) {
    return <group>
      <SlabPiece x={0} z={0} width={voidX} depth={plan.depth} y={y - 0.04} color="#B7AD9D" opacity={opacity} thickness={0.16} />
      <SlabPiece x={voidX + voidW} z={0} width={plan.width - voidX - voidW} depth={plan.depth} y={y - 0.04} color="#B7AD9D" opacity={opacity} thickness={0.16} />
      <SlabPiece x={voidX} z={0} width={voidW} depth={voidZ} y={y - 0.04} color="#B7AD9D" opacity={opacity} thickness={0.16} />
      <SlabPiece x={voidX} z={voidZ + voidD} width={voidW} depth={plan.depth - voidZ - voidD} y={y - 0.04} color="#B7AD9D" opacity={opacity} thickness={0.16} />
      <SlabPiece x={0} z={0} width={voidX} depth={plan.depth} y={y + 0.055} color={floorColor} opacity={opacity} thickness={0.045} />
      <SlabPiece x={voidX + voidW} z={0} width={plan.width - voidX - voidW} depth={plan.depth} y={y + 0.055} color={floorColor} opacity={opacity} thickness={0.045} />
      <SlabPiece x={voidX} z={0} width={voidW} depth={voidZ} y={y + 0.055} color={floorColor} opacity={opacity} thickness={0.045} />
      <SlabPiece x={voidX} z={voidZ + voidD} width={voidW} depth={plan.depth - voidZ - voidD} y={y + 0.055} color={floorColor} opacity={opacity} thickness={0.045} />
    </group>;
  }

  return <group>
    <mesh position={[cx, y - 0.04, cz]} receiveShadow={opacity > 0.5}>
      <boxGeometry args={[plan.width + 0.5, 0.16, plan.depth + 0.5]} />
      <meshStandardMaterial color="#B7AD9D" {...fadeProps(opacity)} roughness={0.86} />
    </mesh>
    <mesh position={[cx, y + 0.055, cz]} receiveShadow={opacity > 0.5}>
      <boxGeometry args={[plan.width, 0.045, plan.depth]} />
      <meshStandardMaterial color={floorColor} {...fadeProps(opacity)} roughness={0.82} />
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

function Furniture({ room, y, color, opacity = 1 }: { room: Room; y: number; color: string; opacity?: number }) {
  if (room.type === "bathroom" || room.type === "stairs" || room.type === "hallway" || room.type === "balcony") return null;
  // Units are feet — size furniture like real pieces so rooms don't look empty/congested.
  const maxW = room.type === "living" || room.type === "dining" ? 9 : room.type === "bedroom" ? 7 : 6;
  const maxD = room.type === "living" || room.type === "dining" ? 4.5 : room.type === "bedroom" ? 5.5 : 3.2;
  const w = Math.min(room.width * 0.42, maxW);
  const d = Math.min(room.depth * 0.3, maxD);
  const height = room.type === "bedroom" ? 1.4 : 1.1;
  return <group position={[room.x + room.width / 2, y + height / 2 + 0.08, room.y + room.depth / 2]}>
    <mesh castShadow><boxGeometry args={[w, height, d]} /><meshStandardMaterial color={color} {...fadeProps(opacity)} roughness={.55} /></mesh>
    {room.type === "kitchen" && <mesh position={[0, 1.1, 0]} castShadow><boxGeometry args={[w * .75, 2.2, 1.4]} /><meshStandardMaterial color="#E9E4DA" {...fadeProps(opacity)} /></mesh>}
  </group>;
}

function Staircase({ room, y, selected, onSelect, opacity = 1, rise = 3.2 }: { room: Room; y: number; selected: boolean; onSelect: (id: string) => void; opacity?: number; rise?: number }) {
  const centerX = room.x + room.width / 2;
  const centerZ = room.y + room.depth / 2;
  const radius = Math.max(2.15, Math.min(room.width, room.depth) * 0.39);
  const steps = Math.max(14, Math.min(20, Math.floor((room.width + room.depth) * 0.72)));
  const treadLength = Math.max(2.2, Math.min(radius * 1.72, 4.1));
  const treadDepth = Math.max(0.82, Math.min(radius * 0.44, 1.18));
  const color = selected ? "#EF7545" : "#D8BE82";

  return <group position={[centerX, y + 0.12, centerZ]} onClick={event => { event.stopPropagation(); onSelect(room.id); }}>
    <mesh position={[0, rise / 2, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.12, 0.12, rise + 0.6, 18]} />
      <meshStandardMaterial color="#6B5A3D" {...fadeProps(opacity)} roughness={0.58} />
    </mesh>
    {Array.from({ length: steps }, (_, index) => {
      const t = steps === 1 ? 0 : index / (steps - 1);
      const angle = SPIRAL_ANGLE_START + SPIRAL_ANGLE_SPAN * t;
      const stairHeight = Math.max(0.18, rise * t);
      const stepX = Math.cos(angle) * radius * 0.52;
      const stepZ = Math.sin(angle) * radius * 0.52;
      return <mesh key={`${room.id}-step-${index}`} position={[stepX, stairHeight + 0.05, stepZ]} rotation={[0, -angle, 0]} castShadow receiveShadow>
        <boxGeometry args={[treadLength, 0.18, treadDepth]} />
        <meshStandardMaterial color={color} {...fadeProps(opacity)} roughness={0.68} />
      </mesh>;
    })}
    <mesh position={[Math.cos(SPIRAL_ANGLE_START + SPIRAL_ANGLE_SPAN) * radius * 0.52, rise + 0.08, Math.sin(SPIRAL_ANGLE_START + SPIRAL_ANGLE_SPAN) * radius * 0.52]} rotation={[0, -(SPIRAL_ANGLE_START + SPIRAL_ANGLE_SPAN), 0]} castShadow receiveShadow>
      <boxGeometry args={[treadLength + 0.35, 0.18, treadDepth * 1.2]} />
      <meshStandardMaterial color={selected ? "#EF7545" : "#BCA26A"} {...fadeProps(opacity)} roughness={0.7} />
    </mesh>
    {Array.from({ length: 7 }, (_, index) => {
      const t = index / 6;
      const angle = SPIRAL_ANGLE_START + SPIRAL_ANGLE_SPAN * t;
      return <mesh key={`${room.id}-post-${index}`} position={[Math.cos(angle) * radius * 1.08, rise * t + 0.55, Math.sin(angle) * radius * 1.08]} castShadow>
        <boxGeometry args={[0.08, 1.1, 0.08]} />
        <meshStandardMaterial color="#6B5A3D" {...fadeProps(opacity)} roughness={0.55} />
      </mesh>;
    })}
    <Text position={[0, 0.08, -radius - 0.65]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.42} color="#5B4931" anchorX="center" anchorY="middle">UP</Text>
    <mesh position={[0, 0.1, -radius - 0.15]} rotation={[0, 0, Math.PI / 4]} receiveShadow>
      <boxGeometry args={[0.55, 0.05, 0.12]} />
      <meshStandardMaterial color="#5B4931" {...fadeProps(opacity)} roughness={0.5} />
    </mesh>
  </group>;
}

function StairLanding({ room, y, selected, onSelect, opacity = 1 }: { room: Room; y: number; selected: boolean; onSelect: (id: string) => void; opacity?: number }) {
  const railColor = selected ? "#EF7545" : "#6B5A3D";
  const railHeight = 1.45;
  const thickness = 0.12;
  const inset = 0.55;
  const x = room.x + inset;
  const z = room.y + inset;
  const width = Math.max(1, room.width - inset * 2);
  const depth = Math.max(1, room.depth - inset * 2);

  return <group onClick={event => { event.stopPropagation(); onSelect(room.id); }}>
    <mesh position={[room.x + room.width / 2, y + 0.09, room.y + room.depth / 2]} receiveShadow>
      <boxGeometry args={[Math.max(0.6, room.width - 1.45), 0.08, Math.max(0.6, room.depth - 1.45)]} />
      <meshStandardMaterial color="#6B5A3D" transparent opacity={0.08 * opacity} depthWrite={false} roughness={0.8} />
    </mesh>
    <mesh position={[room.x + room.width / 2, y + 0.14, room.y + room.depth / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[Math.max(0.9, Math.min(room.width, room.depth) * 0.22), Math.max(1.4, Math.min(room.width, room.depth) * 0.36), 36]} />
      <meshStandardMaterial color="#D8BE82" transparent opacity={0.35 * opacity} depthWrite={false} roughness={0.7} />
    </mesh>
    {[
      { px: x + width / 2, pz: z, sx: width, sz: thickness },
      { px: x + width / 2, pz: z + depth, sx: width, sz: thickness },
      { px: x, pz: z + depth / 2, sx: thickness, sz: depth },
      { px: x + width, pz: z + depth / 2, sx: thickness, sz: depth },
    ].map((rail, index) => <mesh key={`${room.id}-landing-rail-${index}`} position={[rail.px, y + railHeight / 2, rail.pz]} castShadow receiveShadow>
      <boxGeometry args={[rail.sx, railHeight, rail.sz]} />
      <meshStandardMaterial color={railColor} {...fadeProps(opacity)} roughness={0.64} />
    </mesh>)}
    <Text position={[room.x + room.width / 2, y + 0.2, room.y + room.depth / 2]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.42} color="#5B4931" anchorX="center" anchorY="middle">STAIR DOWN</Text>
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

function RoomGeometry({ room, plan, material, activeFloor, showCeiling, selectedId, onSelect, interiors, showLabels, opacity = 1, stairRise = 3.2, stairMode = "none" }: { room: Room; plan: FloorPlan; material: MaterialSet; activeFloor: number; showCeiling: boolean; selectedId?: string; onSelect: (id: string) => void; interiors: boolean; showLabels: boolean; opacity?: number; stairRise?: number; stairMode?: "none" | "climb" | "landing" }) {
  const y = plan.elevation; const h = ROOM_HEIGHT; const cx = room.x + room.width / 2; const cz = room.y + room.depth / 2;
  const visible = activeFloor === -1 || activeFloor === plan.level;
  const selected = selectedId === room.id;
  const isStairLanding = room.type === "stairs" && stairMode === "landing";
  const isBalcony = room.type === "balcony";
  if (!visible) return null;
  return <group>
    {!isStairLanding && <mesh position={[cx, y + .105, cz]} receiveShadow onClick={e => { e.stopPropagation(); onSelect(room.id); }}>
      <boxGeometry args={[room.width - .18, .026, room.depth - .18]} />
      <meshStandardMaterial color={selected ? "#F2A17D" : room.color} transparent opacity={(selected ? 0.86 : isBalcony ? 0.62 : 0.48) * opacity} depthWrite={opacity >= 0.99} roughness={.86} />
    </mesh>}
    {showCeiling && !isBalcony && <mesh position={[cx, y + h, cz]} receiveShadow><boxGeometry args={[room.width, .08, room.depth]} /><meshStandardMaterial color={material.ceiling} transparent opacity={.9 * opacity} depthWrite={opacity >= 0.99} /></mesh>}
    {isBalcony && <BalconyRailing room={room} plan={plan} y={y} selected={selected} onSelect={onSelect} opacity={opacity} />}
    {interiors && <Furniture room={room} y={y} color={material.accent} opacity={opacity} />}
    {interiors && room.type === "stairs" && stairMode === "climb" && <Staircase room={room} y={y} selected={selected} onSelect={onSelect} opacity={opacity} rise={stairRise} />}
    {interiors && room.type === "stairs" && stairMode === "landing" && <StairLanding room={room} y={y} selected={selected} onSelect={onSelect} opacity={opacity} />}
    <RoomLabel room={room} y={y} selected={selected} onSelect={onSelect} visible={showLabels && opacity > 0.75} />
  </group>;
}

export default function HouseViewer({ plans, materials, selectedId, onSelect, activeFloor, showCeiling, cutaway, mode, interiors, focusFloor = null, roofTemplate = "none" }: { plans: FloorPlan[]; materials: Record<string, MaterialSet>; selectedId?: string; onSelect: (id: string) => void; activeFloor: number; showCeiling: boolean; cutaway: boolean; mode: "orbit" | "walk"; interiors: boolean; focusFloor?: number | null; roofTemplate?: RoofTemplate }) {
  const plan = (focusFloor !== null ? plans.find(item => item.level === focusFloor) : null) ?? plans[0];
  const width = plan?.width || 14;
  const depth = plan?.depth || 18;
  const span = Math.max(width, depth);
  const walking = mode === "walk";
  // Frame closer and higher so the house fills the view instead of reading as a tiny congested diagram.
  const cameraDistance = span * 0.72;
  const cameraHeight = Math.max(28, span * 0.62);
  const lightReach = span * 1.2;
  const renderPlans = focusFloor === null
    ? plans
    : [...plans].sort((a, b) => (a.level === focusFloor ? 1 : 0) - (b.level === focusFloor ? 1 : 0));
  const roofPlanIds = useMemo(() => {
    if (roofTemplate === "none" || walking) return new Set<string>();
    const visiblePlans = plans.filter(item => activeFloor === -1 || activeFloor === item.level);
    if (focusFloor !== null) {
      const focusedPlan = visiblePlans.find(item => item.level === focusFloor);
      return new Set(focusedPlan ? [focusedPlan.id] : []);
    }
    const topPlan = [...visiblePlans].sort((a, b) => b.elevation - a.elevation)[0];
    return new Set(topPlan ? [topPlan.id] : []);
  }, [activeFloor, focusFloor, plans, roofTemplate, walking]);
  const planSignature = useMemo(() => plans.map(item => `${item.id}:${item.openings.length}:${item.rooms.length}`).join("|"), [plans]);
  const [walkLocked, setWalkLocked] = useState(false);
  const [openDoorState, setOpenDoorState] = useState<{ signature: string; ids: Set<string> }>(() => ({ signature: "", ids: new Set() }));
  const [doorHint, setDoorHint] = useState("");
  const openDoorIds = openDoorState.signature === planSignature ? openDoorState.ids : new Set<string>();

  const toggleDoor = useCallback((id: string) => {
    setOpenDoorState(previous => {
      const next = new Set(previous.signature === planSignature ? previous.ids : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { signature: planSignature, ids: next };
    });
  }, [planSignature]);

  useEffect(() => {
    if (walking) return;
    document.exitPointerLock?.();
  }, [walking]);

  return <div className={`three-canvas${walking ? " walk-mode" : ""}`}>
    {walking && <div className="walk-hint">{doorHint || (walkLocked ? "WASD to move - E opens doors - Esc to release mouse" : "Click canvas to look - WASD to move - E opens doors")}</div>}
    <Canvas key={walking ? "walk-camera" : "orbit-camera"} shadows camera={{ position: [cameraDistance, cameraHeight, cameraDistance], fov: walking ? 88 : 36 }} onPointerMissed={() => !walking && onSelect("")}>
      <color attach="background" args={["#DDE9D6"]} />
      <ambientLight intensity={0.72} />
      <hemisphereLight args={["#F4F8EC", "#6F8F62", 0.55]} />
      <directionalLight position={[lightReach * 0.62, lightReach, lightReach * 0.45]} intensity={2.85} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-lightReach} shadow-camera-right={lightReach} shadow-camera-top={lightReach} shadow-camera-bottom={-lightReach} />
      <Suspense fallback={null}>
        <GrassGround width={width} depth={depth} />
        <group position={[-width/2, 0, -depth/2]}>
          {renderPlans.flatMap(plan => {
            const visible = activeFloor === -1 || activeFloor === plan.level;
            if (!visible) return [];
            const focused = focusFloor === null || focusFloor === plan.level;
            const renderPlan = planWithoutUpperEntry(plan);
            const geometry = buildPlan3DGeometry(renderPlan);
            const baseWalls = cutaway ? geometry.walls.filter(wall => !(wall.kind === "exterior" && (wall.x1 >= renderPlan.width - 0.03 || wall.z1 >= renderPlan.depth - 0.03))) : geometry.walls;
            const walls = trimBalconyRailWalls(baseWalls, renderPlan);
            const firstMaterial = materials[renderPlan.rooms[0]?.id];
            const nextPlan = plans.find(candidate => candidate.level === renderPlan.level + 1);
            const previousPlan = plans.find(candidate => candidate.level === renderPlan.level - 1);
            const stairVoid = previousPlan ? renderPlan.rooms.find(room => room.type === "stairs") ?? null : null;
            const stairRise = nextPlan ? nextPlan.elevation - renderPlan.elevation : 3.2;
            const getStairMode = (room: Room): "none" | "climb" | "landing" => room.type !== "stairs" ? "none" : nextPlan ? "climb" : previousPlan ? "landing" : "none";
            if (!focused) {
              return [
                <FloorSlab key={`${renderPlan.id}-ghost-slab`} plan={renderPlan} material={firstMaterial} opacity={0.018} stairVoid={stairVoid} />,
                <GhostFloorOutline key={`${renderPlan.id}-ghost-outline`} walls={walls} y={renderPlan.elevation} />,
              ];
            }
            return [
              <FloorSlab key={`${renderPlan.id}-slab`} plan={renderPlan} material={firstMaterial} opacity={1} stairVoid={stairVoid} />,
              renderPlan.level === 0 && focused ? <EntryWalkway key={`${renderPlan.id}-entry-path`} plan={renderPlan} showLabel={!walking} /> : null,
              ...renderPlan.rooms.map(room => <RoomGeometry key={room.id} room={room} plan={renderPlan} material={materials[room.id]} activeFloor={activeFloor} showCeiling={showCeiling} selectedId={selectedId} onSelect={onSelect} interiors={interiors} showLabels={!walking} opacity={1} stairRise={stairRise} stairMode={getStairMode(room)} />),
              ...walls.map(wall => <SharedWall key={wall.id} wall={wall} y={renderPlan.elevation} selectedId={selectedId} onSelect={onSelect} opacity={1} material={firstMaterial} />),
              ...getPlanOpeningPlacements(renderPlan).map(placement => <OpeningMarker key={placement.opening.id} placement={placement} y={renderPlan.elevation} selectedId={selectedId} onSelect={onSelect} opacity={1} isOpen={openDoorIds.has(doorStateId(renderPlan, placement))} alwaysOpen={isBalconyDoorPlacement(placement, renderPlan)} />),
              roofPlanIds.has(renderPlan.id) ? <RoofGeometry key={`${renderPlan.id}-roof-${roofTemplate}`} plan={renderPlan} template={roofTemplate} /> : null,
            ];
          })}
        </group>
        <Environment preset="apartment" />
      </Suspense>
      {!walking && <Grid args={[Math.max(120, span * 3), Math.max(120, span * 3)]} cellSize={2} cellThickness={.25} cellColor="#89A177" sectionSize={10} sectionThickness={0.45} sectionColor="#68825E" fadeDistance={span * 2.5} infiniteGrid />}
      {plan && walking && <>
        <WalkCameraRig plan={plan} active={walking} />
        <WalkMovement active={walking} plans={plans} width={width} depth={depth} openDoorIds={openDoorIds} onToggleDoor={toggleDoor} onDoorHintChange={setDoorHint} />
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
