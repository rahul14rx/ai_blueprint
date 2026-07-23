import { Buffer } from "node:buffer";
import { FloorPlan, Furniture, Opening, Room } from "../../studio-types";

// --- 1. Dynamic styled technical floor plan SVG renderer (Fallback & Design Template) ---

function esc(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char] ?? char));
}

function n(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function roomPattern(room: Room) {
  if (room.type === "kitchen") return "tile-pattern";
  if (room.type === "bathroom") return "bath-pattern";
  if (room.type === "bedroom") return "carpet-pattern";
  if (room.type === "garage" || room.type === "utility" || room.type === "laundry") return "concrete-pattern";
  if (room.type === "balcony" || room.type === "porch") return "outdoor-pattern";
  return "wood-pattern";
}

function furnitureSvg(room: Room, furniture: Furniture, scale: number) {
  const name = furniture.name.toLowerCase();
  const fx = (room.x + furniture.x) * scale;
  const fy = (room.y + furniture.y) * scale;
  const fw = Math.max(8, Math.min(room.width * scale - 8, furniture.width * scale));
  const fh = Math.max(8, Math.min(room.depth * scale - 8, furniture.depth * scale));
  const label = esc(furniture.name);

  if (name.includes("bed")) {
    return `
      <g filter="url(#soft-shadow)">
        <rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#fffdf8" stroke="#9ca3af" stroke-width="1.4" rx="3" />
        <rect x="${n(fx + fw * 0.05)}" y="${n(fy + fh * 0.06)}" width="${n(fw * 0.36)}" height="${n(fh * 0.18)}" fill="#eaf1ec" stroke="#c7d6ca" stroke-width="0.8" rx="2" />
        <rect x="${n(fx + fw * 0.46)}" y="${n(fy + fh * 0.06)}" width="${n(fw * 0.36)}" height="${n(fh * 0.18)}" fill="#eaf1ec" stroke="#c7d6ca" stroke-width="0.8" rx="2" />
        <line x1="${n(fx)}" y1="${n(fy + fh * 0.3)}" x2="${n(fx + fw)}" y2="${n(fy + fh * 0.3)}" stroke="#c6bfb2" stroke-width="1" />
      </g>`;
  }

  if (name.includes("couch") || name.includes("sofa")) {
    return `
      <g filter="url(#soft-shadow)">
        <rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#f6f2ea" stroke="#9ca3af" stroke-width="1.3" rx="5" />
        <rect x="${n(fx + 3)}" y="${n(fy + 3)}" width="${n(fw - 6)}" height="${n(fh * 0.26)}" fill="#e7ded0" rx="2" />
        <line x1="${n(fx + fw / 2)}" y1="${n(fy)}" x2="${n(fx + fw / 2)}" y2="${n(fy + fh)}" stroke="#d5cec2" stroke-width="1" />
      </g>`;
  }

  if (name.includes("rug") || name.includes("carpet")) {
    return `<rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#e6d8bd" stroke="#c7b99d" stroke-width="1" rx="5" opacity="0.9" />`;
  }

  if (name.includes("dining table")) {
    return `
      <g filter="url(#soft-shadow)">
        <rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#fffaf0" stroke="#8b7d6a" stroke-width="1.3" rx="3" />
        <line x1="${n(fx + fw * 0.12)}" y1="${n(fy + fh / 2)}" x2="${n(fx + fw * 0.88)}" y2="${n(fy + fh / 2)}" stroke="#d8ccb5" stroke-width="1" />
      </g>`;
  }

  if (name.includes("chair")) {
    return `<rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#ffffff" stroke="#9ca3af" stroke-width="1" rx="2" filter="url(#soft-shadow)" />`;
  }

  if (name.includes("counter")) {
    return `
      <g filter="url(#soft-shadow)">
        <rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#f7f7f3" stroke="#8f948d" stroke-width="1.2" rx="2" />
        <line x1="${n(fx + 4)}" y1="${n(fy + 4)}" x2="${n(fx + fw - 4)}" y2="${n(fy + 4)}" stroke="#d7d4cc" stroke-width="1" />
      </g>`;
  }

  if (name.includes("refrigerator") || name.includes("fridge")) {
    return `<rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#f8fafc" stroke="#64748b" stroke-width="1.2" rx="2" filter="url(#soft-shadow)" />`;
  }

  if (name.includes("bathtub")) {
    return `<rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#ffffff" stroke="#7f8c8d" stroke-width="1.2" rx="8" filter="url(#soft-shadow)" />`;
  }

  if (name.includes("toilet")) {
    return `<ellipse cx="${n(fx + fw / 2)}" cy="${n(fy + fh / 2)}" rx="${n(fw * 0.35)}" ry="${n(fh * 0.38)}" fill="#ffffff" stroke="#7f8c8d" stroke-width="1.2" filter="url(#soft-shadow)" />`;
  }

  if (name.includes("sink")) {
    return `<rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#ffffff" stroke="#7f8c8d" stroke-width="1.2" rx="3" filter="url(#soft-shadow)" />`;
  }

  if (name.includes("car")) {
    return `
      <g filter="url(#soft-shadow)">
        <rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#eef0ec" stroke="#717a75" stroke-width="1.4" rx="12" />
        <circle cx="${n(fx + fw * 0.18)}" cy="${n(fy + fh + 4)}" r="4" fill="#ffffff" stroke="#333" stroke-width="1" />
        <circle cx="${n(fx + fw * 0.82)}" cy="${n(fy + fh + 4)}" r="4" fill="#ffffff" stroke="#333" stroke-width="1" />
      </g>`;
  }

  return `
    <g filter="url(#soft-shadow)">
      <rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="#ffffff" stroke="#a3a3a3" stroke-width="1" rx="2" />
      <text x="${n(fx + fw / 2)}" y="${n(fy + fh / 2 + 3)}" font-family="Arial, sans-serif" font-size="7" fill="#555" text-anchor="middle">${label}</text>
    </g>`;
}

function openingPosition(plan: FloorPlan, opening: Opening, scale: number) {
  const room = plan.rooms.find(item => item.id === opening.roomId);
  if (!room) return null;
  const x = room.x * scale;
  const y = room.y * scale;
  const width = room.width * scale;
  const depth = room.depth * scale;
  const offset = opening.offset * scale;
  const span = opening.width * scale;

  if (opening.wall === "north") return { x1: x + offset, y1: y, x2: x + offset + span, y2: y, wall: opening.wall, span };
  if (opening.wall === "south") return { x1: x + offset, y1: y + depth, x2: x + offset + span, y2: y + depth, wall: opening.wall, span };
  if (opening.wall === "west") return { x1: x, y1: y + offset, x2: x, y2: y + offset + span, wall: opening.wall, span };
  return { x1: x + width, y1: y + offset, x2: x + width, y2: y + offset + span, wall: opening.wall, span };
}

function renderOpening(plan: FloorPlan, opening: Opening, scale: number) {
  const point = openingPosition(plan, opening, scale);
  if (!point) return "";
  const { x1, y1, x2, y2, wall, span } = point;
  const isHorizontal = wall === "north" || wall === "south";

  if (opening.kind === "window" || opening.kind === "vent") {
    return isHorizontal
      ? `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#a6ced1" stroke-width="7" stroke-linecap="round" /><line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#2f6f73" stroke-width="1.5" />`
      : `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#a6ced1" stroke-width="7" stroke-linecap="round" /><line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#2f6f73" stroke-width="1.5" />`;
  }

  const gap = `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#faf9f4" stroke-width="7" stroke-linecap="square" />`;
  const swing = span;
  if (wall === "north") {
    return `${gap}<path d="M ${n(x1)} ${n(y1)} L ${n(x1)} ${n(y1 + swing)} A ${n(swing)} ${n(swing)} 0 0 0 ${n(x1 + swing)} ${n(y1)}" fill="none" stroke="#c56436" stroke-width="1.8" />`;
  }
  if (wall === "south") {
    return `${gap}<path d="M ${n(x1)} ${n(y1)} L ${n(x1)} ${n(y1 - swing)} A ${n(swing)} ${n(swing)} 0 0 1 ${n(x1 + swing)} ${n(y1)}" fill="none" stroke="#c56436" stroke-width="1.8" />`;
  }
  if (wall === "west") {
    return `${gap}<path d="M ${n(x1)} ${n(y1)} L ${n(x1 + swing)} ${n(y1)} A ${n(swing)} ${n(swing)} 0 0 1 ${n(x1)} ${n(y1 + swing)}" fill="none" stroke="#c56436" stroke-width="1.8" />`;
  }
  return `${gap}<path d="M ${n(x1)} ${n(y1)} L ${n(x1 - swing)} ${n(y1)} A ${n(swing)} ${n(swing)} 0 0 0 ${n(x1)} ${n(y1 + swing)}" fill="none" stroke="#c56436" stroke-width="1.8" />`;
}

function generateDynamicFallbackSvg(plan: FloorPlan): string {
  const scale = 16;
  const pad = 34;
  const w = plan.width * scale;
  const h = plan.depth * scale;

  const roomsSvg = plan.rooms.map(room => {
    const rx = room.x * scale;
    const ry = room.y * scale;
    const rw = room.width * scale;
    const rh = room.depth * scale;

    const fillPattern = roomPattern(room);

    const furnSvg = (room.furniture || []).map(furniture => furnitureSvg(room, furniture, scale)).join("\n");
    const label = esc(room.name);

    return `
      <g>
        <!-- Room floor fill -->
        <rect x="${n(rx)}" y="${n(ry)}" width="${n(rw)}" height="${n(rh)}" fill="url(#${fillPattern})" />
        
        <!-- Room walls -->
        <rect x="${n(rx)}" y="${n(ry)}" width="${n(rw)}" height="${n(rh)}" fill="none" stroke="#232722" stroke-width="3.2" />
        
        <!-- Furniture -->
        ${furnSvg}

        <!-- Room label -->
        <rect x="${n(rx + rw / 2 - 48)}" y="${n(ry + rh / 2 - 10)}" width="96" height="20" fill="#fffffff0" rx="3" />
        <text x="${n(rx + rw / 2)}" y="${n(ry + rh / 2 + 4)}" font-family="Arial, sans-serif" font-weight="700" font-size="10" fill="#1f2c27" text-anchor="middle">${label}</text>
      </g>
    `;
  }).join("\n");

  const openingsSvg = plan.openings.map(opening => renderOpening(plan, opening, scale)).join("\n");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}" width="${w + pad * 2}" height="${h + pad * 2}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <!-- Gradients and Patterns -->
        <pattern id="wood-pattern" width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill="#ead8bd" />
          <line x1="0" y1="8" x2="26" y2="8" stroke="#dfc79f" stroke-width="1" />
          <line x1="0" y1="18" x2="26" y2="18" stroke="#f2e4cf" stroke-width="1" />
        </pattern>
        <pattern id="tile-pattern" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill="#eef1ef" />
          <path d="M 14 0 L 0 0 0 14" fill="none" stroke="#dde3df" stroke-width="1" />
        </pattern>
        <pattern id="bath-pattern" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#dceceb" />
          <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#c6d9d8" stroke-width="1" />
        </pattern>
        <pattern id="carpet-pattern" width="15" height="15" patternUnits="userSpaceOnUse">
          <rect width="15" height="15" fill="#f8f2e6" />
          <circle cx="7.5" cy="7.5" r="1.1" fill="#e9dcc3" />
        </pattern>
        <pattern id="concrete-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill="#e7e5dd" />
          <circle cx="4" cy="7" r="0.8" fill="#d0ccc2" />
          <circle cx="15" cy="13" r="0.7" fill="#d0ccc2" />
        </pattern>
        <pattern id="outdoor-pattern" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#e9efe2" />
          <path d="M 0 16 L 16 0" stroke="#d5dfcd" stroke-width="1" />
        </pattern>
        
        <!-- Shadows -->
        <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1.5" dy="1.5" stdDeviation="1.5" flood-color="#000" flood-opacity="0.16" />
        </filter>
      </defs>
      
      <!-- Base Plot Background -->
      <rect x="${-pad}" y="${-pad}" width="${w + pad * 2}" height="${h + pad * 2}" fill="#f8f9f6" />
      <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" stroke="#111" stroke-width="5" />
      
      <!-- Styled Rooms -->
      ${roomsSvg}

      <!-- Doors, windows and vents -->
      ${openingsSvg}
    </svg>
  `;
}

// --- 2. Material & Texture Compiler ---

function compileArchitecturalPrompt(plan: FloorPlan): string {
  return plan.rooms.map(room => {
    const furnDesc = room.furniture && room.furniture.length > 0
      ? ` containing: ${room.furniture.map(f => `${f.name} with realistic, textured upholstery fabrics`).join(", ")}`
      : "";
    return `- ${room.name}${furnDesc}`;
  }).join("\n");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const plan = body.plan;
    const blueprintImage = body.blueprintImage || body.blueprintBase64;
    const roomListInput = body.roomList;

    if (!plan && !blueprintImage) {
      return Response.json({ error: "Invalid request. Provide either a plan layout or blueprint image." }, { status: 400 });
    }

    // Strip header prefix if present on incoming base64 payload
    const base64String = blueprintImage || "";
    const rawBase64 = base64String.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

    if (!rawBase64) {
      console.warn("No valid blueprint base64 payload found.");
    }

    const planRoomList = plan ? compileArchitecturalPrompt(plan) : "";
    const finalRoomList = roomListInput || planRoomList;

    const systemPrompt = `You are a master architectural visualization specialist and interior designer. Based on the attached 2D blueprint layout image, generate a clean, top-down 2D orthographic plan render. You must strictly use the blueprint as a rigid template; all outer and internal partition coordinates, window positions, and door swings must match.

Description of materials and interior styling rules:

Detailed architectural render rules:
Render all wall partitions as precise, clean, uniform-width dark grey lines against a bright white background.
Living and Dining areas, Bedrooms, and the Central Hallway: mandate high-resolution, long-plank light oak hardwood flooring with defined grain and subtle sheen, as a seamless field.
Kitchens and all Bathrooms: large-format square travertine stone tile with precision grout lines.
Apply distinct, plush area rugs with textured patterns to the living area and under each bed, sitting over the wood floor.
Soft, diffused, omnidirectional gallery-style lighting. Everything must be 2D, but all furniture and wall segments must cast a realistic, very soft, precise drop-shadow to create a polished architectural catalog depth.

Populate each room zone dynamically based on the layout:
${finalRoomList}

Rendering style: ultra high-definition 2D top-down plan view, professional interior design, architectural visualization.

Return ONLY valid, self-contained SVG code starting with <svg> and ending with </svg> wrapped inside an xml code block:
\`\`\`xml
<svg ...>
...
</svg>
\`\`\``;

    const apiKey = process.env.GEMINI_API_KEY;
    const configuredModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const useAiPreview = process.env.GEMINI_PREVIEW_MODE === "ai";

    const modelsToTry = [
      configuredModel,
      "gemini-2.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-flash-latest",
      "gemini-pro-latest"
    ];

    let svgContent = "";

    if (useAiPreview && apiKey && !apiKey.includes("paste_your") && rawBase64) {
      for (const model of modelsToTry) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: rawBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '')
                    }
                  },
                  {
                    text: systemPrompt
                  }
                ]
              }]
            })
          });

          if (response.ok) {
            const data = await response.json();
            const textPart = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            const match = textPart.match(/```(?:xml)?([\s\S]*?)```/);
            if (match) {
              svgContent = match[1].trim();
            } else if (textPart.includes("<svg")) {
              svgContent = textPart.substring(textPart.indexOf("<svg"));
              if (svgContent.includes("</svg>")) {
                svgContent = svgContent.substring(0, svgContent.indexOf("</svg>") + 6);
              }
            }
            if (svgContent) {
              console.log(`Successfully generated dynamic render with model: ${model}`);
              break;
            }
          }
        } catch (err) {
          console.warn(`Failed call with model ${model}:`, err);
        }
      }
    }

    if (!svgContent && plan) {
      console.warn("Using fitted local dynamic SVG layout generator.");
      svgContent = generateDynamicFallbackSvg(plan);
    }

    if (!svgContent) {
      return Response.json({ error: "Failed to generate floor plan rendering." }, { status: 500 });
    }

    const base64Url = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
    return Response.json({
      imageUrl: base64Url,
      prompt: systemPrompt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate preview image.";
    console.error("Preview generation failed:", message);
    return Response.json({ error: message, prompt: "" }, { status: 502 });
  }
}
