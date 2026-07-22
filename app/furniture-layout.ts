import { FloorPlan, Room, Brief, Furniture } from "./studio-types"

export const place_furniture = (plan: FloorPlan, brief: Brief) => {
    let new_ = plan
    if (!brief.furnitureRequirements) {
        console.log("No furniture requirements received from API")
        return new_
    }

    new_.rooms.forEach(room => {
        let reqs = brief.furnitureRequirements?.find(r => {
            let ai_type = r.roomType.toLowerCase()
            let sys_type = room.type.toLowerCase()
            let sys_name = room.name.toLowerCase()

            let match_1 = ai_type.includes(sys_type)
            let match_2 = sys_type.includes(ai_type)
            let match_3 = sys_name.includes(ai_type)

            return match_1 || match_2 || match_3
        })

        if (reqs) {
            let placed_items: Furniture[] = []
            let left_y = 0.5
            let right_y = 0.5

            reqs.items.forEach((item, index) => {
                const padding = 0.4
                const maxW = Math.max(1.0, room.width - padding * 2)
                const maxD = Math.max(1.0, room.depth - padding * 2)
                const itemW = Math.min(item.width, maxW)
                const itemD = Math.min(item.depth, maxD)

                let step_y = (index % 2 === 0) ? left_y : right_y

                while (step_y + itemD <= room.depth - padding) {
                    let furn_x = (index % 2 === 0) ? padding : Math.max(padding, room.width - itemW - padding)
                    let furn_y = step_y

                    let overlap = false
                    placed_items.forEach(p => {
                        if (furn_x < p.x + p.width && furn_x + itemW > p.x && furn_y < p.y + p.depth && furn_y + itemD > p.y) {
                            overlap = true
                        }
                    })

                    const doors = plan.openings.filter(op => op.roomId === room.id && op.kind === "door")
                    doors.forEach(door => {
                        let cx1 = 0, cx2 = 0, cy1 = 0, cy2 = 0
                        const clearance = 2.2

                        if (door.wall === "north") {
                            cx1 = door.offset
                            cx2 = door.offset + door.width
                            cy1 = 0
                            cy2 = clearance
                        } else if (door.wall === "south") {
                            cx1 = door.offset
                            cx2 = door.offset + door.width
                            cy1 = room.depth - clearance
                            cy2 = room.depth
                        } else if (door.wall === "west") {
                            cx1 = 0
                            cx2 = clearance
                            cy1 = door.offset
                            cy2 = door.offset + door.width
                        } else if (door.wall === "east") {
                            cx1 = room.width - clearance
                            cx2 = room.width
                            cy1 = door.offset
                            cy2 = door.offset + door.width
                        }

                        if (furn_x < cx2 && furn_x + itemW > cx1 && furn_y < cy2 && furn_y + itemD > cy1) {
                            overlap = true
                        }
                    })

                    if (!overlap) {
                        let uid = Math.random().toString(36).slice(2, 9)
                        placed_items.push({ id: uid, name: item.name, width: itemW, depth: itemD, x: furn_x, y: furn_y })
                        
                        if (index % 2 === 0) {
                            left_y = furn_y + itemD + 0.5
                        } else {
                            right_y = furn_y + itemD + 0.5
                        }
                        break
                    }

                    step_y += 0.5
                }
            })
            room.furniture = placed_items
        }
    })

    return new_
}