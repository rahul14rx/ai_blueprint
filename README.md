# Blueprint Studio

Blueprint Studio is an AI Home Design Studio focused on turning a natural-language house prompt into structured floor-plan data first, then rendering that data as a clean 2D plan and an explorable 3D model.

The core rule of the project is simple: do not generate a random image as the source of truth. The app extracts requirements, creates measured room geometry, validates the result, and only then renders 2D, 3D, and styled previews from the same structured plan.

## Current Completion Snapshot

Approximate status: 35% to 40% of the full product vision.

The current version is no longer just Phase 1 2D. We now have a working prototype that covers:

- Tester login
- Project dashboard
- Saved projects
- Single-floor generation
- Multi-floor setup up to 3 floors
- 2D blueprint plan
- Styled 2D render preview
- 3D orbit preview
- 3D walk mode
- Doors and windows generated from the plan data
- Door interaction in walkthrough mode
- Basic wall selection and inspection
- Door/window replacement from the 3D view
- Add-window action on exterior walls
- Version history for plan changes
- Prompt-based revision flow
- Roof style controls
- Multi-floor 2D comparison
- Early stacked multi-floor 3D

The app is still a concept and validation tool, not construction-ready architectural software.

## Product Flow

```text
Login
-> Create or open project
-> Choose single-floor or multi-floor
-> Enter prompt
-> AI extracts requirements
-> User verifies requirements
-> Engine generates structured 2D plan
-> App validates architecture and geometry
-> User views 2D, styled 2D render, or 3D
-> User can revise, regenerate, inspect, and edit openings
```

## What Works Now

### Authentication And Projects

- Tester login accounts exist for early testing.
- Projects are stored through Supabase.
- Users can create, open, and delete projects.
- Saved projects restore the generated design instead of forcing a new prompt every time.

Current tester accounts:

```text
tester1 / 1
tester2 / 1
tester3 / 1
tester4 / 1
tester5 / 1
```

### Prompt Understanding

- Gemini-backed requirement parser.
- Parses plot size, facing direction, road side, floors, room counts, features, style, and adjacency hints.
- Blocks obvious contradictions or unrealistic prompts before generation where possible.

### 2D Floor Planning

- Structured room coordinates.
- Deterministic layout generation.
- Candidate generators and optimizer trace.
- Geometry validation for overlaps and plot boundaries.
- Architecture validation for access, doors, circulation, room sizes, and ventilation warnings.
- Blueprint-style 2D renderer with:
  - exterior and interior walls
  - room labels
  - dimensions
  - hinged doors
  - windows
  - vents
  - furniture symbols
  - stairs
  - garage marker
  - entry/gate marker
  - road and facing labels

### Styled 2D Render

- Reina branch work was integrated.
- The app can show a more visual 2D render with furniture and textures.
- Preview versions can be regenerated and selected.

### 3D Preview

- 3D model is generated from the same structured 2D room data.
- Uses Three.js through React Three Fiber.
- Supports orbit mode and first-person walk mode.
- Includes walls, floors, doors, windows, labels, furniture blocks, balconies, grass ground, shadows, and basic roof options.
- Floor visibility controls exist for stacked multi-floor preview.

### 3D Interaction

- Walk mode supports basic movement.
- Door interaction works with `E` near doors.
- Closed doors affect movement better than before.
- 3D selection inspector can identify rooms, walls, doors, and windows.
- Door/window replacement is supported from the 3D view.
- Adding windows to exterior walls is supported with validation so it avoids crowded wall sections.

### Multi-Floor Direction

- User can create multi-floor projects up to 3 floors.
- Each floor is generated one at a time.
- Upper floors reuse the staircase location from the floor below.
- 2D multi-floor comparison can show floors side by side.
- 3D stacked-floor preview exists, but stair travel and slab openings still need more work.

## Main Files

```text
app/studio-app.tsx                     Main UI, project flow, versions, revisions, 2D/3D controls
app/house-viewer.tsx                   3D viewer, walk/orbit, doors, windows, roofs, selection tools
app/plan-editor.tsx                    Technical 2D blueprint renderer
app/preview-view.tsx                   Styled 2D render preview
app/api/parse-requirements/route.ts    Gemini requirement parser
app/api/revise-requirements/route.ts   Prompt-based revision parser
app/api/projects/route.ts              Supabase project persistence API
app/api/tester-login/route.ts          Tester login API
app/api/generate-preview/route.ts      2D preview generation API
app/plan-generator.ts                  Structured 2D plan generator
app/layout-optimizer.ts                Candidate selection and scoring
app/layout-program.ts                  Converts brief into room program
app/layout-rules.ts                    Architectural room rules
app/layout-feasibility.ts              Pre-generation feasibility checks
app/architecture-validator.ts          Post-generation quality checks
app/plan-3d-geometry.ts                Converts rooms/openings into 3D wall segments
app/plan-openings.ts                   Door/window/vent placement helpers
app/studio-types.ts                    Shared TypeScript types
tests/floor-plan-quality.test.mjs      Floor-plan quality tests
```

## Current Specialities

### Structured Data First

Every room is represented as data:

```text
type, x, y, width, depth, openings, furniture, validation status
```

This allows the same plan to power:

