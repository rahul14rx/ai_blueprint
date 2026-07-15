# AI Home Design Studio

AI Home Design Studio is a local web app for turning a natural-language home design prompt into structured 2D floor-plan data. The current project focus is Phase 1: accurate prompt-to-2D planning.

The important idea is that the app does not generate a random floor-plan image first. It extracts requirements, creates measured room geometry, validates the plan, and then renders the drawing. That structured data is what can later become real 3D walls, floors, ceilings, doors, windows, stairs, and interiors.

## Current Phase

```text
Prompt
-> AI requirement extraction
-> User confirmation
-> Structured 2D floor-plan generation
-> Geometry and architecture validation
-> PNG export
```

3D generation is intentionally locked for a later phase so the 2D planning engine can become reliable first.

## What Works Now

- Prompt input for custom home design briefs.
- Gemini-backed requirement parser.
- Requirement review screen before generation.
- Feasibility check before creating a plan.
- Structured room data with dimensions in feet.
- Deterministic 2D layout generator.
- Candidate layout optimization instead of pure random placement.
- Room overlap and plot-boundary validation.
- Architectural checks for access, doors, circulation, garage entry, and wet-room ventilation.
- Blueprint-style renderer with walls, labels, room dimensions, doors, windows, vents, furniture symbols, road side, north marker, and entry/gate marker.
- PNG download.
- Golden quality tests for multiple plot sizes and facing directions.

## Specialities

### Structured First, Image Second

The app produces floor-plan data before drawing anything. A room is not just pixels on a canvas; it has a type, position, width, depth, doors, windows, vents, and validation status.

This makes the project suitable for future 3D conversion.

### Prompt-To-Requirements Parser

The API route at `app/api/parse-requirements/route.ts` reads a user prompt and returns normalized project requirements:

- plot width and depth
- facing direction
- road side
- bedroom and bathroom count
- shared spaces
- garage, stairs, utility, laundry, porch, pantry, store, study, and other requested features
- adjacency hints such as kitchen beside dining
- style and notes

### Feasibility Gate

Before generating a plan, the app checks whether the requested rooms can realistically fit inside the plot. If the prompt asks for too much in a tiny plot, the app blocks generation instead of producing a fake-looking plan.

Core file:

```text
app/layout-feasibility.ts
```

### Layout Program Builder

The app turns the parsed brief into a room program: required rooms, minimum sizes, preferred locations, and adjacency needs.

Core file:

```text
app/layout-program.ts
```

### Rule-Based Planning Engine

The floor-plan generator uses architectural rules rather than only equal grid division. It tries to place public rooms, private rooms, service rooms, hallway/circulation, garage, stairs, and utility zones in a practical way.

Core files:

```text
app/plan-generator.ts
app/layout-optimizer.ts
app/layout-rules.ts
```

### Architecture Validator

The validator catches important problems after generation:

- rooms outside the plot
- overlapping rooms
- bedrooms without usable doors
- bathrooms without valid access
- garage missing vehicle-side access
- kitchen/dining adjacency problems when explicitly requested
- internal bathrooms without vents
- wet rooms without ventilation paths
- undersized important rooms

Core file:

```text
app/architecture-validator.ts
```

### Blueprint Renderer

The renderer draws the structured plan as a blueprint-like 2D drawing. It supports:

- thick exterior walls
- interior partition walls
- room labels and dimensions
- hinged doors
- windows
- vent grille marks
- furniture symbols
- stair graphics
- garage/car graphic
- road/facing labels
- entry/gate marker

Core file:

```text
app/plan-editor.tsx
```

## Main Files

```text
app/studio-app.tsx                     Main UI and step-by-step workflow
app/api/parse-requirements/route.ts    Gemini requirement parser
app/plan-generator.ts                  Generates structured 2D floor plans
app/plan-editor.tsx                    Draws the floor plan
app/studio-types.ts                    Shared TypeScript types
app/layout-rules.ts                    Room rules and architectural helpers
app/layout-program.ts                  Converts brief into room program
app/layout-optimizer.ts                Candidate layout optimizer
app/layout-feasibility.ts              Pre-generation feasibility checks
app/architecture-validator.ts          Post-generation quality checks
tests/floor-plan-quality.test.mjs      Golden floor-plan quality tests
```

