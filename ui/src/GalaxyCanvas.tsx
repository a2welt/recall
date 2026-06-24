import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, Sparkles } from "lucide-react";

type GalaxyIdea = { id: string; content: string; topic?: string; priority?: "high" | "medium" | "low"; status: string };
type Point = { x: number; y: number };
type Hub = Point & { id: string; label: string; color: string; count: number; radius: number };
type MemoryNode = Point & { id: string; label: string; color: string; radius: number; idea: GalaxyIdea; hubId: string };
type Graph = { core: Hub; hubs: Hub[]; nodes: MemoryNode[] };

const topicColors = ["#ad7cf0", "#e47b9a", "#67c7b1", "#e6ad65", "#68a9e4", "#ee8761", "#8fc665", "#d177bc", "#72c7df", "#b4a96c", "#8e93ea", "#e79a62"];
const topicRules: Array<[string, RegExp]> = [
  ["Lifestyle", /\b(lifestyle|habit|routine|morning|sleep|food|meal|home|personal|weekend)\b/i],
  ["Health", /\b(health|fitness|exercise|workout|medical|wellness|diet|doctor|mental)\b/i],
  ["Finance", /\b(finance|money|budget|saving|investment|payment|billing|price|cost|revenue)\b/i],
  ["Relationships", /\b(family|friend|relationship|partner|team|people|community|customer)\b/i],
  ["Learning", /\b(learn|course|study|book|research|training|lesson|education|read)\b/i],
  ["Travel", /\b(travel|trip|flight|hotel|holiday|vacation|journey|visit)\b/i],
  ["Product", /\b(product|feature|user|ux|roadmap|launch|requirement|feedback)\b/i],
  ["Engineering", /\b(code|api|database|server|client|react|typescript|architecture|bug|deploy|cache|git|test)\b/i],
  ["Work", /\b(work|project|meeting|deadline|office|career|business|strategy)\b/i],
  ["Creativity", /\b(create|design|write|music|art|idea|creative|story|visual)\b/i],
];

export const inferMemoryTopic = (idea: Pick<GalaxyIdea, "content" | "topic">) => idea.topic?.trim() || topicRules.find(([, pattern]) => pattern.test(idea.content))?.[0] || "General";

const hash = (text: string) => { let value = 2166136261; for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 16777619); return Math.abs(value); };
const truncate = (text: string, max = 34) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

function buildGraph(ideas: GalaxyIdea[]): Graph {
  const grouped = new Map<string, GalaxyIdea[]>();
  ideas.forEach((idea) => { const topic = inferMemoryTopic(idea); grouped.set(topic, [...(grouped.get(topic) ?? []), idea]); });
  const entries = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);
  const worldRadius = Math.max(380, 235 + entries.length * 34);
  const hubs: Hub[] = entries.map(([label, memories], index) => {
    const angle = index * 2.399963 - Math.PI / 2;
    const ring = entries.length <= 6 ? worldRadius : 250 + Math.sqrt(index + 1) * 135;
    return { id: `hub:${label}`, label, count: memories.length, color: topicColors[hash(label) % topicColors.length], x: Math.cos(angle) * ring, y: Math.sin(angle) * ring * .72, radius: 29 + Math.min(22, Math.sqrt(memories.length) * 5) };
  });
  const nodes: MemoryNode[] = [];
  entries.forEach(([topic, memories]) => {
    const hub = hubs.find((candidate) => candidate.label === topic)!;
    memories.forEach((idea, index) => {
      const angle = index * 2.399963 + (hash(idea.id) % 100) / 100;
      const ring = 88 + Math.floor(index / 7) * 58 + (hash(idea.content) % 28);
      nodes.push({ id: idea.id, label: idea.content, idea, hubId: hub.id, color: hub.color, x: hub.x + Math.cos(angle) * ring, y: hub.y + Math.sin(angle) * ring * .72, radius: idea.priority === "high" ? 9 : idea.priority === "low" ? 5 : 7 });
    });
  });
  return { core: { id: "core", label: "Recall core", count: ideas.length, color: "#e2aa59", x: 0, y: 0, radius: 48 }, hubs, nodes };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill(); ctx.stroke();
}

