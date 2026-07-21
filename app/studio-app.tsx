"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Box, Check, ChevronRight, Download, Footprints, History, Home, Map, Plus, RotateCcw, Ruler, Sparkles, Trash2, X } from "lucide-react";
import { createProject, validatePlans } from "./plan-generator";
import { evaluateArchitecture } from "./architecture-validator";
import { evaluateBriefFeasibility } from "./layout-feasibility";
import HouseViewer from "./house-viewer";
import PlanEditor from "./plan-editor";
import { Brief, FloorPlan, MaterialSet, Project } from "./studio-types";

const EXAMPLE = "Create a modern ground-floor plan for a 40 ft x 60 ft east-facing plot. Include 2 bedrooms, 2 bathrooms, a living room, kitchen beside the dining room, a one-car garage, an internal staircase and a utility room. One bathroom should be attached. The road is on the east side. Prioritize ventilation, practical circulation and no room overlaps.";
type RevisionResponse = { ok?: boolean; brief?: Brief; changeSummary?: string; warnings?: string[]; errors?: string[]; changedFields?: string[]; error?: string };
type TesterLoginResponse = { ok?: boolean; tester?: { id: string; username: string }; error?: string };
type ProjectsResponse = { ok?: boolean; projects?: SavedProject[]; project?: SavedProject; error?: string };
type PlanVersion = { id: string; label: string; summary: string; createdAt: string; source: "initial" | "revision" | "regenerate"; project: Project };
type SavedProject = { id: string; name: string; houseType: "single" | "multi"; floors: 1 | 2 | 3; createdAt: string; updatedAt: string; prompt?: string; brief?: Brief | null; designProject?: Project | null; versionHistory?: PlanVersion[]; activeVersionId?: string; hasDesign?: boolean };
type Stage = "login" | "project" | "multiSetup" | "prompt" | "review" | "plan";
type StairAnchor = { x: number; y: number; width: number; depth: number; label: string };

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

function getStairAnchor(nextProject: Project | null): StairAnchor | null {
  const stairs = nextProject?.plans[0]?.rooms.find(room => room.type === "stairs");
  return stairs ? { x: stairs.x, y: stairs.y, width: stairs.width, depth: stairs.depth, label: stairs.name } : null;
}

