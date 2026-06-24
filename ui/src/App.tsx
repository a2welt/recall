import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Bell, BookOpen, BrainCircuit, Bug, CalendarDays, Check,
  CheckCircle2, ChevronRight, CircleDot, Clock3, FolderGit2, GitBranch,
  Home, Inbox, LayoutGrid, Library, Lightbulb, ListTodo, Menu, Network, Orbit,
  Plus, PlusCircle, Search, Settings as SettingsIcon, Sparkles, StickyNote, Trash2, FolderX, X,
} from "lucide-react";
import { GalaxyCanvas, inferMemoryTopic } from "./GalaxyCanvas";
import { AmbientCanvas, FirstMemoryCelebration } from "./Effects";
import { AiSettingsPage, HandoffWizard } from "./Handoff";
import { MobileSyncSettings } from "./MobileSettings";

type Page = "home" | "galaxy" | "capture" | "library" | "digest" | "settings";
type Priority = "high" | "medium" | "low";
type Category = "decision" | "bug" | "architecture" | "todo" | "note" | "idea";
type WorkflowStatus = "backlog" | "active" | "blocked" | "done";
type Project = { id: string; name: string; color: string; status: "active" | "paused" | "completed"; memory_count?: number; active_count?: number };

type Idea = {
  id: string;
  content: string;
  status: "open" | "resolved";
  priority?: Priority;
  category?: Category;
  source?: string;
  created_at?: string;
  context?: { repo_path?: string | null; branch?: string | null; file_path?: string | null };
  reason?: string;
  score?: number;
  topic?: string;
  project_id?: string | null;
  workflow_status?: WorkflowStatus;
};

type RepoContext = { repo_path?: string | null; branch?: string | null };
type DigestData = { recent: Idea[]; resurfaced: Idea[] };

const categoryMeta: Record<Category, { label: string; icon: typeof Lightbulb; color: string }> = {
  decision: { label: "Decision", icon: CheckCircle2, color: "#5468ff" },
  bug: { label: "Bug", icon: Bug, color: "#ef6a78" },
  architecture: { label: "Architecture", icon: Network, color: "#f1a84b" },
  todo: { label: "Todo", icon: ListTodo, color: "#4eb995" },
  note: { label: "Note", icon: StickyNote, color: "#9674e8" },
  idea: { label: "Idea", icon: Lightbulb, color: "#ee8a54" },
};
const workflowMeta: Record<WorkflowStatus, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "#8a91a6" }, active: { label: "In progress", color: "#6674ef" }, blocked: { label: "Blocked", color: "#e66f7d" }, done: { label: "Done", color: "#4eb995" },
};

const nav = [
  { id: "home" as Page, label: "Home", icon: Home },
  { id: "galaxy" as Page, label: "Memory galaxy", icon: Orbit },
  { id: "capture" as Page, label: "Capture", icon: PlusCircle },
  { id: "library" as Page, label: "Library", icon: Library },
  { id: "digest" as Page, label: "Digest", icon: CalendarDays },
  { id: "settings" as Page, label: "Settings", icon: SettingsIcon },
];

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error((await response.text()) || "Request failed");
  return response.json() as Promise<T>;
};

const getCategory = (idea: Idea): Category => idea.category ?? "note";
const getPriority = (idea: Idea): Priority => idea.priority ?? "medium";
const shortDate = (value?: string) => value
  ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
  : "Today";

