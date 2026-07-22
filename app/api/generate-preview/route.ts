import { FloorPlan } from "../../studio-types";

// --- 1. Dynamic styled technical floor plan SVG renderer (Fallback & Design Template) ---

function generateDynamicFallbackSvg(plan: FloorPlan): string {
  const scale = 14;
  const w = plan.width * scale;
  const h = plan.depth * scale;

  const roomsSvg = plan.rooms.map(room => {
    const rx = room.x * scale;
    const ry = room.y * scale;
    const rw = room.width * scale;
    const rh = room.depth * scale;

    let fillPattern = "wood-pattern";
    if (room.type === "kitchen") fillPattern = "tile-pattern";
    else if (room.type === "bathroom") fillPattern = "tile-pattern-dark";
    else if (room.type === "bedroom") fillPattern = "carpet-pattern";

    // Draw realistic vector furniture blocks inside
    const furnSvg = (room.furniture || []).map(f => {
      const fx = rx + 8;
      const fy = ry + 8;
      const fw = Math.min(rw - 16, f.width * scale);
      const fh = Math.min(rh - 16, f.depth * scale);

      if (f.name.toLowerCase().includes("couch") || f.name.toLowerCase().includes("sofa")) {
        return `
          <g filter="url(#drop-shadow)">
            <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="#fcfaf2" stroke="#bbb" stroke-width="1.2" rx="4" />
            <line x1="${fx + fw / 2}" y1="${fy}" x2="${fx + fw / 2}" y2="${fy + fh}" stroke="#ddd" stroke-width="1" />
            <rect x="${fx + 2}" y="${fy + 2}" width="${fw - 4}" height="${fh * 0.2}" fill="#e8e5dc" rx="1" />
          </g>
        `;
      }
      if (f.name.toLowerCase().includes("bed")) {
        return `
          <g filter="url(#drop-shadow)">
            <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="#fff" stroke="#ccc" stroke-width="1.2" rx="2" />
            <rect x="${fx + 2}" y="${fy + 2}" width="${fw - 4}" height="${fh * 0.25}" fill="#a3b19b" rx="1" />
            <rect x="${fx + 4}" y="${fy + 4}" width="${(fw - 12) / 2}" height="${fh * 0.15}" fill="#fff" rx="1" />
            <rect x="${fx + fw / 2 + 2}" y="${fy + 4}" width="${(fw - 12) / 2}" height="${fh * 0.15}" fill="#fff" rx="1" />
          </g>
        `;
      }
      return `
        <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="#fcfcfc" stroke="#aaa" stroke-width="1" rx="2" filter="url(#drop-shadow)" />
        <text x="${fx + fw / 2}" y="${fy + fh / 2 + 3}" font-family="Arial" font-size="8" fill="#666" text-anchor="middle">${f.name}</text>
      `;
    }).join("\n");

    return `
      <g>
        <!-- Room floor fill -->
        <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="url(#${fillPattern})" />
        
        <!-- Room walls -->
        <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="#222" stroke-width="4" filter="url(#wall-shadow)" />
        
        <!-- Room label -->
        <rect x="${rx + rw / 2 - 45}" y="${ry + rh / 2 - 10}" width="90" height="20" fill="#ffffffd0" rx="3" />
        <text x="${rx + rw / 2}" y="${ry + rh / 2 + 4}" font-family="Arial" font-weight="bold" font-size="11" fill="#111" text-anchor="middle">${room.name}</text>
        
        <!-- Furniture -->
        ${furnSvg}
      </g>
    `;
  }).join("\n");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%">
      <defs>
        <!-- Gradients and Patterns -->
        <pattern id="wood-pattern" width="30" height="30" patternUnits="userSpaceOnUse">
          <rect width="30" height="30" fill="#e8d7c3" />
          <line x1="0" y1="10" x2="30" y2="10" stroke="#dfcbab" stroke-width="1" />
          <line x1="0" y1="20" x2="30" y2="20" stroke="#dfcbab" stroke-width="1" />
          <line x1="0" y1="30" x2="30" y2="30" stroke="#dfcbab" stroke-width="1" />
        </pattern>
        <pattern id="tile-pattern" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#f0f3f5" />
          <rect width="11" height="11" fill="#fff" />
        </pattern>
        <pattern id="tile-pattern-dark" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill="#d2dfdf" />
          <rect width="9" height="9" fill="#e2efef" />
        </pattern>
        <pattern id="carpet-pattern" width="15" height="15" patternUnits="userSpaceOnUse">
          <rect width="15" height="15" fill="#f2ede4" />
          <circle cx="7.5" cy="7.5" r="1.5" fill="#e6dec8" />
        </pattern>
        
        <!-- Shadows -->
        <filter id="wall-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="2" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="0.22" />
        </filter>
        <filter id="drop-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1.5" dy="1.5" stdDeviation="1.5" flood-color="#000" flood-opacity="0.16" />
        </filter>
      </defs>
      
      <!-- Base Plot Background -->
      <rect width="100%" height="100%" fill="#fafafa" />
      
      <!-- Styled Rooms -->
      ${roomsSvg}
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
    const configuredModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    const modelsToTry = [
      configuredModel,
      "gemini-3.5-flash-lite",
      "gemini-1.5-flash-latest",
      "gemini-flash-latest",
      "gemini-pro-latest"
    ];

    let svgContent = "";

    if (apiKey && !apiKey.includes("paste_your") && rawBase64) {
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
      console.warn("Using fallback local dynamic SVG layout generator.");
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