import { useEffect, useRef } from "react";

export function AmbientCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!; const ctx = canvas.getContext("2d")!; let frame = 0; let width = 0; let height = 0;
    const particles = Array.from({ length: 34 }, (_, index) => ({ x: (index * 83 % 997) / 997, y: (index * 151 % 991) / 991, radius: 1 + index % 3, speed: .04 + index % 4 * .015, phase: index * .7 }));
    const resize = () => { width = window.innerWidth; height = window.innerHeight; const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; ctx.setTransform(dpr,0,0,dpr,0,0); }; resize(); window.addEventListener("resize", resize);
    const draw = (time: number) => { ctx.clearRect(0,0,width,height); particles.forEach((particle) => { particle.y -= particle.speed / height; if (particle.y < -.02) particle.y = 1.02; ctx.globalAlpha = .08 + (Math.sin(time * .001 + particle.phase) + 1) * .05; ctx.fillStyle = "#5f74da"; ctx.beginPath(); ctx.arc(particle.x * width, particle.y * height, particle.radius, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1; frame = requestAnimationFrame(draw); }; frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas className="ambient-canvas" ref={ref} aria-hidden="true" />;
}

export function FirstMemoryCelebration({ onDone }: { onDone: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onDone, 5200); return () => window.clearTimeout(timer); }, [onDone]);
  const colors = ["#6674ef", "#ee7d96", "#65c6ac", "#f0b368", "#a679e9", "#65aee1"];
  return <div className="celebration" onClick={onDone} role="status" aria-live="polite">
    <div className="celebration-message"><span>✦</span><strong>Your Recall galaxy has begun</strong><small>Your first memory is now orbiting safely.</small></div>
    {Array.from({ length: 18 }, (_, index) => <i className="balloon" key={index} style={{ left: `${3 + (index * 13.7) % 92}%`, background: colors[index % colors.length], animationDelay: `${(index % 7) * .18}s`, animationDuration: `${3.5 + (index % 5) * .35}s` }}><b /></i>)}
    {Array.from({ length: 42 }, (_, index) => <i className="confetti" key={`c${index}`} style={{ left: `${(index * 29) % 100}%`, background: colors[(index + 2) % colors.length], animationDelay: `${(index % 12) * .09}s`, transform: `rotate(${index * 37}deg)` }} />)}
  </div>;
}