export default function StudioApp() {
  const [prompt, setPrompt] = useState(EXAMPLE); const [brief, setBrief] = useState<Brief | null>(null);
  const [project, setProject] = useState<Project | null>(null); const [selectedId, setSelectedId] = useState("");
  const [loginId, setLoginId] = useState("tester1"); const [password, setPassword] = useState("1"); const [userName, setUserName] = useState(""); const [testerId, setTesterId] = useState("");
  const [loginError, setLoginError] = useState(""); const [projectName, setProjectName] = useState(""); const [floorCount, setFloorCount] = useState<1|2|3>(1);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]); const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false); const [projectError, setProjectError] = useState("");
  const [activeSavedProjectId, setActiveSavedProjectId] = useState(""); const [designSaving, setDesignSaving] = useState(false); const [designSaveError, setDesignSaveError] = useState("");
  const [multiFloorPrompts, setMultiFloorPrompts] = useState<Record<number, string>>({ 1: EXAMPLE, 2: "" });
  const [multiFloorProjects, setMultiFloorProjects] = useState<Record<number, Project>>({});
  const [multiFloorStairAnchor, setMultiFloorStairAnchor] = useState<StairAnchor | null>(null);
  const [activeMultiFloor, setActiveMultiFloor] = useState(1);
  const [multiFloorLoading, setMultiFloorLoading] = useState<Record<number, boolean>>({});
  const [multiFloorErrors, setMultiFloorErrors] = useState<Record<number, string>>({});
  const [multiFloorVersionHistory, setMultiFloorVersionHistory] = useState<Record<number, PlanVersion[]>>({});
  const [multiFloorActiveVersionId, setMultiFloorActiveVersionId] = useState<Record<number, string>>({});
  const [multiFloorRevisionText, setMultiFloorRevisionText] = useState<Record<number, string>>({});
  const [multiFloorRevisionLoading, setMultiFloorRevisionLoading] = useState(false);
  const [multiFloorRevisionFeedback, setMultiFloorRevisionFeedback] = useState<Record<number, { kind: "ok" | "error"; summary: string; details: string[] }>>({});
  const [showMultiFloorPrompts, setShowMultiFloorPrompts] = useState(true);
  const [multiCombinedView, setMultiCombinedView] = useState(false);
  const [homeMode, setHomeMode] = useState<"single"|"multi"|null>(null);
  const [viewMode, setViewMode] = useState<"2d"|"3d">("2d");
  const [cameraMode, setCameraMode] = useState<"orbit"|"walk">("orbit");
  const [versionHistory, setVersionHistory] = useState<PlanVersion[]>([]); const [activeVersionId, setActiveVersionId] = useState("");
  const [revisionText, setRevisionText] = useState(""); const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState<{ kind: "ok" | "error"; summary: string; details: string[] }>({ kind: "ok", summary: "", details: [] });
  const [stage, setStage] = useState<Stage>("login"); const [loading, setLoading] = useState(false); const [apiError, setApiError] = useState("");
  const feasibility = useMemo(() => brief ? evaluateBriefFeasibility(brief) : null, [brief]);
  const architecture = useMemo(() => project ? evaluateArchitecture(project.brief, project.plans[0]) : null, [project]);
  const errors = useMemo(() => project ? [...validatePlans(project.plans), ...(architecture?.errors ?? [])] : [], [project, architecture]);
  const backLabel = stage === "project" ? "Back to login" : stage === "prompt" ? "Back to projects" : stage === "review" ? "Back to prompt" : "Back to projects";
  const multiFloorHasStairAnchor = !!multiFloorStairAnchor;
  const activeMultiProject = multiFloorProjects[activeMultiFloor] ?? null;
  const activeMultiArchitecture = useMemo(() => activeMultiProject ? evaluateArchitecture(activeMultiProject.brief, activeMultiProject.plans[0]) : null, [activeMultiProject]);
  const activeMultiErrors = useMemo(() => activeMultiProject ? [...validatePlans(activeMultiProject.plans), ...(activeMultiArchitecture?.errors ?? [])] : [], [activeMultiProject, activeMultiArchitecture]);
  const activeMultiVersionHistory = multiFloorVersionHistory[activeMultiFloor] ?? [];
  const activeMultiRevisionText = multiFloorRevisionText[activeMultiFloor] ?? "";
  const activeMultiRevisionFeedback = multiFloorRevisionFeedback[activeMultiFloor] ?? { kind: "ok" as const, summary: "", details: [] };
  const allMultiFloorsGenerated = Array.from({ length: floorCount }, (_, index) => index + 1).every(floor => !!multiFloorProjects[floor]);
  const [combined3DFocusFloor, setCombined3DFocusFloor] = useState<number | null>(null);
  const stackedMultiPlans = useMemo(() => Array.from({ length: floorCount }, (_, index) => index + 1).map((floor, index) => {
    const sourcePlan = multiFloorProjects[floor]?.plans[0];
    if (!sourcePlan) return null;
    const roomId = (id: string) => `floor-${floor}-${id}`;
    return {
      ...sourcePlan,
      id: `stacked-floor-${floor}-${sourcePlan.id}`,
      level: index,
      elevation: index * 9.35,
      rooms: sourcePlan.rooms.map(room => ({ ...room, id: roomId(room.id) })),
      openings: sourcePlan.openings.map(opening => ({ ...opening, id: roomId(opening.id), roomId: roomId(opening.roomId) })),
    };
  }).filter((plan): plan is FloorPlan => Boolean(plan)), [floorCount, multiFloorProjects]);
  const stackedMultiMaterials = useMemo(() => {
    const next: Record<string, MaterialSet> = {};
    Array.from({ length: floorCount }, (_, index) => index + 1).forEach(floor => {
      const sourceProject = multiFloorProjects[floor];
      sourceProject?.plans[0].rooms.forEach(room => {
        next[`floor-${floor}-${room.id}`] = sourceProject.materials[room.id];
      });
    });
    return next;
  }, [floorCount, multiFloorProjects]);

  async function loadProjects(nextTesterId: string) {
    setProjectsLoading(true); setProjectError("");
    try {
      const response = await fetch(`/api/projects?testerId=${encodeURIComponent(nextTesterId)}`);
      const data = await response.json() as ProjectsResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load projects.");
      setSavedProjects(data.projects ?? []);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not load projects.");
      setSavedProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }

  async function continueLogin() {
    const normalized = loginId.trim().toLowerCase();
    setLoginError("");
    try {
      const response = await fetch("/api/tester-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalized, password }),
      });
      const data = await response.json() as TesterLoginResponse;
      if (!response.ok || !data.ok || !data.tester) throw new Error(data.error || "Invalid tester login.");
      setTesterId(data.tester.id);
      setUserName(data.tester.username); setProjectName(`${data.tester.username}'s home`); setFloorCount(1); setHomeMode("single"); setProjectModalOpen(false);
      setStage("project");
      await loadProjects(data.tester.id);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Could not sign in.");
    }
  }
  function goBack() {
    if (stage === "project") setStage("login");
    if (stage === "multiSetup") setStage("project");
    if (stage === "prompt") setStage("project");
    if (stage === "review") setStage("prompt");
    if (stage === "plan") setStage(homeMode === "multi" ? "multiSetup" : "project");
  }
  function resetProjectDraft() {
    setProjectName(""); setFloorCount(1); setHomeMode("single");
  }
  function openProjectModal() {
    resetProjectDraft(); setProjectModalOpen(true);
  }
  function resetMultiFloorPrompts(count: 1 | 2 | 3) {
    setMultiFloorPrompts(current => {
      const next: Record<number, string> = {};
      for (let index = 1; index <= count; index += 1) next[index] = current[index] ?? (index === 1 ? EXAMPLE : "");
      return next;
    });
  }
  function multiFloorPromptWithAnchor(floor: number) {
    const floorPrompt = (multiFloorPrompts[floor] || "").trim();
    const anchorNote = floor > 1 && multiFloorStairAnchor ? `\n\nStair alignment constraint: reuse the staircase arrival position from Floor 1 at x ${multiFloorStairAnchor.x.toFixed(1)}, y ${multiFloorStairAnchor.y.toFixed(1)}, size ${multiFloorStairAnchor.width.toFixed(1)} ft x ${multiFloorStairAnchor.depth.toFixed(1)} ft. Keep the stair landing connected to the hallway or family lounge.` : "";
    return (floorPrompt.length ? floorPrompt : EXAMPLE) + anchorNote;
  }
  async function generateMultiFloor(floor: number) {
    if (!canGenerateMultiFloor(floor)) return;
    const floorPrompt = multiFloorPromptWithAnchor(floor);
    if (floorPrompt.trim().length < 20) return;
    setActiveMultiFloor(floor); setSelectedId("");
    setMultiFloorLoading(current => ({ ...current, [floor]: true }));
    setMultiFloorErrors(current => ({ ...current, [floor]: "" }));
    try {
      const response = await fetch("/api/parse-requirements", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ prompt: floorPrompt }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not understand this floor prompt.");
      const floorBrief = { ...(data as Brief), title: `${projectName || "Multi-floor home"} - Floor ${floor}`, floors: 1, prompt: floorPrompt };
      const report = evaluateBriefFeasibility(floorBrief);
      if (!report.canGenerate) throw new Error(report.issues[0]?.message || "This floor program does not fit the plot.");
      const floorProject = createProject(floorBrief);
      const existingHistory = multiFloorVersionHistory[floor] ?? [];
      const entry = createPlanVersion(floorProject, existingHistory.length + 1, existingHistory.length ? `Regenerated Floor ${floor}` : `Generated Floor ${floor}`, existingHistory.length ? "regenerate" : "initial");
      const nextHistory = [...existingHistory, entry];
      const nextProjects = { ...multiFloorProjects, [floor]: floorProject };
      setMultiFloorProjects(nextProjects);
      setMultiFloorVersionHistory(current => ({ ...current, [floor]: nextHistory }));
      setMultiFloorActiveVersionId(current => ({ ...current, [floor]: entry.id }));
      if (floor === 1) setMultiFloorStairAnchor(getStairAnchor(floorProject));
      if (Array.from({ length: floorCount }, (_, index) => index + 1).every(nextFloor => !!nextProjects[nextFloor])) {
        setShowMultiFloorPrompts(false);
        setMultiCombinedView(true);
        setViewMode("2d");
      }
      void saveProjectDesignSnapshot(floorProject, nextHistory, entry.id, floorPrompt);
    } catch (error) {
      setMultiFloorErrors(current => ({ ...current, [floor]: error instanceof Error ? error.message : "Could not generate this floor." }));
    } finally {
      setMultiFloorLoading(current => ({ ...current, [floor]: false }));
    }
  }
  function canGenerateMultiFloor(floor: number) {
    return floor === 1 || (floor > 1 && multiFloorHasStairAnchor && !!multiFloorProjects[floor - 1]);
  }
  function multiFloorStatus(floor: number) {
    if (multiFloorProjects[floor]) return "Generated";
    if (floor === 1) return "Ready for the current generator";
    if (!multiFloorProjects[floor - 1]) return `Waiting for Floor ${floor - 1}`;
    if (!multiFloorHasStairAnchor) return "Floor 1 needs an internal staircase";
    return "Stair anchor ready";
  }
  function multiFloorButtonLabel(floor: number) {
    if (multiFloorProjects[floor]) return `Regenerate Floor ${floor}`;
    if (canGenerateMultiFloor(floor)) return `Generate Floor ${floor}`;
    return "Locked next step";
  }
  function loadMultiFloorVersion(entry: PlanVersion) {
    setMultiFloorProjects(current => ({ ...current, [activeMultiFloor]: entry.project }));
    setMultiFloorActiveVersionId(current => ({ ...current, [activeMultiFloor]: entry.id }));
    if (activeMultiFloor === 1) setMultiFloorStairAnchor(getStairAnchor(entry.project));
    setSelectedId("");
    setMultiFloorRevisionFeedback(current => ({ ...current, [activeMultiFloor]: { kind: "ok", summary: `Loaded ${entry.label}.`, details: [entry.summary] } }));
  }
  async function applyMultiFloorRevision() {
    const floorProject = activeMultiProject;
    const correction = activeMultiRevisionText.trim();
    if (!floorProject || correction.length < 5) return;
    setMultiFloorRevisionLoading(true);
    setMultiFloorRevisionFeedback(current => ({ ...current, [activeMultiFloor]: { kind: "ok", summary: "", details: [] } }));
    try {
      const response = await fetch("/api/revise-requirements", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ currentBrief: floorProject.brief, correction }) });
      const data = await response.json() as RevisionResponse;
      if (!response.ok || !data.ok || !data.brief) throw new Error(data.error || data.errors?.join(" ") || data.changeSummary || "Could not apply that revision safely.");
      const nextProject = createProject(data.brief);
      const nextArchitecture = evaluateArchitecture(data.brief, nextProject.plans[0]);
      const nextErrors = [...validatePlans(nextProject.plans), ...nextArchitecture.errors];
      if (nextErrors.length) throw new Error(`Revision was not applied because it created ${nextErrors.length} geometry issue(s): ${nextErrors.slice(0, 2).join(" ")}`);
      const existingHistory = multiFloorVersionHistory[activeMultiFloor] ?? [];
      const entry = createPlanVersion(nextProject, existingHistory.length + 1, data.changeSummary || `Floor ${activeMultiFloor} revision applied`, "revision");
      const nextHistory = [...existingHistory, entry];
      setMultiFloorProjects(current => ({ ...current, [activeMultiFloor]: entry.project }));
      setMultiFloorVersionHistory(current => ({ ...current, [activeMultiFloor]: nextHistory }));
      setMultiFloorActiveVersionId(current => ({ ...current, [activeMultiFloor]: entry.id }));
      setMultiFloorRevisionText(current => ({ ...current, [activeMultiFloor]: "" }));
      if (activeMultiFloor === 1) setMultiFloorStairAnchor(getStairAnchor(entry.project));
      setMultiFloorRevisionFeedback(current => ({ ...current, [activeMultiFloor]: { kind: "ok", summary: data.changeSummary || "Revision applied.", details: [...(data.changedFields?.length ? [`Updated: ${data.changedFields.join(", ")}`] : []), ...(data.warnings ?? [])] } }));
      void saveProjectDesignSnapshot(entry.project, nextHistory, entry.id, entry.project.brief.prompt);
    } catch (error) {
      setMultiFloorRevisionFeedback(current => ({ ...current, [activeMultiFloor]: { kind: "error", summary: error instanceof Error ? error.message : "Could not apply that revision safely.", details: ["Old floor plan was kept unchanged."] } }));
    } finally {
      setMultiFloorRevisionLoading(false);
    }
  }
  async function createSavedProject() {
    const name = projectName.trim();
    if (name.length < 2 || !testerId) return;
    setProjectError(""); setProjectsLoading(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testerId, name, houseType: floorCount === 1 ? "single" : "multi", floors: floorCount }),
      });
      const data = await response.json() as ProjectsResponse;
      if (!response.ok || !data.ok || !data.project) throw new Error(data.error || "Could not create project.");
      setSavedProjects(current => [data.project!, ...current]);
      setProjectModalOpen(false);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not create project.");
    } finally {
      setProjectsLoading(false);
    }
  }
  async function saveProjectDesignSnapshot(nextProject: Project, nextHistory: PlanVersion[], nextActiveVersionId: string, nextPrompt = prompt) {
    if (!testerId || !activeSavedProjectId) return;
    setDesignSaving(true); setDesignSaveError("");
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testerId,
          projectId: activeSavedProjectId,
          prompt: nextPrompt,
          brief: nextProject.brief,
          designProject: nextProject,
          versionHistory: nextHistory,
          activeVersionId: nextActiveVersionId,
        }),
      });
      const data = await response.json() as ProjectsResponse;
      if (!response.ok || !data.ok || !data.project) throw new Error(data.error || "Could not save project design.");
      setSavedProjects(current => current.map(item => item.id === data.project!.id ? data.project! : item));
    } catch (error) {
      setDesignSaveError(error instanceof Error ? error.message : "Could not save project design.");
    } finally {
      setDesignSaving(false);
    }
  }
  function openSavedProject(item: SavedProject) {
    setActiveSavedProjectId(item.id); setProjectName(item.name); setFloorCount(item.floors); setHomeMode(item.houseType); setProjectModalOpen(false);
    if (item.houseType === "multi") {
      const savedAnchor = getStairAnchor(item.designProject ?? null);
      setMultiFloorProjects(item.designProject ? { 1: item.designProject } : {});
      setMultiFloorStairAnchor(savedAnchor);
      setActiveMultiFloor(savedAnchor ? 2 : 1);
      setMultiCombinedView(false);
      setShowMultiFloorPrompts(true);
      resetMultiFloorPrompts(item.floors); setStage("multiSetup"); setProject(null); setBrief(null); setSelectedId(""); setViewMode("2d"); setCameraMode("orbit"); setRevisionText(""); setRevisionFeedback({ kind: "ok", summary: "", details: [] });
      return;
    }
    setApiError(""); setDesignSaveError(""); setSelectedId(""); setViewMode("2d"); setCameraMode("orbit"); setRevisionText("");
    if (item.designProject) {
      const restoredHistory = item.versionHistory?.length ? item.versionHistory : [createPlanVersion(item.designProject, item.designProject.version || 1, "Saved project design", "initial")];
      const restoredActiveId = item.activeVersionId || restoredHistory[restoredHistory.length - 1]?.id || "";
      setPrompt(item.prompt || item.designProject.brief.prompt || EXAMPLE); setBrief(item.brief ?? item.designProject.brief); setProject(item.designProject);
      setVersionHistory(restoredHistory); setActiveVersionId(restoredActiveId); setRevisionFeedback({ kind: "ok", summary: "Loaded saved project design.", details: ["2D and 3D restored from this project."] }); setStage("plan");
      return;
    }
    setStage("prompt"); setBrief(null); setProject(null);
    setVersionHistory([]); setActiveVersionId(""); setRevisionFeedback({ kind: "ok", summary: "", details: [] });
  }
  async function deleteSavedProject(item: SavedProject) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${item.name}" permanently?`)) return;
    setProjectError(""); setProjectsLoading(true);
    try {
      const response = await fetch(`/api/projects?testerId=${encodeURIComponent(testerId)}&projectId=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const data = await response.json() as ProjectsResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not delete project.");
      setSavedProjects(current => current.filter(project => project.id !== item.id));
      if (activeSavedProjectId === item.id) setActiveSavedProjectId("");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not delete project.");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function understand() {
    setLoading(true); setApiError("");
    try {
      const response = await fetch("/api/parse-requirements", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({prompt}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not understand the prompt.");
      setBrief({ ...(data as Brief), title: projectName.trim() || (data as Brief).title, floors: 1 }); setStage("review");
    } catch (error) { setApiError(error instanceof Error ? error.message : "Could not connect to the AI parser."); }
    finally { setLoading(false); }
  }
  function generate() {
    if (!brief) return;
    const report = evaluateBriefFeasibility(brief);
    if (!report.canGenerate) return;
    const entry = createPlanVersion(createProject(brief), 1, "Initial generated plan", "initial");
    const nextHistory = [entry];
    if (homeMode === "multi") {
      setMultiFloorProjects(current => ({ ...current, [activeMultiFloor]: entry.project }));
      if (activeMultiFloor === 1) setMultiFloorStairAnchor(getStairAnchor(entry.project));
    }
    setVersionHistory(nextHistory); setActiveVersionId(entry.id); setProject(entry.project); setSelectedId(""); setViewMode("2d"); setCameraMode("orbit"); setStage("plan");
    void saveProjectDesignSnapshot(entry.project, nextHistory, entry.id);
  }
  function loadVersion(entry: PlanVersion) {
    setBrief(entry.project.brief); setProject(entry.project); setActiveVersionId(entry.id); setSelectedId(""); setRevisionText("");
    setRevisionFeedback({ kind: "ok", summary: `Loaded ${entry.label}.`, details: [entry.summary] });
    void saveProjectDesignSnapshot(entry.project, versionHistory.length ? versionHistory : [entry], entry.id);
  }
  function regenerateVersion() {
    if (!project) return;
    const entry = createPlanVersion(createProject(project.brief), versionHistory.length + 1, "Regenerated layout from current requirements", "regenerate");
    const nextHistory = [...versionHistory, entry];
    setVersionHistory(nextHistory); setActiveVersionId(entry.id); setProject(entry.project); setSelectedId(""); setViewMode("2d"); setCameraMode("orbit");
    void saveProjectDesignSnapshot(entry.project, nextHistory, entry.id);
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
      const nextHistory = [...versionHistory, entry];
      setBrief(data.brief); setProject(entry.project); setVersionHistory(nextHistory); setActiveVersionId(entry.id); setSelectedId(""); setRevisionText("");
      setRevisionFeedback({ kind: "ok", summary: data.changeSummary || "Revision applied.", details: [...(data.changedFields?.length ? [`Updated: ${data.changedFields.join(", ")}`] : []), ...(data.warnings ?? [])] });
      void saveProjectDesignSnapshot(entry.project, nextHistory, entry.id);
    } catch (error) {
      setRevisionFeedback({ kind: "error", summary: error instanceof Error ? error.message : "Could not apply that revision safely.", details: ["Old plan was kept unchanged."] });
    } finally { setRevisionLoading(false); }
  }
  const unitMark = brief?.unit === "feet" ? "ft" : "m";

  return <main className="two-d-app">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Home size={18}/></span><span>Blueprint</span><em>Studio</em></div><div className="phase-pill"><span>PHASE 1</span> AI prompt to validated 2D plan</div></header>
    {stage!=="login"&&<button className="flow-back-btn" onClick={goBack}><ArrowLeft size={14}/> {backLabel}</button>}
    {stage!=="login"&&stage!=="project"&&stage!=="multiSetup"&&<nav className="simple-progress"><div className={stage!=="prompt"?"done":"active"}><span>{stage!=="prompt"?<Check/>:1}</span><b>Enter prompt</b></div><i/><div className={stage==="review"?"active":stage==="plan"?"done":""}><span>{stage==="plan"?<Check/>:2}</span><b>Verify requirements</b></div><i/><div className={stage==="plan"?"active":""}><span>3</span><b>Generate 2D / 3D plan</b></div></nav>}

    {stage==="login"&&<section className="login-screen"><div className="login-card"><span className="eyebrow"><Sparkles size={14}/> Tester access</span><h1>Sign in to start designing.</h1><p>Use tester accounts for now. Real saved accounts will move to the database layer next.</p><label>Username<input value={loginId} onChange={e=>setLoginId(e.target.value)} placeholder="tester1"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="1"/></label><div className="tester-list"><b>Available testers</b><span>tester1 / tester2 / tester3 / tester4 / tester5</span><small>Password: 1</small></div>{loginError&&<div className="api-error"><AlertTriangle/>{loginError}</div>}<button className="primary-btn wide" onClick={continueLogin} disabled={loginId.trim().length<2||password.length<1}>Continue <ChevronRight size={17}/></button></div></section>}

    {stage==="project"&&<section className="project-dashboard">
      <div className="dashboard-head">
        <div><span className="eyebrow"><Home size={14}/> Project dashboard</span><h1>Welcome {userName}.</h1><p>Create and manage your saved home design projects.</p></div>
        <button className="dashboard-plus" onClick={openProjectModal} aria-label="Create project"><Plus size={22}/></button>
      </div>
      {projectError&&<div className="api-error dashboard-error"><AlertTriangle/>{projectError}</div>}
      {projectsLoading&&<div className="project-loading">Syncing projects...</div>}
      {savedProjects.length===0&&!projectsLoading?<div className="empty-projects"><span><Plus size={24}/></span><h2>Create your first project</h2><p>No projects yet. Start with a project name, then choose single floor or multi floor.</p><button className="primary-btn" onClick={openProjectModal}>Create project <ChevronRight size={16}/></button></div>:<div className="project-grid">{savedProjects.map(item=><article key={item.id} className="project-tile"><div><small>{item.houseType==="single"?"Single floor house":"Multi-storied house"}</small><h2>{item.name}</h2><p>{item.floors} {item.floors===1?"floor":"floors"} - created {new Date(item.createdAt).toLocaleDateString()}</p></div><div className="project-actions"><button className="secondary-btn" onClick={()=>openSavedProject(item)}>{item.houseType==="multi"?"Open setup":"Open project"} <ChevronRight size={14}/></button><button className="delete-project-btn" onClick={()=>deleteSavedProject(item)} aria-label={`Delete ${item.name}`} disabled={projectsLoading}><Trash2 size={15}/></button></div>{item.hasDesign&&<span className="project-note">Saved 2D / 3D design ready.</span>}{item.houseType==="multi"&&<span className="project-note">Multi-floor setup ready.</span>}</article>)}</div>}
      {projectModalOpen&&<div className="project-modal-backdrop"><div className="project-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={()=>setProjectModalOpen(false)} aria-label="Close"><X size={17}/></button><span className="eyebrow"><Plus size={14}/> Create project</span><h2>New home design</h2><label>Project name<input value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="East-facing family house"/></label><div className="house-type-choice"><button className={floorCount===1?"active":""} onClick={()=>{ setFloorCount(1); setHomeMode("single"); }}><Home size={18}/><b>Single floor</b><small>Current stable flow</small></button><button className={floorCount>1?"active":""} onClick={()=>{ setFloorCount(2); setHomeMode("multi"); }}><Box size={18}/><b>Multi floor</b><small>Up to 3 floors</small></button></div>{homeMode==="multi"&&<div className="floor-choice-row modal-floor-row"><span>Floors</span>{([2,3] as const).map(count=><button key={count} className={floorCount===count?"active":""} onClick={()=>setFloorCount(count)}>{count} floors</button>)}</div>}<button className="primary-btn wide" onClick={createSavedProject} disabled={projectName.trim().length<2||projectsLoading}>{projectsLoading?"Creating...":"Create project"} <ChevronRight size={17}/></button></div></div>}
    </section>}

    {stage==="multiSetup"&&<section className="multi-floor-screen"><div className="multi-floor-intro"><span className="eyebrow"><Box size={14}/> Multi-floor project</span><h1>{projectName || "Multi-floor home"}</h1><p>Build each level separately first. Upper floors reuse the staircase position from the level below.</p></div>{(!allMultiFloorsGenerated||showMultiFloorPrompts)&&<div className="floor-planning-grid">{Array.from({ length: floorCount }, (_, index)=>index+1).map(floor=><article key={floor} className={activeMultiFloor===floor&&!multiCombinedView?"floor-planning-card active":"floor-planning-card"}><div className="floor-card-head"><span>{String(floor).padStart(2,"0")}</span><div><h2>Floor {floor}</h2><p>{floor===1?"Ground-floor plan":"Upper-floor plan"}</p></div><button className="mini-select-btn" onClick={()=>{setActiveMultiFloor(floor); setMultiCombinedView(false); setSelectedId("");}}>View</button></div><textarea value={multiFloorPrompts[floor] ?? ""} onChange={e=>setMultiFloorPrompts(current=>({...current,[floor]:e.target.value}))} rows={5} placeholder={floor===1?"Describe the ground floor with entry, shared spaces and staircase.":"Describe rooms for this floor. Staircase position will stay aligned."}/><div className="floor-status-row"><span>{multiFloorLoading[floor]?"Generating...":multiFloorStatus(floor)}</span><button className={canGenerateMultiFloor(floor)?"primary-btn":"secondary-btn"} onClick={()=>generateMultiFloor(floor)} disabled={!canGenerateMultiFloor(floor)||!!multiFloorLoading[floor]}>{multiFloorLoading[floor]?"Generating...":multiFloorButtonLabel(floor)} <ChevronRight size={14}/></button></div>{multiFloorErrors[floor]&&<div className="revision-feedback error"><b>{multiFloorErrors[floor]}</b></div>}</article>)}</div>}{allMultiFloorsGenerated&&<div className="multi-floor-selector"><div>{Array.from({ length: floorCount }, (_, index)=>index+1).map(floor=><button key={floor} className={!multiCombinedView&&activeMultiFloor===floor?"active":""} onClick={()=>{setActiveMultiFloor(floor); setMultiCombinedView(false); setSelectedId("");}}>Floor {floor}</button>)}<button className={multiCombinedView?"active":""} onClick={()=>{setMultiCombinedView(true); setViewMode("2d"); setCombined3DFocusFloor(null); setSelectedId("");}}>Combined floors</button></div><button className="secondary-btn" onClick={()=>setShowMultiFloorPrompts(value=>!value)}>{showMultiFloorPrompts?"Hide prompts":"Edit prompts"}</button></div>}{multiCombinedView&&allMultiFloorsGenerated?<section className="combined-floor-result"><div className="board-toolbar"><span><Ruler/>{viewMode==="2d"?"Combined 2D floor comparison":"Stacked multi-floor 3D model"}</span><div><button className={viewMode==="2d"?"active":""} onClick={()=>setViewMode("2d")}><Map/> 2D Plan</button><button className={viewMode==="3d"?"active":""} onClick={()=>setViewMode("3d")}><Box/> 3D Preview</button>{viewMode==="3d"&&<><button className={cameraMode==="orbit"?"active":""} onClick={()=>setCameraMode("orbit")}><RotateCcw/> Orbit</button><button className={cameraMode==="walk"?"active":""} onClick={()=>setCameraMode("walk")}><Footprints/> Walk</button></>}</div></div>{viewMode==="2d"?<div className="combined-plan-grid">{Array.from({ length: floorCount }, (_, index)=>index+1).map(floor=><article key={floor} className="combined-plan-card"><h2>Floor {floor}</h2><PlanEditor plan={multiFloorProjects[floor].plans[0]} selectedId={selectedId} onSelect={setSelectedId} onUpdate={()=>{}} showEntry={floor===1}/></article>)}</div>:<div className="combined-3d-wrap"><HouseViewer plans={stackedMultiPlans} materials={stackedMultiMaterials} selectedId={selectedId} onSelect={setSelectedId} activeFloor={-1} showCeiling={cameraMode==="walk"} cutaway={false} mode={cameraMode} interiors={true} focusFloor={combined3DFocusFloor}/><div className="floor-focus-panel"><button className={combined3DFocusFloor===null?"active":""} onClick={()=>setCombined3DFocusFloor(null)}>Combined</button>{Array.from({ length: floorCount }, (_, index)=>index).map(index=><button key={index} className={combined3DFocusFloor===index?"active":""} onClick={()=>setCombined3DFocusFloor(index)}>Floor {index+1}</button>)}</div></div>}</section>:activeMultiProject?<section className="plan-result multi-plan-result"><aside className="plan-summary"><span className="eyebrow">Selected floor</span><h2>Floor {activeMultiFloor}</h2><p>{activeMultiProject.brief.facing}-facing {activeMultiProject.brief.plotWidth} x {activeMultiProject.brief.plotDepth} {activeMultiProject.brief.unit}</p><div className="validation-card"><div className={activeMultiErrors.length?"status error":"status valid"}>{activeMultiErrors.length?<AlertTriangle/>:<Check/>}<span><b>{activeMultiErrors.length?"Needs correction":"Architecture checked"}</b><small>{activeMultiErrors.length?`${activeMultiErrors.length} issue(s)`:activeMultiArchitecture?`Quality score ${activeMultiArchitecture.score}/100`:"No overlaps or boundary errors"}</small></span></div>{activeMultiErrors.map(error=><p key={error}>{error}</p>)}{!activeMultiErrors.length&&activeMultiArchitecture?.warnings.map(warning=><p className="arch-warning" key={warning}>{warning}</p>)}</div>{activeMultiVersionHistory.length>0&&<div className="version-card"><h3><History size={13}/> Versions</h3>{activeMultiVersionHistory.map(entry=><button key={entry.id} className={multiFloorActiveVersionId[activeMultiFloor]===entry.id?"active":""} onClick={()=>loadMultiFloorVersion(entry)}><span><b>{entry.label}</b><small>{entry.summary}</small></span><em>{entry.createdAt}</em></button>)}</div>}<div className="revision-card"><h3><Sparkles size={13}/> Revise floor {activeMultiFloor}</h3><textarea value={activeMultiRevisionText} onChange={e=>setMultiFloorRevisionText(current=>({...current,[activeMultiFloor]:e.target.value}))} rows={4} placeholder="Example: move bedroom closer to hall, widen stair landing, add balcony near front."/><button className="primary-btn wide" onClick={applyMultiFloorRevision} disabled={multiFloorRevisionLoading||activeMultiRevisionText.trim().length<5}>{multiFloorRevisionLoading?"Applying safely...":<>Apply revision <ChevronRight size={15}/></>}</button>{activeMultiRevisionFeedback.summary&&<div className={activeMultiRevisionFeedback.kind==="error"?"revision-feedback error":"revision-feedback"}><b>{activeMultiRevisionFeedback.summary}</b>{activeMultiRevisionFeedback.details.map(item=><span key={item}>{item}</span>)}</div>}</div><div className="room-key"><h3>Room schedule</h3>{activeMultiProject.plans[0].rooms.map(room=><button key={room.id} className={selectedId===room.id?"active":""} onClick={()=>setSelectedId(room.id)}><i style={{background:room.color}}/><span>{room.name}</span><small>{room.width.toFixed(1)} x {room.depth.toFixed(1)}</small></button>)}</div></aside><div className="plan-board"><div className="board-toolbar"><span><Ruler/>Floor {activeMultiFloor} geometry / measurements in {activeMultiProject.brief.unit}</span><div><button className={viewMode==="2d"?"active":""} onClick={()=>setViewMode("2d")}><Map/> 2D Plan</button><button className={viewMode==="3d"?"active":""} onClick={()=>setViewMode("3d")}><Box/> 3D Preview</button>{viewMode==="3d"&&<><button className={cameraMode==="orbit"?"active":""} onClick={()=>setCameraMode("orbit")}><RotateCcw/> Orbit</button><button className={cameraMode==="walk"?"active":""} onClick={()=>setCameraMode("walk")}><Footprints/> Walk</button></>}<button onClick={()=>generateMultiFloor(activeMultiFloor)}><RotateCcw/> Regenerate</button>{viewMode==="2d"&&<button className="primary-btn" onClick={exportPlan}><Download/> Download PNG</button>}</div></div>{viewMode==="2d"?<PlanEditor plan={activeMultiProject.plans[0]} selectedId={selectedId} onSelect={setSelectedId} onUpdate={()=>{}} showEntry={activeMultiFloor===1}/>:<div className="preview-canvas"><HouseViewer plans={activeMultiProject.plans} materials={activeMultiProject.materials} selectedId={selectedId} onSelect={setSelectedId} activeFloor={0} showCeiling={cameraMode==="walk"} cutaway={false} mode={cameraMode} interiors={true}/></div>}<div className="board-footer"><span>Floor {activeMultiFloor} concept plan - staircase alignment is preserved for upper-floor generation.</span><button className="approve-btn" disabled={activeMultiErrors.length>0}><Check/> Mark floor as approved</button></div></div></section>:<div className="multi-preview-empty stacked"><Box size={34}/><b>No floor generated yet</b><span>Generate Floor {activeMultiFloor} to preview the 2D and 3D plan below.</span></div>}</section>}

    {stage==="prompt" && <section className="prompt-only"><div className="prompt-intro"><span className="eyebrow"><Sparkles size={14}/> {homeMode==="single"?"Single-floor requirement parser":"Live AI requirement parser"}</span><h1>Describe your home. <em>Verify before we draw.</em></h1><p>The AI extracts plot dimensions, orientation, rooms, features and adjacency rules. A deterministic geometry engine then creates the measurable plan.</p><div className="accuracy-rules"><h3>Accuracy rules</h3><span><Check/>No invented dimensions</span><span><Check/>No room overlaps</span><span><Check/>Plot boundary validation</span><span><Check/>Explicit facing and road side</span><span><Check/>Structured room coordinates</span></div></div><div className="prompt-card focused"><div className="card-heading"><span>01</span><div><h2>{projectName || "Custom prompt"}</h2><p>Edit the example and test your own requirements.</p></div></div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={10}/><div className="fixed-facts"><span><b>AI parsed</b> Requirements</span><span><b>Validated</b> Geometry</span><span><b>{floorCount} floor</b> Current setup</span></div>{apiError&&<div className="api-error"><AlertTriangle/>{apiError}</div>}<button className="primary-btn wide" onClick={understand} disabled={loading||prompt.trim().length<20}>{loading?"Understanding your prompt...":<>Understand this request <ChevronRight size={17}/></>}</button></div></section>}

    {stage==="review" && brief && <section className="review-screen"><div className="section-intro"><span className="eyebrow">AI extraction complete</span><h1>Confirm the requirements.</h1><p>The layout engine will use only these structured inputs.</p></div><div className="requirement-sheet"><div className="sheet-head"><div><small>PROJECT</small><h2>{brief.title}</h2></div><span>{brief.floors} {brief.floors===1?"floor":"floors"}</span></div><div className="requirement-grid"><article><small>PLOT</small><b>{brief.plotWidth} x {brief.plotDepth} {unitMark}</b><p>Facing {brief.facing}; road on the {brief.roadSide} side.</p></article><article><small>PRIVATE SPACES</small><b>{brief.bedrooms} bedrooms / {brief.bathrooms} bathrooms</b><p>Counts extracted directly from your prompt.</p></article><article><small>SHARED SPACES</small><b>{brief.livingRooms} living / {brief.kitchens} kitchen / {brief.diningRooms} dining</b><p>{brief.adjacency.length?brief.adjacency.join("; "):"No special adjacency rule supplied."}</p></article><article><small>FEATURES</small><b>{brief.features.length?brief.features.map(x=>x.replaceAll("_"," ")).join(" / "):"None specified"}</b><p>{brief.style} design direction.</p></article></div>{brief.warnings.length>0&&<div className="warning-list"><h3><AlertTriangle/> Review note</h3>{brief.warnings.map(w=><span key={w}>{w}</span>)}</div>}{feasibility&&feasibility.issues.length>0&&<div className="warning-list"><h3><AlertTriangle/> Feasibility check</h3>{feasibility.issues.map(issue=><span key={issue.message}>{issue.message}</span>)}</div>}<div className="constraint-list"><h3>Automatic geometry checks</h3>{["No overlapping rooms","Every room remains inside the plot","Doors remain attached to rooms","Dimensions use the selected unit",feasibility?.canGenerate?"Program fits the plot":"Program must fit before generation"].map(x=><span key={x}><Check/>{x}</span>)}</div></div><div className="stage-actions"><button className="secondary-btn" onClick={()=>setStage("prompt")}>Correct prompt</button><button className="primary-btn" onClick={generate} disabled={!!feasibility&&!feasibility.canGenerate}>{feasibility&&!feasibility.canGenerate?"Adjust prompt to fit plot":<>Generate structured 2D plan <ChevronRight size={17}/></>}</button></div></section>}

    {stage==="plan" && project && <section className="plan-result"><aside className="plan-summary"><span className="eyebrow">Generated plan</span><h2>{project.brief.title}</h2><p>{project.brief.facing}-facing {project.brief.plotWidth} x {project.brief.plotDepth} {project.brief.unit}</p><div className="orientation-card"><b>N</b><span>ROAD - {project.brief.roadSide.toUpperCase()} SIDE</span><strong>&rarr;</strong></div><div className="validation-card"><div className={errors.length?"status error":"status valid"}>{errors.length?<AlertTriangle/>:<Check/>}<span><b>{errors.length?"Needs correction":"Architecture checked"}</b><small>{errors.length?`${errors.length} blocking issue(s)`:architecture?`Quality score ${architecture.score}/100`:"No overlaps or boundary errors"}</small></span></div>{errors.map(e=><p key={e}>{e}</p>)}{!errors.length&&architecture?.warnings.map(w=><p className="arch-warning" key={w}>{w}</p>)}</div>{(designSaving||designSaveError)&&<div className={designSaveError?"revision-feedback error":"revision-feedback"}><b>{designSaveError?"Project save failed":"Saving project design..."}</b>{designSaveError&&<span>{designSaveError}</span>}</div>}{project.generationTrace&&<div className="engine-trace-card"><h3><Ruler size={13}/> Engine trace</h3><p>Selected: <b>{project.generationTrace.selectedLabel}</b></p>{project.generationTrace.candidates.map(candidate=><article key={candidate.label} className={candidate.selected?"selected":candidate.valid?"valid":"error"}><div><b>{candidate.label}</b><small>{candidate.source} / score {candidate.score}</small></div><em>{candidate.selected?"WIN":candidate.valid?"OK":"FAIL"}</em>{candidate.errors.map(error=><span key={error}>{error}</span>)}{!candidate.errors.length&&candidate.warnings.slice(0,2).map(warning=><span key={warning}>{warning}</span>)}</article>)}</div>}{versionHistory.length>0&&<div className="version-card"><h3><History size={13}/> Versions</h3>{versionHistory.map(entry=><button key={entry.id} className={activeVersionId===entry.id?"active":""} onClick={()=>loadVersion(entry)}><span><b>{entry.label}</b><small>{entry.summary}</small></span><em>{entry.createdAt}</em></button>)}</div>}<div className="revision-card"><h3><Sparkles size={13}/> Revise this plan</h3><textarea value={revisionText} onChange={e=>setRevisionText(e.target.value)} rows={4} placeholder="Example: move kitchen closer to dining, make hallway wider, add porch near entry."/><button className="primary-btn wide" onClick={applyRevision} disabled={revisionLoading||revisionText.trim().length<5}>{revisionLoading?"Applying safely...":<>Apply revision <ChevronRight size={15}/></>}</button>{revisionFeedback.summary&&<div className={revisionFeedback.kind==="error"?"revision-feedback error":"revision-feedback"}><b>{revisionFeedback.summary}</b>{revisionFeedback.details.map(item=><span key={item}>{item}</span>)}</div>}</div><div className="room-key"><h3>Room schedule</h3>{project.plans[0].rooms.map(r=><button key={r.id} className={selectedId===r.id?"active":""} onClick={()=>setSelectedId(r.id)}><i style={{background:r.color}}/><span>{r.name}</span><small>{r.width.toFixed(1)} x {r.depth.toFixed(1)}</small></button>)}</div><div className="next-phase preview-ready"><b>3D preview unlocked</b><span>Generated from this exact 2D room geometry.</span></div></aside><div className="plan-board"><div className="board-toolbar"><span><Ruler/>Structured geometry / measurements in {project.brief.unit}</span><div><button onClick={goBack}><ArrowLeft/> Back</button><button className={viewMode==="2d"?"active":""} onClick={()=>setViewMode("2d")}><Map/> 2D Plan</button><button className={viewMode==="3d"?"active":""} onClick={()=>setViewMode("3d")}><Box/> 3D Preview</button>{viewMode==="3d"&&<><button className={cameraMode==="orbit"?"active":""} onClick={()=>setCameraMode("orbit")}><RotateCcw/> Orbit</button><button className={cameraMode==="walk"?"active":""} onClick={()=>setCameraMode("walk")}><Footprints/> Walk</button></>}<button onClick={regenerateVersion}><RotateCcw/> Regenerate</button>{viewMode==="2d"&&<button className="primary-btn" onClick={exportPlan}><Download/> Download PNG</button>}</div></div>{viewMode==="2d"?<PlanEditor plan={project.plans[0]} selectedId={selectedId} onSelect={setSelectedId} onUpdate={()=>{}}/>:<div className="preview-canvas"><HouseViewer plans={project.plans} materials={project.materials} selectedId={selectedId} onSelect={setSelectedId} activeFloor={0} showCeiling={cameraMode==="walk"} cutaway={false} mode={cameraMode} interiors={true}/></div>}<div className="board-footer"><span>{viewMode==="2d"?"Concept floor plan - requires architect review before construction.":"Preview model - walls are generated from the approved 2D structure."}</span><button className="approve-btn" disabled={errors.length>0}><Check/> Mark 2D plan as approved</button></div></div></section>}
  </main>;
}

