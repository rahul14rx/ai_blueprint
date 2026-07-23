import { Brief, FloorPlan, Furniture } from "./studio-types";

const DEFAULT_FURNITURE: NonNullable<Brief["furnitureRequirements"]> = [
  { roomType: "bathroom", items: [{ name: "Bathtub", width: 2.5, depth: 5.5 }, { name: "Toilet", width: 1.8, depth: 2.2 }, { name: "Sink", width: 2.4, depth: 1.8 }] },
  { roomType: "kitchen", items: [{ name: "Kitchen Counter", width: 2.2, depth: 8 }, { name: "Refrigerator", width: 2.8, depth: 2.8 }] },
  { roomType: "living", items: [{ name: "Couch", width: 7, depth: 3 }, { name: "Carpet Area Rug", width: 6, depth: 4 }, { name: "TV", width: 4, depth: 0.5 }, { name: "TV Entertainment Console", width: 5, depth: 1.5 }] },
  { roomType: "bedroom", items: [{ name: "Bed", width: 5, depth: 6.5 }, { name: "Bedside Table", width: 1.4, depth: 1.4 }] },
  { roomType: "dining", items: [{ name: "Dining Table", width: 5, depth: 3 }, { name: "Dining Chair", width: 1.4, depth: 1.4 }] },
  { roomType: "study", items: [{ name: "Desk", width: 4, depth: 2 }, { name: "Study Chair", width: 1.6, depth: 1.6 }] },
  { roomType: "utility", items: [{ name: "Utility Counter", width: 4, depth: 2 }] },
  { roomType: "laundry", items: [{ name: "Washer Dryer", width: 3, depth: 2.5 }] },
  { roomType: "pantry", items: [{ name: "Storage Shelves", width: 3.5, depth: 1.5 }] },
  { roomType: "garage", items: [{ name: "Car", width: 7, depth: 14 }] },
];

function furnitureOverlaps(a: Furniture, b: Furniture) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.depth && a.y + a.depth > b.y;
}

function overlapsDoorClearance(item: Furniture, plan: FloorPlan, roomId: string, roomWidth: number, roomDepth: number) {
  const clearance = 2.2;
  return plan.openings.some(opening => {
    if (opening.roomId !== roomId || opening.kind !== "door") return false;
    const zone = opening.wall === "north"
      ? { x: opening.offset, y: 0, width: opening.width, depth: clearance }
      : opening.wall === "south"
        ? { x: opening.offset, y: roomDepth - clearance, width: opening.width, depth: clearance }
        : opening.wall === "west"
          ? { x: 0, y: opening.offset, width: clearance, depth: opening.width }
          : { x: roomWidth - clearance, y: opening.offset, width: clearance, depth: opening.width };
    return furnitureOverlaps(item, { id: "door-clearance", name: "Door clearance", ...zone });
  });
}

export function place_furniture(plan: FloorPlan, brief: Brief): FloorPlan {
  const furnitureRequirements = brief.furnitureRequirements?.length ? brief.furnitureRequirements : DEFAULT_FURNITURE;

  const rooms = plan.rooms.map(room => {
    const requirements = furnitureRequirements.find(requirement => {
      const requestedType = requirement.roomType.toLowerCase();
      const roomType = room.type.toLowerCase();
      const roomName = room.name.toLowerCase();
      return requestedType.includes(roomType) || roomType.includes(requestedType) || roomName.includes(requestedType);
    });
    if (!requirements) return room;

    const placed: Furniture[] = [];
    let leftY = 0.5;
    let rightY = 0.5;

    requirements.items.forEach((item, index) => {
      const padding = 0.4;
      const itemWidth = Math.min(item.width, Math.max(1, room.width - padding * 2));
      const itemDepth = Math.min(item.depth, Math.max(1, room.depth - padding * 2));
      let stepY = index % 2 === 0 ? leftY : rightY;

      while (stepY + itemDepth <= room.depth - padding) {
        const x = index % 2 === 0 ? padding : Math.max(padding, room.width - itemWidth - padding);
        const candidate: Furniture = {
          id: `${room.id}-furniture-${index}-${placed.length}`,
          name: item.name,
          width: itemWidth,
          depth: itemDepth,
          x,
          y: stepY,
        };
        const blocked = placed.some(existing => furnitureOverlaps(candidate, existing)) || overlapsDoorClearance(candidate, plan, room.id, room.width, room.depth);
        if (!blocked) {
          placed.push(candidate);
          if (index % 2 === 0) leftY = stepY + itemDepth + 0.5;
          else rightY = stepY + itemDepth + 0.5;
          break;
        }
        stepY += 0.5;
      }
    });

    return { ...room, furniture: placed };
  });

  return { ...plan, rooms };
}
