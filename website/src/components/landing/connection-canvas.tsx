"use client";

import { useEffect, useRef } from "react";

interface AgentNode {
  label: string;
  baseAngle: number;
  orbitRadius: number;
  speed: number;
  size: number;
}

interface Particle {
  progress: number;
  speed: number;
  nodeIndex: number;
  size: number;
}

const AGENTS: AgentNode[] = [
  { label: "Claude Code", baseAngle: 1.8, orbitRadius: 0.35, speed: -0.09, size: 4.5 },
  { label: "Pi", baseAngle: 4.9, orbitRadius: 0.22, speed: -0.07, size: 3 },
];

export function ConnectionCanvas({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const dpr = window.devicePixelRatio || 1;
    let width = 0;
    let height = 0;
    let animId = 0;
    let time = 0;

    // Create particles
    const particles: Particle[] = [];
    AGENTS.forEach((_, i) => {
      for (let j = 0; j < 4; j++) {
        particles.push({
          progress: j / 4 + Math.random() * 0.1,
          speed: 0.002 + Math.random() * 0.003,
          nodeIndex: i,
          size: 1 + Math.random() * 1.5,
        });
      }
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const getColors = () => {
      const isDark =
        !document.documentElement.classList.contains("theme-light");
      return {
        dot: isDark ? "168,162,158" : "120,113,108",
        fg: isDark ? "250,250,249" : "28,25,23",
        accent: isDark ? "232,196,160" : "180,130,80",
        line: isDark ? "168,162,158" : "120,113,108",
        dotOpacity: isDark ? 0.06 : 0.08,
      };
    };

    const draw = () => {
      if (prefersReduced && time > 0.5) return;
      time += 0.016;
      ctx.clearRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.48;
      const scale = Math.min(width, height);
      const c = getColors();

      // ── Background dot grid ──
      const spacing = 48;
      ctx.fillStyle = `rgba(${c.dot},${c.dotOpacity})`;
      for (let x = spacing / 2; x < width; x += spacing) {
        for (let y = spacing / 2; y < height; y += spacing) {
          // Fade dots near edges
          const edgeFade =
            Math.min(x, width - x, y, height - y) / (spacing * 3);
          const fade = Math.min(1, edgeFade);
          if (fade < 0.05) continue;
          ctx.globalAlpha = fade;
          ctx.beginPath();
          ctx.arc(x, y, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // ── Orbit rings (very subtle) ──
      AGENTS.forEach((agent) => {
        ctx.beginPath();
        ctx.arc(cx, cy, agent.orbitRadius * scale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${c.line},0.04)`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });

      // ── Update agent positions ──
      const agentPositions = AGENTS.map((agent) => {
        const angle = agent.baseAngle + time * agent.speed;
        return {
          x: cx + Math.cos(angle) * agent.orbitRadius * scale,
          y: cy + Math.sin(angle) * agent.orbitRadius * scale,
          ...agent,
        };
      });

      // ── Connection arcs ──
      agentPositions.forEach((agent) => {
        const dx = agent.x - cx;
        const dy = agent.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const curvature = dist * 0.15;
        const cpx = (cx + agent.x) / 2 + perpX * curvature;
        const cpy = (cy + agent.y) / 2 + perpY * curvature;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cpx, cpy, agent.x, agent.y);
        ctx.strokeStyle = `rgba(${c.line},0.06)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // ── Particles ──
      particles.forEach((p) => {
        p.progress += p.speed;
        if (p.progress > 1) p.progress -= 1;

        const agent = agentPositions[p.nodeIndex];
        const dx = agent.x - cx;
        const dy = agent.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const curvature = dist * 0.15;
        const cpx = (cx + agent.x) / 2 + perpX * curvature;
        const cpy = (cy + agent.y) / 2 + perpY * curvature;

        const t = p.progress;
        const mt = 1 - t;
        const px = mt * mt * cx + 2 * mt * t * cpx + t * t * agent.x;
        const py = mt * mt * cy + 2 * mt * t * cpy + t * t * agent.y;

        const opacity = Math.sin(t * Math.PI) * 0.7;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, p.size * 3);
        grd.addColorStop(0, `rgba(${c.accent},${opacity})`);
        grd.addColorStop(1, `rgba(${c.accent},0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(px, py, p.size * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, p.size * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c.accent},${opacity * 1.2})`;
        ctx.fill();
      });

      // ── Agent nodes ──
      agentPositions.forEach((agent) => {
        // Glow
        const grd = ctx.createRadialGradient(
          agent.x,
          agent.y,
          0,
          agent.x,
          agent.y,
          agent.size * 8
        );
        grd.addColorStop(0, `rgba(${c.fg},0.06)`);
        grd.addColorStop(1, "transparent");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, agent.size * 8, 0, Math.PI * 2);
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, agent.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c.fg},0.35)`;
        ctx.fill();

        // Label
        ctx.font = `11px var(--font-geist-sans), system-ui, sans-serif`;
        ctx.fillStyle = `rgba(${c.fg},0.2)`;
        ctx.textAlign = "center";
        ctx.fillText(agent.label, agent.x, agent.y + agent.size + 16);
      });

      // ── Center hub (phone) ──
      // Outer pulse ring
      const pulseR = 18 + Math.sin(time * 1.5) * 4;
      ctx.beginPath();
      ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${c.accent},${0.1 + Math.sin(time * 1.5) * 0.05})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Second pulse ring (offset phase)
      const pulseR2 = 26 + Math.sin(time * 1.5 + 1) * 5;
      ctx.beginPath();
      ctx.arc(cx, cy, pulseR2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${c.accent},${0.05 + Math.sin(time * 1.5 + 1) * 0.03})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Core glow
      const hubGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 35);
      hubGrd.addColorStop(0, `rgba(${c.accent},0.18)`);
      hubGrd.addColorStop(0.4, `rgba(${c.accent},0.06)`);
      hubGrd.addColorStop(1, "transparent");
      ctx.fillStyle = hubGrd;
      ctx.beginPath();
      ctx.arc(cx, cy, 35, 0, Math.PI * 2);
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${c.accent},0.8)`;
      ctx.fill();

      // Inner bright dot
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,0.9)`;
      ctx.fill();

      animId = requestAnimationFrame(draw);
    };

    resize();
    animId = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full ${className}`}
      aria-hidden="true"
    />
  );
}