## Example Prompt

```text
Create a modern ground-floor plan for a 40 ft x 60 ft east-facing plot.
Include 2 bedrooms, 2 bathrooms, a living room, kitchen beside the dining room,
a one-car garage, an internal staircase and a utility room. One bathroom should
be attached. The road is on the east side. Prioritize ventilation, practical
circulation and no room overlaps.
```

## Local Setup

### Prerequisites

- Node.js `>=22.13.0`
- A Gemini API key

### Install

```bash
npm install
```

### Environment

Create `.env.local`:

```env
GEMINI_API_KEY=your_real_gemini_key_here
GEMINI_MODEL=gemini-2.5-flash
```

Do not commit `.env.local`. It is ignored by git.

### Run

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Verify

```bash
npm run lint
npm test
```

## Current Validation Coverage

The project currently tests multiple prompt styles and plot conditions:

- 40 ft x 60 ft east-facing 2 bedroom plan with garage, stairs, utility, attached bath
- 30 ft x 40 ft south-facing compact plan with porch and rounded living request
- 28 ft x 42 ft south-facing 3 bedroom plan with full bath, half bath, laundry, and central hall
- 26 ft x 36 ft west-facing compact 1 bedroom plan
- 32 ft x 44 ft north-facing 2 bedroom plan without dining
- 36 ft x 54 ft west-facing plan with garage and stairs
- 48 ft x 70 ft north-facing larger 4 bedroom plan
- impossible overloaded prompt that should be blocked by feasibility checks

## Roadmap

### Phase 1: Accurate 2D Floor Plans

Status: in progress.

Tasks:

- Improve layout variety so plans do not feel equally divided.
- Add more candidate planning strategies for different plot shapes and room counts.
- Improve curved/rounded room support without breaking geometry.
- Add stronger rules for natural light and exterior wall access.
- Add better room-to-room relationship scoring.
- Add clearer dimension strings around the outside of the plan.
- Improve blueprint styling so it looks cleaner and less heavy.
- Add plan warnings that explain why a layout was chosen.
- Add more golden tests for unusual user prompts.

### Phase 2: 2D To 3D Structure

Tasks:

- Convert 2D wall segments into 3D wall geometry.
- Generate floors, ceilings, doors, and windows from structured data.
- Add basic orbit camera.
- Add floor height, wall thickness, and slab thickness controls.
- Export simple GLB/3D scene.

### Phase 3: Interiors

Tasks:

- Ask user for interior style.
- Place furniture based on room type.
- Apply materials, wall colors, flooring, and lighting.
- Add kitchen counters, bathroom fixtures, wardrobes, beds, sofas, and dining sets.

### Phase 4: Interactive Viewer

Tasks:

- Add orbit mode.
- Add first-person walkthrough mode.
- Add room labels/toggles in 3D.
- Add screenshot/export controls.

### Phase 5: Project System

Tasks:

- Save projects.
- Restore previous versions.
- Compare generated plan alternatives.
- Export PDF.
- Export PNG/SVG.
- Export GLB.

## Known Limitations

- The app is not a replacement for a licensed architect or structural engineer.
- Current plans are concept-level, not construction drawings.
- The layout engine still needs better spatial reasoning for complex or highly custom prompts.
- Rounded or curved room requests are supported visually only in limited ways.
- Building-code, structure, plumbing, electrical, and local regulation checks are not complete yet.

## Development Direction

The project should continue improving accuracy by using this order:

1. Parse the prompt into structured requirements.
2. Check feasibility before layout.
3. Generate multiple candidate layouts.
4. Score each layout using architectural rules.
5. Pick the best valid candidate.
6. Validate doors, circulation, room sizes, ventilation, and road access.
7. Render only after the plan data passes checks.

This keeps the app moving toward reliable floor-plan generation instead of becoming a simple image generator.