- technical 2D blueprint
- styled 2D render
- 3D walls and floors
- doors and windows
- future exports

### Candidate Generator Trace

The engine does not blindly trust one layout. It can compare layout candidates and show which one won or failed.

Example:

```text
Optimizer primary: east-west-central-spine - WIN
Legacy generator: east-west heuristic - FAIL
Repair: service access - OK
```

This is important for accuracy because it lets us see why a plan was chosen.

### Safe Revisions

The revision box can modify the current plan through a prompt. If a revision creates geometry errors, the old plan is kept unchanged.

### Editable Openings

The 3D view can inspect and modify openings:

- Replace door with window
- Replace window with door
- Add a window to a selected exterior wall

The add-window logic now maps the clicked 3D wall back to the room data and avoids existing openings.

## Local Setup

### Install

```bash
npm install
```

### Environment

Create `.env.local`:

```env
GEMINI_API_KEY=your_real_gemini_key_here
GEMINI_MODEL=gemini-2.5-flash

SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_secret_service_role_key
```

Do not commit `.env.local`.

### Run

```bash
npm run dev
```

Open:

```text
http://localhost:8000
```

If port `8000` is busy, Vite may move to the next available port.

### Verify

```bash
npm run build
npm run lint
npm test
```

Known lint warning:

```text
app/preview-view.tsx uses an <img> tag
```

This warning is currently non-blocking.

## Suggested Test Prompt

```text
Create a spacious modern single-floor house for a 50 ft x 70 ft east-facing plot with the road and main entrance on the east side. Include 3 bedrooms, 3 bathrooms, a living room, dining room, kitchen, pantry, utility room, laundry room, pooja room, study room, foyer, central hallway, and one-car garage.

Place the foyer and living room near the east/main entrance. Place the garage on the east/front side with an internal door into the house. Put the dining room beside the kitchen, and connect the pantry and utility directly to the kitchen. Put the laundry near the utility room. Put the pooja room near the living or dining area. Put the study near the foyer but separate from bedrooms.

Place all bedrooms on the quieter west side. Make Bedroom 1 the master bedroom with an attached bathroom and wardrobe niche. Bedrooms 2 and 3 should each have access from the hallway. Bathroom 2 should be attached to Bedroom 2. Bathroom 3 should be a common bathroom opening from the hallway.

Use a clear central hallway at least 5 ft wide. Every enclosed room must have a usable door connected to a hallway, foyer, living room, kitchen, garage, or parent bedroom. Every bedroom must have at least one exterior window. Add exterior windows to living room, kitchen, dining room, study, bathrooms, and utility wherever possible. Keep bathroom windows smaller and higher for privacy.

Use practical circulation, proper ventilation, realistic room sizes, no blind leftover spaces, no room overlaps, and keep every room completely inside the 50 ft x 70 ft plot.
```

## Remaining Work

### Highest Priority: 2D Accuracy

- Improve door ownership and placement.
- Ensure attached bathrooms always open directly from the correct bedroom.
- Remove blind leftover pockets.
- Avoid useless oversized blank zones.
- Improve bedroom, bathroom, hallway, and service-room relationships.
- Strengthen hallway reachability checks.
- Improve room-size balancing so plans do not feel equally divided.
- Add stronger tests for tricky prompts.

### 3D Polish

- Improve wall colors, trims, shadows, and readable interior contrast.
- Add better window styles, curtains, and sizing rules.
- Improve balcony visuals and balcony doors.
- Improve roof fitting and roof templates.
- Improve floor slab edges and stacked-floor alignment.

### Staircase Accuracy

- Make one staircase connect floor 1 to floor 2 realistically.
- Add correct slab opening above stairs.
- Make walk mode climb stairs smoothly without needing jumps.
- Support stair types such as straight, L-shaped, U-shaped, and spiral.

### Multi-Floor Completion

- Stack up to 3 floors cleanly in 3D.
- Add floor controls for floor 1, floor 2, floor 3, and combined view.
- Preserve stair alignment across floors.
- Add 2D floor switcher and side-by-side comparison.
- Add multi-floor project save/restore completeness checks.

### Editing Tools

- Add wall click actions:
  - add door
  - add window
  - replace existing door/window
  - delete opening
- Add safer validation before each edit.
- Show clear user feedback when an edit is blocked.

### Export And Sharing

- Export PDF.
- Export SVG.
- Export GLB.
- Save screenshots.
- Compare plan versions.
- Share project snapshots.

## Known Limitations

- Not construction-ready.
- Not a replacement for licensed architects or engineers.
- Local building code, structural, plumbing, and electrical rules are not complete.
- 2D generation can still produce architectural mistakes in complex prompts.
- Staircase travel is partially working, but not fully realistic yet.
- Roofs are visual templates and not complete structural roof systems.
- 3D collision and editing are still early-stage.

## Development Strategy

The safest path forward is:

1. Keep the current working flow stable.
2. Improve one accuracy rule at a time.
3. Add tests before changing broad layout behavior.
4. Let the generator produce multiple candidates.
5. Score each candidate with architectural rules.
6. Reject bad plans before they reach the UI.
7. Keep 2D as the source of truth for 3D.

That keeps the project moving toward reliable AI-assisted architecture instead of becoming a fragile image generator.