export function GalaxyCanvas({ ideas, query, onSelect }: { ideas: GalaxyIdea[]; query: string; onSelect: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graph = useMemo(() => buildGraph(ideas), [ideas]);
  const graphRef = useRef(graph); graphRef.current = graph;
  const queryRef = useRef(query.toLowerCase()); queryRef.current = query.toLowerCase();
  const camera = useRef({ x: 0, y: 0, zoom: 1 });
  const pointer = useRef({ x: 0, y: 0, down: false, moved: false, startX: 0, startY: 0, cameraX: 0, cameraY: 0 });
  const hovered = useRef<string | null>(null);
  const [zoomLabel, setZoomLabel] = useState(100);

  useEffect(() => {
    const canvas = canvasRef.current!; const ctx = canvas.getContext("2d")!;
    let frame = 0; let width = 0; let height = 0; let dpr = 1; let shootingStarAt = 0;
    const stars = Array.from({ length: 270 }, (_, index) => ({ x: (hash(`x${index}`) % 10000) / 10000, y: (hash(`y${index}`) % 10000) / 10000, r: .35 + (hash(`r${index}`) % 140) / 100, phase: (hash(`p${index}`) % 628) / 100 }));
    const comets: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];
    const resize = () => { const rect = canvas.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); width = rect.width; height = rect.height; canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const toScreen = (point: Point) => ({ x: width / 2 + (point.x + camera.current.x) * camera.current.zoom, y: height / 2 + (point.y + camera.current.y) * camera.current.zoom });
    const drawGlow = (x: number, y: number, radius: number, color: string, strength = .45) => { const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 4); gradient.addColorStop(0, color); gradient.addColorStop(.18, `${color}88`); gradient.addColorStop(1, "transparent"); ctx.globalAlpha = strength; ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, radius * 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; };
    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const backdrop = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, Math.max(width, height) * .7); backdrop.addColorStop(0, "#163d3c"); backdrop.addColorStop(.55, "#0a2021"); backdrop.addColorStop(1, "#040b0d"); ctx.fillStyle = backdrop; ctx.fillRect(0, 0, width, height);
      stars.forEach((star) => { const alpha = .12 + ((Math.sin(time * .0012 + star.phase) + 1) / 2) * .46; ctx.globalAlpha = alpha; ctx.fillStyle = star.r > 1.2 ? "#d9f5ee" : "#82aaa5"; ctx.beginPath(); ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1;
      if (time - shootingStarAt > 2600 + (hash(String(Math.floor(time / 2500))) % 3500)) { shootingStarAt = time; comets.push({ x: width * (.1 + Math.random() * .7), y: -20, vx: 4 + Math.random() * 3, vy: 2 + Math.random() * 2, life: 1 }); }
      comets.forEach((comet) => { const gradient = ctx.createLinearGradient(comet.x, comet.y, comet.x - comet.vx * 15, comet.y - comet.vy * 15); gradient.addColorStop(0, `rgba(220,255,246,${comet.life})`); gradient.addColorStop(1, "transparent"); ctx.strokeStyle = gradient; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(comet.x, comet.y); ctx.lineTo(comet.x - comet.vx * 15, comet.y - comet.vy * 15); ctx.stroke(); comet.x += comet.vx; comet.y += comet.vy; comet.life -= .009; }); for (let index = comets.length - 1; index >= 0; index -= 1) if (comets[index].life <= 0) comets.splice(index, 1);

      const current = graphRef.current; const zoom = camera.current.zoom; const q = queryRef.current; const core = toScreen(current.core);
      current.hubs.forEach((hub) => { const point = toScreen(hub); ctx.strokeStyle = "rgba(232,190,123,.33)"; ctx.lineWidth = Math.max(.5, zoom); ctx.beginPath(); ctx.moveTo(core.x, core.y); ctx.lineTo(point.x, point.y); ctx.stroke(); });
      current.nodes.forEach((node) => { const hub = current.hubs.find((item) => item.id === node.hubId)!; const start = toScreen(hub); const end = toScreen(node); const matched = !q || node.label.toLowerCase().includes(q) || hub.label.toLowerCase().includes(q); ctx.globalAlpha = matched ? .42 : .035; ctx.strokeStyle = node.color; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); }); ctx.setLineDash([]); ctx.globalAlpha = 1;

      drawGlow(core.x, core.y, current.core.radius * zoom, current.core.color, .42); ctx.fillStyle = "#dcae63"; ctx.strokeStyle = "#ffe5ad"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(core.x, core.y, current.core.radius * zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#fff8e7"; ctx.textAlign = "center"; ctx.font = `700 ${Math.max(11, 14 * zoom)}px DM Sans`; ctx.fillText("Recall", core.x, core.y + 4 * zoom); ctx.font = `500 ${Math.max(8, 9 * zoom)}px DM Sans`; ctx.fillStyle = "#fff1cc"; ctx.fillText(`${current.core.count} memories`, core.x, core.y + 19 * zoom);

      current.hubs.forEach((hub) => { const point = toScreen(hub); const radius = hub.radius * zoom; drawGlow(point.x, point.y, radius, hub.color, .35); ctx.fillStyle = hub.color; ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = `700 ${Math.max(10, 12 * Math.min(zoom, 1.2))}px DM Sans`; ctx.fillText(truncate(hub.label, 16), point.x, point.y + 2); ctx.font = "500 9px DM Sans"; ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillText(`${hub.count} memories`, point.x, point.y + 15); });

      current.nodes.forEach((node) => { const point = toScreen(node); const hub = current.hubs.find((item) => item.id === node.hubId)!; const matched = !q || node.label.toLowerCase().includes(q) || hub.label.toLowerCase().includes(q); ctx.globalAlpha = matched ? 1 : .08; const radius = Math.max(3.5, node.radius * Math.min(zoom, 1.4)); drawGlow(point.x, point.y, radius, node.color, hovered.current === node.id ? .8 : .3); ctx.fillStyle = node.color; ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = hovered.current === node.id ? 2 : 1; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const showTitle = zoom >= .55 || hovered.current === node.id || Boolean(q); if (showTitle) { const label = truncate(node.label, zoom > 1.15 ? 48 : 31); ctx.font = `${hovered.current === node.id ? "700" : "500"} ${hovered.current === node.id ? 12 : 10}px DM Sans`; const textWidth = ctx.measureText(label).width; const boxWidth = textWidth + 16; const boxX = point.x - boxWidth / 2; const boxY = point.y + radius + 7; ctx.fillStyle = hovered.current === node.id ? "rgba(7,17,19,.96)" : "rgba(7,17,19,.78)"; ctx.strokeStyle = hovered.current === node.id ? node.color : "rgba(135,196,190,.17)"; roundedRect(ctx, boxX, boxY, boxWidth, 23, 6); ctx.fillStyle = "#e3edeb"; ctx.textAlign = "center"; ctx.fillText(label, point.x, boxY + 15); }
      }); ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const screenToWorld = (clientX: number, clientY: number) => { const rect = canvasRef.current!.getBoundingClientRect(); return { x: (clientX - rect.left - rect.width / 2) / camera.current.zoom - camera.current.x, y: (clientY - rect.top - rect.height / 2) / camera.current.zoom - camera.current.y }; };
  const findNode = (clientX: number, clientY: number) => { const world = screenToWorld(clientX, clientY); return graphRef.current.nodes.find((node) => Math.hypot(node.x - world.x, node.y - world.y) < Math.max(14, node.radius + 7)); };
  const zoom = (factor: number) => { camera.current.zoom = Math.max(.2, Math.min(3.5, camera.current.zoom * factor)); setZoomLabel(Math.round(camera.current.zoom * 100)); };
  const fit = () => { camera.current = { x: 0, y: 0, zoom: .72 }; setZoomLabel(72); };

  return <div className="galaxy-canvas-wrap">
    <canvas ref={canvasRef} onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.12 : .89); }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { x: event.clientX, y: event.clientY, down: true, moved: false, startX: event.clientX, startY: event.clientY, cameraX: camera.current.x, cameraY: camera.current.y }; }} onPointerMove={(event) => { const state = pointer.current; if (state.down) { const dx = event.clientX - state.startX; const dy = event.clientY - state.startY; if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true; camera.current.x = state.cameraX + dx / camera.current.zoom; camera.current.y = state.cameraY + dy / camera.current.zoom; } hovered.current = findNode(event.clientX, event.clientY)?.id ?? null; event.currentTarget.style.cursor = state.down ? "grabbing" : hovered.current ? "pointer" : "grab"; }} onPointerUp={(event) => { if (!pointer.current.moved) { const node = findNode(event.clientX, event.clientY); if (node) onSelect(node.id); } pointer.current.down = false; }} onPointerLeave={() => { pointer.current.down = false; hovered.current = null; }} />
    <div className="canvas-zoom"><button onClick={() => zoom(1.2)} aria-label="Zoom in"><Plus /></button><span>{zoomLabel}%</span><button onClick={() => zoom(.8)} aria-label="Zoom out"><Minus /></button><button onClick={fit} aria-label="Fit graph"><Maximize2 /></button></div>
    <div className="semantic-zoom"><Sparkles /> Scroll to zoom · drag to explore · titles appear as you move closer</div>
  </div>;
}
