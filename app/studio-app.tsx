"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Box, Check, ChevronRight, Download, History, Home, Map, RotateCcw, Ruler, Sparkles } from "lucide-react";
import { createProject, validatePlans } from "./plan-generator";
import { evaluateArchitecture } from "./architecture-validator";
import { evaluateBriefFeasibility } from "./layout-feasibility";
import HouseViewer from "./house-viewer";
import PlanEditor from "./plan-editor";
import { Brief, Project } from "./studio-types";

const EXAMPLE = "Create a modern ground-floor plan for a 40 ft x 60 ft east-facing plot. Include 2 bedrooms, 2 bathrooms, a living room, kitchen beside the dining room, a one-car garage, an internal staircase and a utility room. One bathroom should be attached. The road is on the east side. Prioritize ventilation, practical circulation and no room overlaps.";
type RevisionResponse = { ok?: boolean; brief?: Brief; changeSummary?: string; warnings?: string[]; errors?: string[]; changedFields?: string[]; error?: string };
type PlanVersion = { id: string; label: string; summary: string; createdAt: string; source: "initial" | "revision" | "regenerate"; project: Project };

function createPlanVersion(project: Project, number: number, summary: string, source: PlanVersion["source"]): PlanVersion {
  const snapshot = { ...project, version: number };
  return {
    id: `${snapshot.id}-v${number}`,
    label: `Version ${number}`,
    summary,
    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    source,
    project: snapshot,
  };
}

