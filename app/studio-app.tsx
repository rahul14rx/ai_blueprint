"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Download, Home, RotateCcw, Ruler, Sparkles } from "lucide-react";
import { createProject, parseBrief, validatePlans } from "./plan-generator";
import { Brief, Project } from "./studio-types";

const PlanEditor = dynamic(() => import("./plan-editor"), { ssr: false });
const EXAMPLE = "Create a modern ground-floor plan for a 40 ft × 60 ft east-facing plot. Include 2 bedrooms, 2 bathrooms, a living room, kitchen beside the dining room, a one-car garage, an internal staircase and a utility room. One bathroom should be attached. The road is on the east side. Prioritize ventilation, practical circulation and no room overlaps.";

export default function StudioApp() {
  const [prompt, setPrompt] = useState(EXAMPLE);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [stage, setStage] = useState<"prompt" | "review" | "plan">("prompt");
  const errors = useMemo(() => project ? validatePlans(project.plans) : [], [project]);

  const understand = () => {
    const parsed = parseBrief(prompt, { title: "East-facing family home", floors: 1, plotWidth: 40, plotDepth: 60, bedrooms: 2, bathrooms: 2, style: "Modern" });
    setBrief(parsed); setStage("review");
  };
  const generate = () => { if (!brief) return; setProject(createProject(brief)); setStage("plan"); };
  const exportPlan = () => {
    const canvas = document.querySelector(".plan-canvas canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement("a"); link.download = "east-facing-ground-floor-plan.png"; link.href = canvas.toDataURL("image/png"); link.click();
  };

  return <main className="two-d-app">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Home size={18}/></span><span>Blueprint</span><em>Studio</em></div><div className="phase-pill"><span>PHASE 1</span> Accurate 2D floor plan only</div></header>
    <nav className="simple-progress"><div className={stage !== "prompt" ? "done" : "active"}><span>{stage !== "prompt" ? <Check/> : 1}</span><b>Enter prompt</b></div><i/><div className={stage === "review" ? "active" : stage === "plan" ? "done" : ""}><span>{stage === "plan" ? <Check/> : 2}</span><b>Verify requirements</b></div><i/><div className={stage === "plan" ? "active" : ""}><span>3</span><b>Generate 2D plan</b></div></nav>

    {stage === "prompt" && <section className="prompt-only"><div className="prompt-intro"><span className="eyebrow"><Sparkles size={14}/> Start with one reliable case</span><h1>Generate the ground-floor plan <em>before touching 3D.</em></h1><p>This first milestone creates a structured, measurable 2D plan. Every room is stored as real coordinates so the same walls can be raised accurately later.</p><div className="accuracy-rules"><h3>Accuracy rules</h3><span><Check/>40 × 60 ft plot boundary</span><span><Check/>No room overlaps</span><span><Check/>East-facing road and entrance</span><span><Check/>Connected circulation</span><span><Check/>Kitchen beside dining</span></div></div><div className="prompt-card focused"><div className="card-heading"><span>01</span><div><h2>Reference prompt</h2><p>We will use this exact case until the result is correct.</p></div></div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={10}/><div className="fixed-facts"><span><b>40 × 60 ft</b> Plot</span><span><b>East</b> Road side</span><span><b>1</b> Floor now</span></div><button className="primary-btn wide" onClick={understand}>Understand this request <ChevronRight size={17}/></button></div></section>}

    {stage === "review" && brief && <section className="review-screen"><div className="section-intro"><span className="eyebrow">Check before generating</span><h1>Confirm the requirements.</h1><p>The plan will use only these verified inputs.</p></div><div className="requirement-sheet"><div className="sheet-head"><div><small>PROJECT</small><h2>East-facing family home</h2></div><span>Ground floor</span></div><div className="requirement-grid"><article><small>PLOT</small><b>40 × 60 feet</b><p>Road and main entrance on the east side.</p></article><article><small>PRIVATE SPACES</small><b>2 bedrooms · 2 bathrooms</b><p>One bathroom attached to a bedroom.</p></article><article><small>SHARED SPACES</small><b>Living · Kitchen · Dining</b><p>Kitchen must be directly beside dining.</p></article><article><small>SERVICE SPACES</small><b>Garage · Stairs · Utility</b><p>One-car garage and internal staircase.</p></article></div><div className="constraint-list"><h3>Mandatory checks</h3>{["No overlapping rooms", "Every room remains inside the plot", "Usable circulation connects all spaces", "Doors and windows stay on valid walls", "Ventilation openings on external walls"].map(x=><span key={x}><Check/>{x}</span>)}</div></div><div className="stage-actions"><button className="secondary-btn" onClick={()=>setStage("prompt")}>Edit prompt</button><button className="primary-btn" onClick={generate}>Generate structured 2D plan <ChevronRight size={17}/></button></div></section>}

    {stage === "plan" && project && <section className="plan-result"><aside className="plan-summary"><span className="eyebrow">Generated plan</span><h2>Ground floor</h2><p>East-facing 40 × 60 ft concept</p><div className="orientation-card"><b>N</b><span>ROAD — EAST SIDE</span><strong>→</strong></div><div className="validation-card"><div className={errors.length ? "status error" : "status valid"}>{errors.length ? <AlertTriangle/> : <Check/>}<span><b>{errors.length ? "Needs correction" : "Geometry passed"}</b><small>{errors.length ? `${errors.length} blocking issue(s)` : "No overlaps or boundary errors"}</small></span></div>{errors.map(e=><p key={e}>{e}</p>)}</div><div className="room-key"><h3>Room schedule</h3>{project.plans[0].rooms.map(r=><button key={r.id} className={selectedId===r.id?"active":""} onClick={()=>setSelectedId(r.id)}><i style={{background:r.color}}/><span>{r.name}</span><small>{Math.round(r.width)}′ × {Math.round(r.depth)}′</small></button>)}</div><div className="next-phase"><b>3D remains locked</b><span>We only proceed after this plan is approved as accurate.</span></div></aside><div className="plan-board"><div className="board-toolbar"><span><Ruler/>Structured geometry · measurements in feet</span><div><button onClick={()=>{setProject(createProject(project.brief));setSelectedId("");}}><RotateCcw/> Regenerate</button><button className="primary-btn" onClick={exportPlan}><Download/> Download PNG</button></div></div><PlanEditor plan={project.plans[0]} selectedId={selectedId} onSelect={setSelectedId} onUpdate={()=>{}}/><div className="board-footer"><span>Concept floor plan — requires architect review before construction.</span><button className="approve-btn" disabled={errors.length>0}><Check/> Mark 2D plan as approved</button></div></div></section>}
  </main>;
}