export function App() {
  const [page, setPage] = useState<Page>("home");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [context, setContext] = useState<RepoContext>({});
  const [selected, setSelected] = useState<Idea | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [celebrating, setCelebrating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectScope, setProjectScope] = useState<string>("all");
  const [creatingProject, setCreatingProject] = useState(false);
  const [handoffIdea, setHandoffIdea] = useState<Idea | null>(null);

  const loadIdeas = useCallback(async () => {
    try {
      setError("");
      setIdeas(await api<Idea[]>("/api/ideas"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load memories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIdeas();
    void api<RepoContext>("/api/context").then(setContext).catch(() => undefined);
    void api<Project[]>("/api/projects").then(setProjects).catch(() => undefined);
  }, [loadIdeas]);

  const go = (next: Page) => { setPage(next); setSidebarOpen(false); };
  const repoName = context.repo_path?.replace(/\\/g, "/").split("/").pop() || "Local workspace";
  const scopedIdeas = projectScope === "all" ? ideas : projectScope === "inbox" ? ideas.filter((idea) => !idea.project_id) : ideas.filter((idea) => idea.project_id === projectScope);
  const scopeName = projectScope === "all" ? "All memories" : projectScope === "inbox" ? "Inbox" : projects.find((project) => project.id === projectScope)?.name || "Project";
  const updateWorkflow = async (id: string, status: WorkflowStatus) => { await api(`/api/ideas/${id}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); setIdeas((all) => all.map((idea) => idea.id === id ? { ...idea, workflow_status: status } : idea)); };

  return (
    <div className="app-shell">
      <AmbientCanvas />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="brand" onClick={() => go("home")}>
          <span className="brand-mark"><BrainCircuit size={24} /></span>
          <span>Recall</span>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={page === id ? "active" : ""} onClick={() => go(id)}>
              <Icon size={19} strokeWidth={2.1} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="project-nav">
          <div className="project-nav-head"><span>Projects</span><button onClick={() => setCreatingProject(true)} aria-label="Create project"><Plus size={15} /></button></div>
          <button className={projectScope === "all" ? "active" : ""} onClick={() => setProjectScope("all")}><LayoutGrid size={15} /><span>All memories</span><small>{ideas.length}</small></button>
          <button className={projectScope === "inbox" ? "active" : ""} onClick={() => setProjectScope("inbox")}><Inbox size={15} /><span>Inbox</span><small>{ideas.filter((idea) => !idea.project_id).length}</small></button>
          {projects.filter((project) => project.status !== "completed").slice(0, 6).map((project) => <button key={project.id} className={projectScope === project.id ? "active" : ""} onClick={() => { setProjectScope(project.id); go("home"); }}><i style={{ background: project.color }} /><span>{project.name}</span><small>{ideas.filter((idea) => idea.project_id === project.id).length}</small></button>)}
        </div>

        <div className="workspace-card">
          <span className="avatar"><FolderGit2 size={18} /></span>
          <span className="workspace-copy"><strong>{repoName}</strong><small>{context.branch || "No git branch"}</small></span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen((value) => !value)}><Menu /></button>
          <div className="page-intro">
            <h1>{nav.find((item) => item.id === page)?.label}</h1>
            <p>{scopeName} · {page === "home" ? "Your workspace memory, at a glance." : "Recall what matters, exactly when you need it."}</p>
          </div>
          <div className="topbar-stats">
            <div><CircleDot size={18} /><span><strong>{ideas.filter((idea) => idea.status === "open").length}</strong><small>Open memories</small></span></div>
            <div><GitBranch size={18} /><span><strong>{context.branch || "—"}</strong><small>Current branch</small></span></div>
          </div>
          <label className="global-search"><Search size={19} /><input placeholder="Search" onFocus={() => go("library")} /></label>
          <button className="icon-button" aria-label="Notifications"><Bell size={20} /><i /></button>
        </header>

        {error && <div className="error-banner">{error}<button onClick={() => void loadIdeas()}>Try again</button></div>}
        <div className="page-stage">
          {page === "home" && <HomePage ideas={scopedIdeas} loading={loading} go={go} select={setSelected} generate={setHandoffIdea} projects={projects} projectScope={projectScope} updateWorkflow={updateWorkflow} />}
          {page === "galaxy" && <GalaxyPage ideas={scopedIdeas} select={setSelected} />}
          {page === "capture" && <CapturePage projects={projects} defaultProject={projectScope !== "all" && projectScope !== "inbox" ? projectScope : ""} onCreated={(idea) => { if (ideas.length === 0) setCelebrating(true); setIdeas((current) => [idea, ...current]); go("home"); }} />}
          {page === "library" && <LibraryPage ideas={scopedIdeas} loading={loading} select={setSelected} generate={setHandoffIdea} updateWorkflow={updateWorkflow} />}
          {page === "digest" && <DigestPage select={setSelected} generate={setHandoffIdea} />}
          {page === "settings" && <><AiSettingsPage /><MobileSyncSettings onImported={loadIdeas} /></>}
        </div>
      </main>

      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
      {selected && <DetailDrawer idea={selected} projects={projects} generate={() => { setHandoffIdea(selected); setSelected(null); }} close={() => setSelected(null)} changed={(patch) => { setIdeas((all) => all.map((item) => item.id === selected.id ? { ...item, ...patch } : item)); setSelected((current) => current ? { ...current, ...patch } : current); }} deleted={() => { setIdeas((all) => all.filter((item) => item.id !== selected.id)); setSelected(null); }} resolved={() => { setIdeas((all) => all.map((item) => item.id === selected.id ? { ...item, status: "resolved" } : item)); setSelected(null); }} />}
      {celebrating && <FirstMemoryCelebration onDone={() => setCelebrating(false)} />}
      {creatingProject && <CreateProjectModal close={() => setCreatingProject(false)} created={(project) => { setProjects((current) => [project, ...current]); setProjectScope(project.id); setCreatingProject(false); go("home"); }} />}
      {handoffIdea && <HandoffWizard memory={handoffIdea} close={() => setHandoffIdea(null)} openSettings={() => { setHandoffIdea(null); go("settings"); }} />}
      <button className="floating-capture" onClick={() => go("capture")}><Plus size={22} /><span>Capture</span></button>
    </div>
  );
}

function HomePage({ ideas, loading, go, select, generate, projects, projectScope, updateWorkflow }: { ideas: Idea[]; loading: boolean; go: (page: Page) => void; select: (idea: Idea) => void; generate: (idea: Idea) => void; projects: Project[]; projectScope: string; updateWorkflow: (id: string, status: WorkflowStatus) => Promise<void> }) {
  const stats = useMemo(() => ({
    open: ideas.filter((idea) => idea.status === "open").length,
    resolved: ideas.filter((idea) => idea.status === "resolved").length,
    high: ideas.filter((idea) => getPriority(idea) === "high").length,
  }), [ideas]);
  const days = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en", { weekday: "short" });
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(); date.setDate(date.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return { label: formatter.format(date), value: ideas.filter((idea) => idea.created_at?.startsWith(key)).length };
    });
  }, [ideas]);
  const max = Math.max(1, ...days.map((day) => day.value));
  const categoryCounts = (Object.keys(categoryMeta) as Category[]).map((category) => ({ category, value: ideas.filter((idea) => getCategory(idea) === category).length }));

  return (
    <div className="home-grid">
      <section className="home-center">
        <div className="section-heading"><div><h2>My activity</h2><p>Memories captured in the last 7 days</p></div><button onClick={() => go("library")}>See all <ChevronRight size={17} /></button></div>
        <div className="activity-row">
          <div className="activity-chart">
            <div className="chart-bars">
              {days.map((day, index) => <div className="bar-column" key={day.label + index}><span className={index === 6 ? "accent" : ""} style={{ height: `${Math.max(12, (day.value / max) * 100)}%` }}><b>{day.value || ""}</b></span><small>{day.label}</small></div>)}
            </div>
          </div>
          <div className="snapshot-cards">
            <button onClick={() => go("library")}><span className="stat-icon indigo"><CircleDot /></span><span><small>Open</small><strong>{stats.open}</strong></span><ArrowRight /></button>
            <button onClick={() => go("library")}><span className="stat-icon coral"><Sparkles /></span><span><small>High priority</small><strong>{stats.high}</strong></span><ArrowRight /></button>
            <button onClick={() => go("digest")}><span className="stat-icon mint"><Check /></span><span><small>Resolved</small><strong>{stats.resolved}</strong></span><ArrowRight /></button>
          </div>
        </div>

        <div className="section-heading category-heading"><div><h2>Memory spaces</h2><p>Browse by type</p></div></div>
        <div className="category-strip">
          {categoryCounts.map(({ category, value }) => {
            const meta = categoryMeta[category]; const Icon = meta.icon;
            return <button key={category} onClick={() => go("library")} style={{ "--category": meta.color } as React.CSSProperties}><span><Icon /></span><strong>{meta.label}</strong><small>{value} memories</small></button>;
          })}
        </div>

        <div className="section-heading focus-heading"><div><h2>Current focus</h2><p>Move work through its lifecycle without losing context</p></div><button onClick={() => go("library")}>Open board <ChevronRight size={17} /></button></div>
        <div className="focus-board">
          {(["active", "blocked", "backlog"] as WorkflowStatus[]).map((status) => { const items = ideas.filter((idea) => (idea.workflow_status || "backlog") === status); return <div key={status} className="focus-column"><header><i style={{ background: workflowMeta[status].color }} /><strong>{workflowMeta[status].label}</strong><span>{items.length}</span></header>{items.slice(0, 2).map((idea) => <button key={idea.id} onClick={() => select(idea)}><span>{idea.content}</span><small>{idea.topic || inferMemoryTopic(idea)}</small>{status !== "active" && <i onClick={(event) => { event.stopPropagation(); void updateWorkflow(idea.id, "active"); }}>Start</i>}</button>)}{!items.length && <p>Nothing here</p>}</div>; })}
        </div>

        <div className="section-heading recent-heading"><div><h2>Recently captured</h2><p>Your latest workspace context</p></div><button onClick={() => go("library")}>See all <ChevronRight size={17} /></button></div>
        <div className="recent-grid">
          {loading ? <LoadingCards /> : ideas.slice(0, 3).map((idea) => <MemoryCard key={idea.id} idea={idea} onClick={() => select(idea)} onGenerate={() => generate(idea)} />)}
          {!loading && ideas.length === 0 && <EmptyState action={() => go("capture")} />}
        </div>
      </section>

      <aside className="home-rail">
        {projectScope === "all" && projects.length > 0 && <div className="project-overview"><div className="section-heading"><div><h2>Projects</h2><p>Your active workspaces</p></div></div>{projects.filter((project) => project.status === "active").slice(0, 4).map((project) => <div key={project.id}><i style={{ background: project.color }} /><span><strong>{project.name}</strong><small>{project.memory_count || 0} memories · {project.active_count || 0} in progress</small></span></div>)}</div>}
        <div className="recall-banner">
          <div className="banner-copy"><span><Sparkles size={16} /> Context aware</span><h3>Find the decision behind the code.</h3><button onClick={() => go("galaxy")}>Explore memory <ArrowRight size={16} /></button></div>
          <div className="orbital-art"><i /><i /><i /><BrainCircuit /></div>
        </div>
        <div className="rail-card health-card">
          <div><small>Workspace memory</small><h3>{ideas.length ? "Growing steadily" : "Ready to grow"}</h3><p>{ideas.length} memories across {categoryCounts.filter((item) => item.value > 0).length} active spaces</p></div>
          <div className="progress-ring" style={{ "--progress": `${Math.min(100, ideas.length * 5)}%` } as React.CSSProperties}><span>{Math.min(100, ideas.length * 5)}%</span></div>
        </div>
        <div className="rail-list">
          <div className="section-heading"><div><h2>Priority queue</h2></div><button onClick={() => go("library")}>View all</button></div>
          {ideas.filter((idea) => idea.status === "open").slice(0, 5).map((idea) => <button key={idea.id} onClick={() => select(idea)}><CategoryIcon idea={idea} /><span><strong>{idea.content}</strong><small>{categoryMeta[getCategory(idea)].label} · {shortDate(idea.created_at)}</small></span><ChevronRight /></button>)}
          {!ideas.length && <p className="muted">No memories captured yet.</p>}
        </div>
      </aside>
    </div>
  );
}

function GalaxyPage({ ideas, select }: { ideas: Idea[]; select: (idea: Idea) => void }) {
  const [query, setQuery] = useState("");
  return <div className="galaxy-view canvas-mode">
    <div className="galaxy-toolbar"><span><Orbit size={18} /> {ideas.length.toLocaleString()} connected memories</span><div className="galaxy-actions"><button title="Add memory" onClick={() => document.querySelector<HTMLButtonElement>(".floating-capture")?.click()}><Plus size={18} /></button></div><label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles or hubs" />{query && <button onClick={() => setQuery("")}><X size={15} /></button>}</label></div>
    <GalaxyCanvas ideas={ideas} query={query} onSelect={(id) => { const idea = ideas.find((item) => item.id === id); if (idea) select(idea); }} />
  </div>;
  /* Legacy DOM graph retained below temporarily for source compatibility. */
  const graph = useMemo(() => {
    const activeCategories = (Object.keys(categoryMeta) as Category[]).filter((category) => ideas.some((idea) => getCategory(idea) === category));
    const hubs = activeCategories.map((category, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, activeCategories.length)) * Math.PI * 2;
      return { category, x: 50 + Math.cos(angle) * 27, y: 50 + Math.sin(angle) * 30 };
    });
    const nodes = ideas.slice(0, 60).map((idea) => {
      const category = getCategory(idea);
      const hub = hubs.find((item) => item.category === category) ?? { x: 50, y: 50 };
      const siblings = ideas.filter((item) => getCategory(item) === category).slice(0, 60);
      const siblingIndex = siblings.findIndex((item) => item.id === idea.id);
      const angle = siblingIndex * 2.399 + activeCategories.indexOf(category) * .63;
      const ring = 8 + (siblingIndex % 3) * 4.2;
      return { idea, category, x: Math.max(5, Math.min(95, hub.x + Math.cos(angle) * ring)), y: Math.max(7, Math.min(93, hub.y + Math.sin(angle) * ring)) };
    });
    return { hubs, nodes };
  }, [ideas]);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = graph.nodes.filter(({ idea }) => !normalizedQuery || idea.content.toLowerCase().includes(normalizedQuery));
  const years = Array.from(new Set(ideas.map((idea) => idea.created_at?.slice(0, 4)).filter(Boolean))).sort();

  return <div className="galaxy-view">
    <div className="galaxy-toolbar">
      <span><Orbit size={18} /> {ideas.length} connected memories</span>
      <div className="galaxy-actions"><button title="Center graph"><Network size={17} /></button><button title="Add memory" onClick={() => document.querySelector<HTMLButtonElement>(".floating-capture")?.click()}><Plus size={18} /></button></div>
      <label><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the galaxy" />{query && <button onClick={() => setQuery("")}><X size={15} /></button>}</label>
    </div>
    <div className="constellation">
      <div className="star-field" /><div className="constellation-glow" /><div className="constellation-glow secondary" />
      <div className="galaxy-timeline"><span>Now</span>{years.length ? years.slice(-5).reverse().map((year) => <small key={year}>{year}</small>) : <><small>2025</small><small>2024</small><small>2023</small></>}</div>
      <svg className="graph-edges" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs><linearGradient id="core-edge" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f6d399" /><stop offset="1" stopColor="#75d9dc" /></linearGradient></defs>
        {graph.hubs.map((hub) => <line className="hub-edge" key={`core-${hub.category}`} x1="50" y1="50" x2={hub.x} y2={hub.y} />)}
        {graph.nodes.map((node) => { const hub = graph.hubs.find((item) => item.category === node.category)!; return <line className={`memory-edge ${normalizedQuery && !node.idea.content.toLowerCase().includes(normalizedQuery) ? "dimmed" : ""}`} key={`edge-${node.idea.id}`} x1={hub.x} y1={hub.y} x2={node.x} y2={node.y} />; })}
        {graph.hubs.map((hub, index) => graph.hubs[index + 1] ? <line className="cross-edge" key={`cross-${hub.category}`} x1={hub.x} y1={hub.y} x2={graph.hubs[index + 1].x} y2={graph.hubs[index + 1].y} /> : null)}
      </svg>

      <div className="core-node"><span className="core-rings" /><BrainCircuit /><strong>Recall core</strong><small>{ideas.length} memories</small></div>
      {graph.hubs.map((hub) => { const meta = categoryMeta[hub.category]; const Icon = meta.icon; const count = graph.nodes.filter((node) => node.category === hub.category).length; return <div key={hub.category} className="category-hub" style={{ left: `${hub.x}%`, top: `${hub.y}%`, "--node": meta.color } as React.CSSProperties}><span><Icon /></span><strong>{meta.label}</strong><small>{count}</small></div>; })}
      {graph.nodes.map(({ idea, x, y, category }, index) => {
        const matched = !normalizedQuery || idea.content.toLowerCase().includes(normalizedQuery);
        return <button key={idea.id} aria-label={idea.content} className={`memory-node priority-${getPriority(idea)} ${matched ? "" : "dimmed"}`} onClick={() => select(idea)} style={{ left: `${x}%`, top: `${y}%`, "--node": categoryMeta[category].color, "--delay": `${(index % 10) * -.4}s` } as React.CSSProperties}><i>{index + 1}</i><span>{idea.content}</span></button>;
      })}
      {!ideas.length && <div className="galaxy-empty"><Orbit /><strong>Your galaxy is waiting</strong><span>Capture memories to build your knowledge graph.</span></div>}
      {ideas.length > 0 && normalizedQuery && !matches.length && <div className="galaxy-no-match">No memories match “{query}”</div>}

      <div className="galaxy-legend"><strong>Legend</strong>{(Object.keys(categoryMeta) as Category[]).filter((category) => graph.hubs.some((hub) => hub.category === category)).map((category) => <span key={category}><i style={{ background: categoryMeta[category].color }} />{categoryMeta[category].label}<small>{graph.nodes.filter((node) => node.category === category).length}</small></span>)}</div>
      <div className="galaxy-summary"><span><strong>{ideas.filter((idea) => idea.status === "open").length}</strong> Open</span><span><strong>{ideas.filter((idea) => getPriority(idea) === "high").length}</strong> High priority</span><span><strong>{graph.hubs.length}</strong> Spaces</span></div>
    </div>
  </div>;
}

function CapturePage({ onCreated, projects, defaultProject }: { onCreated: (idea: Idea) => void; projects: Project[]; defaultProject: string }) {
  const [content, setContent] = useState(""); const [priority, setPriority] = useState<Priority>("medium"); const [category, setCategory] = useState<Category>("note"); const [topic, setTopic] = useState(""); const [projectId, setProjectId] = useState(defaultProject); const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>("backlog"); const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const resolvedTopic = topic.trim() || inferMemoryTopic({ content });
      const idea = await api<Idea>("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, priority, category, topic: resolvedTopic, project_id: projectId || null, workflow_status: workflowStatus }) });
      onCreated({ ...idea, priority, category, topic: resolvedTopic, project_id: projectId || null, workflow_status: workflowStatus, created_at: new Date().toISOString(), source: "ui" });
    } finally { setSaving(false); }
  };
  return <div className="content-page narrow"><div className="capture-panel"><span className="eyebrow"><PlusCircle size={16} /> New memory</span><h2>What should your future self remember?</h2><p>Capture a decision, idea, issue, or note. Recall automatically links it to your current repository and branch.</p><textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} placeholder="e.g. We chose event sourcing for payments because..." />
    <div className="field-group"><label>Topic hub <small>Leave blank for automatic grouping</small></label><div className="topic-input"><Network size={17} /><input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder={content ? `Suggested: ${inferMemoryTopic({ content })}` : "e.g. Lifestyle, Product, Learning"} /></div></div>
    <div className="capture-context-row"><div className="field-group"><label>Project</label><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Inbox</option>{projects.filter((project) => project.status === "active").map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></div><div className="field-group"><label>Lifecycle</label><select value={workflowStatus} onChange={(event) => setWorkflowStatus(event.target.value as WorkflowStatus)}>{(Object.keys(workflowMeta) as WorkflowStatus[]).map((status) => <option value={status} key={status}>{workflowMeta[status].label}</option>)}</select></div></div>
    <div className="field-group"><label>Priority</label><div className="choice-row">{(["high", "medium", "low"] as Priority[]).map((item) => <button key={item} className={priority === item ? "selected" : ""} onClick={() => setPriority(item)}><i className={item} />{item}</button>)}</div></div>
    <div className="field-group"><label>Memory space</label><div className="category-choices">{(Object.keys(categoryMeta) as Category[]).map((item) => { const Icon = categoryMeta[item].icon; return <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}><Icon />{categoryMeta[item].label}</button>; })}</div></div>
    <div className="capture-footer"><small>{content.length} characters</small><button className="primary-button" disabled={!content.trim() || saving} onClick={() => void submit()}>{saving ? "Saving…" : "Save memory"}<ArrowRight size={17} /></button></div>
  </div></div>;
}

function LibraryPage({ ideas, loading, select, generate, updateWorkflow }: { ideas: Idea[]; loading: boolean; select: (idea: Idea) => void; generate: (idea: Idea) => void; updateWorkflow: (id: string, status: WorkflowStatus) => Promise<void> }) {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState<"all" | "open" | "resolved">("all"); const [view, setView] = useState<"board" | "cards">("board");
  const filtered = ideas.filter((idea) => (filter === "all" || idea.status === filter) && idea.content.toLowerCase().includes(query.toLowerCase()));
  return <div className="content-page"><div className="library-tools"><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every memory…" /></label><div>{(["all", "open", "resolved"] as const).map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="view-toggle"><button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>Board</button><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>Cards</button></div></div>{view === "cards" ? <div className="library-grid">{loading ? <LoadingCards /> : filtered.map((idea) => <MemoryCard key={idea.id} idea={idea} onClick={() => select(idea)} onGenerate={() => generate(idea)} />)}{!loading && !filtered.length && <div className="empty-search">No matching memories found.</div>}</div> : <div className="lifecycle-board">{(Object.keys(workflowMeta) as WorkflowStatus[]).map((status) => <section key={status}><header><i style={{ background: workflowMeta[status].color }} /><strong>{workflowMeta[status].label}</strong><span>{filtered.filter((idea) => (idea.workflow_status || "backlog") === status).length}</span></header><div>{filtered.filter((idea) => (idea.workflow_status || "backlog") === status).map((idea) => <article key={idea.id}><button onClick={() => select(idea)}>{idea.content}</button><small>{idea.topic || inferMemoryTopic(idea)}</small><div className="board-card-actions"><select value={idea.workflow_status || "backlog"} onChange={(event) => void updateWorkflow(idea.id, event.target.value as WorkflowStatus)}>{(Object.keys(workflowMeta) as WorkflowStatus[]).map((next) => <option key={next} value={next}>{workflowMeta[next].label}</option>)}</select><button onClick={() => generate(idea)} title="Generate implementation package"><Sparkles /></button></div></article>)}</div></section>)}</div>}</div>;
}

function DigestPage({ select, generate }: { select: (idea: Idea) => void; generate: (idea: Idea) => void }) {
  const [digest, setDigest] = useState<DigestData | null>(null);
  useEffect(() => { void api<DigestData>("/api/digest").then(setDigest); }, []);
  return <div className="content-page"><div className="digest-hero"><span><Sparkles /></span><div><small>Weekly digest</small><h2>The context worth carrying forward.</h2><p>Recent memories and relevant ideas resurfaced for this workspace.</p></div></div>{!digest ? <LoadingCards /> : <><DigestSection title="Captured this week" ideas={digest.recent} select={select} generate={generate} /><DigestSection title="Resurfaced for you" ideas={digest.resurfaced} select={select} generate={generate} /></>}</div>;
}

function DigestSection({ title, ideas, select, generate }: { title: string; ideas: Idea[]; select: (idea: Idea) => void; generate: (idea: Idea) => void }) { return <section className="digest-section"><div className="section-heading"><div><h2>{title}</h2><p>{ideas.length} memories</p></div></div><div className="recent-grid">{ideas.map((idea) => <MemoryCard key={idea.id} idea={idea} onClick={() => select(idea)} onGenerate={() => generate(idea)} />)}{!ideas.length && <p className="muted">Nothing here yet.</p>}</div></section>; }

function MemoryCard({ idea, onClick, onGenerate }: { idea: Idea; onClick: () => void; onGenerate: () => void }) { const category = getCategory(idea); return <div className="memory-card"><button className="memory-card-main" onClick={onClick}><div className="memory-card-top"><CategoryIcon idea={idea} /><span className={`status ${idea.status}`}>{idea.status}</span></div><h3>{idea.content}</h3><div className="memory-meta"><span><Clock3 size={14} />{shortDate(idea.created_at)}</span><span><GitBranch size={14} />{idea.context?.branch || "workspace"}</span></div><div className="memory-card-foot"><span style={{ color: categoryMeta[category].color }}>{categoryMeta[category].label}</span><ArrowRight size={17} /></div></button><button className="memory-card-generate" onClick={onGenerate} title="Generate implementation package"><Sparkles size={14} />Generate</button></div>; }
function CategoryIcon({ idea }: { idea: Idea }) { const meta = categoryMeta[getCategory(idea)]; const Icon = meta.icon; return <span className="category-icon" style={{ background: `${meta.color}18`, color: meta.color }}><Icon /></span>; }
function LoadingCards() { return <>{[1, 2, 3].map((item) => <div className="loading-card" key={item}><i /><i /><i /></div>)}</>; }
function EmptyState({ action }: { action: () => void }) { return <div className="empty-state"><BookOpen /><h3>Your memory is empty</h3><p>Capture the first decision or idea from this workspace.</p><button onClick={action}>Capture memory</button></div>; }

function CreateProjectModal({ close, created }: { close: () => void; created: (project: Project) => void }) {
  const [name, setName] = useState(""); const [color, setColor] = useState("#6674ef"); const [saving, setSaving] = useState(false);
  const colors = ["#6674ef", "#a679e9", "#e7758e", "#e8a754", "#4eb995", "#56a5d8"];
  const submit = async () => { if (!name.trim() || saving) return; setSaving(true); try { created(await api<Project>("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, color }) })); } finally { setSaving(false); } };
  return <><button className="modal-scrim" onClick={close} aria-label="Close" /><div className="project-modal"><button className="modal-close" onClick={close}><X /></button><span className="eyebrow"><LayoutGrid size={16} /> New project</span><h2>Create a memory workspace</h2><p>Projects keep related memories, active work, and their knowledge graph together.</p><label>Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="e.g. Health reset, Product launch" /></label><label>Color<div className="project-colors">{colors.map((item) => <button key={item} className={color === item ? "selected" : ""} style={{ background: item }} onClick={() => setColor(item)} />)}</div></label><button className="primary-button" disabled={!name.trim() || saving} onClick={() => void submit()}>{saving ? "Creating…" : "Create project"}<ArrowRight size={17} /></button></div></>;
}

function DetailDrawer({ idea, projects, generate, close, changed, deleted, resolved }: { idea: Idea; projects: Project[]; generate: () => void; close: () => void; changed: (patch: Partial<Idea>) => void; deleted: () => void; resolved: () => void }) {
  const category = getCategory(idea); const meta = categoryMeta[category];
  const [confirmingDelete, setConfirmingDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  const resolve = async () => { await api(`/api/ideas/${idea.id}/resolve`, { method: "POST" }); resolved(); };
  const assign = async (projectId: string) => { await api(`/api/ideas/${idea.id}/project`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId || null }) }); changed({ project_id: projectId || null }); };
  const move = async (workflowStatus: WorkflowStatus) => { await api(`/api/ideas/${idea.id}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: workflowStatus }) }); changed({ workflow_status: workflowStatus }); };
  const remove = async () => assign("");
  const removePermanently = async () => { setDeleting(true); try { await api(`/api/ideas/${idea.id}`, { method: "DELETE" }); deleted(); } finally { setDeleting(false); } };
  return <><button className="drawer-scrim" onClick={close} aria-label="Close detail" /><aside className="detail-drawer"><div className="drawer-head"><span className="eyebrow"><meta.icon size={16} /> {meta.label}</span><button onClick={close}><X /></button></div><div className="drawer-body"><div className="drawer-status"><span className={`status ${idea.status}`}>{idea.status}</span><span className={`priority ${getPriority(idea)}`}>{getPriority(idea)} priority</span></div><h2>{idea.content}</h2><button className="generate-handoff" onClick={generate}><Sparkles size={17} /><span><strong>Generate implementation package</strong><small>Create a spec, prompt, or skill for an AI coding tool</small></span><ArrowRight size={16} /></button>{idea.reason && <p className="reason"><Sparkles size={16} />{idea.reason}</p>}<div className="drawer-organize"><label>Move to project<select value={idea.project_id || ""} onChange={(event) => void assign(event.target.value)}><option value="">Inbox</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Lifecycle<select value={idea.workflow_status || "backlog"} onChange={(event) => void move(event.target.value as WorkflowStatus)}>{(Object.keys(workflowMeta) as WorkflowStatus[]).map((status) => <option value={status} key={status}>{workflowMeta[status].label}</option>)}</select></label>{idea.project_id && <button className="remove-project" onClick={() => void remove()}><FolderX size={15} />Remove from project</button>}</div><dl><div><dt>Topic hub</dt><dd>{idea.topic || inferMemoryTopic(idea)}</dd></div><div><dt>Created</dt><dd>{shortDate(idea.created_at)}</dd></div><div><dt>Source</dt><dd>{idea.source || "CLI"}</dd></div><div><dt>Branch</dt><dd>{idea.context?.branch || "—"}</dd></div><div><dt>File</dt><dd>{idea.context?.file_path?.split(/[\\/]/).pop() || "—"}</dd></div></dl><div className="danger-zone">{confirmingDelete ? <div><span><strong>Delete this memory?</strong><small>This cannot be undone.</small></span><button onClick={() => setConfirmingDelete(false)}>Cancel</button><button className="confirm-delete" disabled={deleting} onClick={() => void removePermanently()}>{deleting ? "Deleting…" : "Delete"}</button></div> : <button onClick={() => setConfirmingDelete(true)}><Trash2 size={16} />Delete memory</button>}</div></div><div className="drawer-foot">{idea.status === "open" && <button className="primary-button" onClick={() => void resolve()}><Check size={17} />Mark resolved</button>}<button className="secondary-button" onClick={close}>Close</button></div></aside></>;
}