export default function StudioApp() {
  const [prompt, setPrompt] = useState(EXAMPLE); const [brief, setBrief] = useState<Brief | null>(null);
  const [project, setProject] = useState<Project | null>(null); const [selectedId, setSelectedId] = useState("");
  const [viewMode, setViewMode] = useState<"2d"|"3d">("2d");
  const [versionHistory, setVersionHistory] = useState<PlanVersion[]>([]); const [activeVersionId, setActiveVersionId] = useState("");
  const [revisionText, setRevisionText] = useState(""); const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState<{ kind: "ok" | "error"; summary: string; details: string[] }>({ kind: "ok", summary: "", details: [] });
  const [stage, setStage] = useState<"prompt"|"review"|"plan">("prompt"); const [loading, setLoading] = useState(false); const [apiError, setApiError] = useState("");
  const feasibility = useMemo(() => brief ? evaluateBriefFeasibility(brief) : null, [brief]);
  const architecture = useMemo(() => project ? evaluateArchitecture(project.brief, project.plans[0]) : null, [project]);
  const errors = useMemo(() => project ? [...validatePlans(project.plans), ...(architecture?.errors ?? [])] : [], [project, architecture]);

  async function understand() {
    setLoading(true); setApiError("");
    try {
      const response = await fetch("/api/parse-requirements", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({prompt}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not understand the prompt.");
      setBrief(data as Brief); setStage("review");
    } catch (error) { setApiError(error instanceof Error ? error.message : "Could not connect to the AI parser."); }
    finally { setLoading(false); }
  }
  function generate() {
    if (!brief) return;
    const report = evaluateBriefFeasibility(brief);
    if (!report.canGenerate) return;
    const entry = createPlanVersion(createProject(brief), 1, "Initial generated plan", "initial");
    setVersionHistory([entry]); setActiveVersionId(entry.id); setProject(entry.project); setSelectedId(""); setViewMode("2d"); setStage("plan");
  }
  function loadVersion(entry: PlanVersion) {
    setBrief(entry.project.brief); setProject(entry.project); setActiveVersionId(entry.id); setSelectedId(""); setRevisionText("");
    setRevisionFeedback({ kind: "ok", summary: `Loaded ${entry.label}.`, details: [entry.summary] });
  }
  function regenerateVersion() {
    if (!project) return;
    const entry = createPlanVersion(createProject(project.brief), versionHistory.length + 1, "Regenerated layout from current requirements", "regenerate");
    setVersionHistory(current => [...current, entry]); setActiveVersionId(entry.id); setProject(entry.project); setSelectedId(""); setViewMode("2d");
  }
  function exportPlan() { const canvas=document.querySelector(".plan-canvas canvas") as HTMLCanvasElement|null; if(!canvas)return; const link=document.createElement("a"); link.download="custom-floor-plan.png"; link.href=canvas.toDataURL("image/png"); link.click(); }
  async function applyRevision() {
    if (!project || revisionText.trim().length < 5) return;
    setRevisionLoading(true); setRevisionFeedback({ kind: "ok", summary: "", details: [] });
    try {
      const response = await fetch("/api/revise-requirements", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ currentBrief: project.brief, correction: revisionText.trim() }) });
      const data = await response.json() as RevisionResponse;
      if (!response.ok || !data.ok || !data.brief) throw new Error(data.error || data.errors?.join(" ") || data.changeSummary || "Could not apply that revision safely.");
      const nextProject = createProject(data.brief);
      const nextArchitecture = evaluateArchitecture(data.brief, nextProject.plans[0]);
      const nextErrors = [...validatePlans(nextProject.plans), ...nextArchitecture.errors];
      if (nextErrors.length) throw new Error(`Revision was not applied because it created ${nextErrors.length} geometry issue(s): ${nextErrors.slice(0, 2).join(" ")}`);
      const entry = createPlanVersion(nextProject, versionHistory.length + 1, data.changeSummary || "Revision applied", "revision");
      setBrief(data.brief); setProject(entry.project); setVersionHistory(current => [...current, entry]); setActiveVersionId(entry.id); setSelectedId(""); setRevisionText("");
      setRevisionFeedback({ kind: "ok", summary: data.changeSummary || "Revision applied.", details: [...(data.changedFields?.length ? [`Updated: ${data.changedFields.join(", ")}`] : []), ...(data.warnings ?? [])] });
    } catch (error) {
      setRevisionFeedback({ kind: "error", summary: error instanceof Error ? error.message : "Could not apply that revision safely.", details: ["Old plan was kept unchanged."] });
    } finally { setRevisionLoading(false); }
  }
  const unitMark = brief?.unit === "feet" ? "ft" : "m";

  return <main className="two-d-app">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Home size={18}/></span><span>Blueprint</span><em>Studio</em></div><div className="phase-pill"><span>PHASE 1</span> AI prompt to validated 2D plan</div></header>
    <nav className="simple-progress"><div className={stage!=="prompt"?"done":"active"}><span>{stage!=="prompt"?<Check/>:1}</span><b>Enter prompt</b></div><i/><div className={stage==="review"?"active":stage==="plan"?"done":""}><span>{stage==="plan"?<Check/>:2}</span><b>Verify requirements</b></div><i/><div className={stage==="plan"?"active":""}><span>3</span><b>Generate 2D plan</b></div></nav>

    {stage==="prompt" && <section className="prompt-only"><div className="prompt-intro"><span className="eyebrow"><Sparkles size={14}/> Live AI requirement parser</span><h1>Describe your home. <em>Verify before we draw.</em></h1><p>The AI extracts plot dimensions, orientation, rooms, features and adjacency rules. A deterministic geometry engine then creates the measurable plan.</p><div className="accuracy-rules"><h3>Accuracy rules</h3><span><Check/>No invented dimensions</span><span><Check/>No room overlaps</span><span><Check/>Plot boundary validation</span><span><Check/>Explicit facing and road side</span><span><Check/>Structured room coordinates</span></div></div><div className="prompt-card focused"><div className="card-heading"><span>01</span><div><h2>Custom prompt</h2><p>Edit the example and test your own requirements.</p></div></div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={10}/><div className="fixed-facts"><span><b>AI parsed</b> Requirements</span><span><b>Validated</b> Geometry</span><span><b>Up to 3</b> Floors</span></div>{apiError&&<div className="api-error"><AlertTriangle/>{apiError}</div>}<button className="primary-btn wide" onClick={understand} disabled={loading||prompt.trim().length<20}>{loading?"Understanding your prompt...":<>Understand this request <ChevronRight size={17}/></>}</button></div></section>}

    {stage==="review" && brief && <section className="review-screen"><div className="section-intro"><span className="eyebrow">AI extraction complete</span><h1>Confirm the requirements.</h1><p>The layout engine will use only these structured inputs.</p></div><div className="requirement-sheet"><div className="sheet-head"><div><small>PROJECT</small><h2>{brief.title}</h2></div><span>{brief.floors} {brief.floors===1?"floor":"floors"}</span></div><div className="requirement-grid"><article><small>PLOT</small><b>{brief.plotWidth} x {brief.plotDepth} {unitMark}</b><p>Facing {brief.facing}; road on the {brief.roadSide} side.</p></article><article><small>PRIVATE SPACES</small><b>{brief.bedrooms} bedrooms / {brief.bathrooms} bathrooms</b><p>Counts extracted directly from your prompt.</p></article><article><small>SHARED SPACES</small><b>{brief.livingRooms} living / {brief.kitchens} kitchen / {brief.diningRooms} dining</b><p>{brief.adjacency.length?brief.adjacency.join("; "):"No special adjacency rule supplied."}</p></article><article><small>FEATURES</small><b>{brief.features.length?brief.features.map(x=>x.replaceAll("_"," ")).join(" / "):"None specified"}</b><p>{brief.style} design direction.</p></article></div>{brief.warnings.length>0&&<div className="warning-list"><h3><AlertTriangle/> Review note</h3>{brief.warnings.map(w=><span key={w}>{w}</span>)}</div>}{feasibility&&feasibility.issues.length>0&&<div className="warning-list"><h3><AlertTriangle/> Feasibility check</h3>{feasibility.issues.map(issue=><span key={issue.message}>{issue.message}</span>)}</div>}<div className="constraint-list"><h3>Automatic geometry checks</h3>{["No overlapping rooms","Every room remains inside the plot","Doors remain attached to rooms","Dimensions use the selected unit",feasibility?.canGenerate?"Program fits the plot":"Program must fit before generation"].map(x=><span key={x}><Check/>{x}</span>)}</div></div><div className="stage-actions"><button className="secondary-btn" onClick={()=>setStage("prompt")}>Correct prompt</button><button className="primary-btn" onClick={generate} disabled={!!feasibility&&!feasibility.canGenerate}>{feasibility&&!feasibility.canGenerate?"Adjust prompt to fit plot":<>Generate structured 2D plan <ChevronRight size={17}/></>}</button></div></section>}

    {stage==="plan" && project && <section className="plan-result"><aside className="plan-summary"><span className="eyebrow">Generated plan</span><h2>{project.brief.title}</h2><p>{project.brief.facing}-facing {project.brief.plotWidth} x {project.brief.plotDepth} {project.brief.unit}</p><div className="orientation-card"><b>N</b><span>ROAD - {project.brief.roadSide.toUpperCase()} SIDE</span><strong>&rarr;</strong></div><div className="validation-card"><div className={errors.length?"status error":"status valid"}>{errors.length?<AlertTriangle/>:<Check/>}<span><b>{errors.length?"Needs correction":"Architecture checked"}</b><small>{errors.length?`${errors.length} blocking issue(s)`:architecture?`Quality score ${architecture.score}/100`:"No overlaps or boundary errors"}</small></span></div>{errors.map(e=><p key={e}>{e}</p>)}{!errors.length&&architecture?.warnings.map(w=><p className="arch-warning" key={w}>{w}</p>)}</div>{versionHistory.length>0&&<div className="version-card"><h3><History size={13}/> Versions</h3>{versionHistory.map(entry=><button key={entry.id} className={activeVersionId===entry.id?"active":""} onClick={()=>loadVersion(entry)}><span><b>{entry.label}</b><small>{entry.summary}</small></span><em>{entry.createdAt}</em></button>)}</div>}<div className="revision-card"><h3><Sparkles size={13}/> Revise this plan</h3><textarea value={revisionText} onChange={e=>setRevisionText(e.target.value)} rows={4} placeholder="Example: move kitchen closer to dining, make hallway wider, add porch near entry."/><button className="primary-btn wide" onClick={applyRevision} disabled={revisionLoading||revisionText.trim().length<5}>{revisionLoading?"Applying safely...":<>Apply revision <ChevronRight size={15}/></>}</button>{revisionFeedback.summary&&<div className={revisionFeedback.kind==="error"?"revision-feedback error":"revision-feedback"}><b>{revisionFeedback.summary}</b>{revisionFeedback.details.map(item=><span key={item}>{item}</span>)}</div>}</div><div className="room-key"><h3>Room schedule</h3>{project.plans[0].rooms.map(r=><button key={r.id} className={selectedId===r.id?"active":""} onClick={()=>setSelectedId(r.id)}><i style={{background:r.color}}/><span>{r.name}</span><small>{r.width.toFixed(1)} x {r.depth.toFixed(1)}</small></button>)}</div><div className="next-phase preview-ready"><b>3D preview unlocked</b><span>Generated from this exact 2D room geometry.</span></div></aside><div className="plan-board"><div className="board-toolbar"><span><Ruler/>Structured geometry / measurements in {project.brief.unit}</span><div><button onClick={()=>setStage("review")}><ArrowLeft/> Back</button><button className={viewMode==="2d"?"active":""} onClick={()=>setViewMode("2d")}><Map/> 2D Plan</button><button className={viewMode==="3d"?"active":""} onClick={()=>setViewMode("3d")}><Box/> 3D Preview</button><button onClick={regenerateVersion}><RotateCcw/> Regenerate</button>{viewMode==="2d"&&<button className="primary-btn" onClick={exportPlan}><Download/> Download PNG</button>}</div></div>{viewMode==="2d"?<PlanEditor plan={project.plans[0]} selectedId={selectedId} onSelect={setSelectedId} onUpdate={()=>{}}/>:<div className="preview-canvas"><HouseViewer plans={project.plans} materials={project.materials} selectedId={selectedId} onSelect={setSelectedId} activeFloor={0} showCeiling={false} cutaway={false} mode="orbit" interiors={true}/></div>}<div className="board-footer"><span>{viewMode==="2d"?"Concept floor plan - requires architect review before construction.":"Preview model - walls are generated from the approved 2D structure."}</span><button className="approve-btn" disabled={errors.length>0}><Check/> Mark 2D plan as approved</button></div></div></section>}
  </main>;
}
