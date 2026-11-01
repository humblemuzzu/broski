"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import {
  Layers,
  MessageSquare,
  FolderOpen,
  TerminalSquare,
  Wifi,
  Zap,
  ArrowRight,
  Shield,
  Lock,
  Globe,
  Check,
  X,
  Sun,
  Moon,
  ChevronRight,
  Folder,
  File,
  Signal,
  Smartphone,
  Monitor,
  Quote,
  Minus,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────

const isValidEmail = (e: string) =>
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(e);

const fireConfetti = () => {
  const end = Date.now() + 3000;
  const colors = ["#e8c4a0", "#fafaf9", "#a8a29e"];
  (function f() {
    confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 }, colors });
    confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(f);
  })();
};

// ─── Hooks ───────────────────────────────────────────────

function useScrolled() {
  const [s, setS] = useState(false);
  useEffect(() => {
    const h = () => setS(window.scrollY > 20);
    window.addEventListener("scroll", h, { passive: true });
    h();
    return () => window.removeEventListener("scroll", h);
  }, []);
  return s;
}

function useWaitlistCount() {
  return 0;
}

function useTheme() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("broski-theme") === "light") {
      document.documentElement.classList.add("theme-light");
      setLight(true);
    }
  }, []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("theme-light", next);
    localStorage.setItem("broski-theme", next ? "light" : "dark");
  };
  return { light, toggle };
}

// ─── Shared Components ───────────────────────────────────

function Reveal({ children, className = "", delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { delay ? setTimeout(() => setV(true), delay) : setV(true); obs.disconnect(); }
    }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`transition-all duration-700 ease-out ${v ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"} ${className}`}>
      {children}
    </div>
  );
}

function AnimatedNumber({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        const start = Date.now();
        const tick = () => {
          const t = Math.min((Date.now() - start) / 2000, 1);
          setVal(Math.round(target * (1 - Math.pow(1 - t, 3))));
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        obs.disconnect();
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref} className="tabular-nums">{val.toLocaleString()}{suffix}</span>;
}

function TypingCommand({ command }: { command: string }) {
  const [text, setText] = useState("");
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setStarted(true); obs.disconnect(); }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!started) return;
    let i = 0;
    const iv = setInterval(() => { setText(command.slice(0, ++i)); if (i >= command.length) clearInterval(iv); }, 50);
    return () => clearInterval(iv);
  }, [started, command]);
  return (
    <div ref={ref} className="font-mono text-sm">
      <span className="text-stone-500">$ </span>
      <span>{text}</span>
      <span className="inline-block w-[2px] h-[1em] bg-primary/70 ml-0.5 align-text-bottom animate-pulse" />
    </div>
  );
}

function WaitlistForm({ id }: { id?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [msg, setMsg] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !isValidEmail(email)) { setStatus("error"); setMsg("Please enter a valid email"); return; }
    setStatus("success");
    setMsg("Broski is open source — no waitlist or subscription.");
    setEmail("");
  };
  return (
    <div className="w-full max-w-md">
      <form id={id} onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
        <input type="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={status === "loading"}
          className="flex-1 h-12 px-4 rounded-xl bg-surface-1 border border-surface-2 text-foreground placeholder:text-stone-500 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all text-[15px]" />
        <button type="submit" disabled={status === "loading"}
          className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-semibold hover:brightness-110 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap text-[15px]">
          {status === "loading" ? "Joining..." : <><span>Join Waitlist</span><ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>
      {msg && <p className={`text-sm mt-3 ${status === "success" ? "text-emerald-500" : "text-red-400"}`}>{msg}</p>}
    </div>
  );
}

// ─── Bento Visual Demos ──────────────────────────────────

function SessionsDemo() {
  const sessions = [
    { agent: "Claude Code", project: "broski-app", color: "#e8c4a0", active: true },
    { agent: "Pi", project: "api-server", color: "#78a8b8", active: true },
  ];
  return (
    <div className="space-y-2">
      {sessions.map((s, i) => (
        <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-background/50 border border-surface-2"
          style={{ animation: `slideInRight 0.5s ease-out ${0.6 + i * 0.15}s both` }}>
          <div className="relative shrink-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-background" style={{ backgroundColor: s.color }}>
              {s.agent[0]}
            </div>
            {s.active && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-card animate-pulse" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-foreground truncate">{s.agent}</div>
            <div className="text-[10px] text-muted-foreground truncate">{s.project}</div>
          </div>
          <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function ChatDemo() {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="rounded-xl rounded-tr-sm px-2.5 py-1.5 bg-primary/15 text-[10px] text-foreground max-w-[80%]">
          fix the auth bug
        </div>
      </div>
      <div className="flex justify-start">
        <div className="rounded-xl rounded-tl-sm px-2.5 py-1.5 bg-surface-1 border border-surface-2 text-[10px] text-muted-foreground max-w-[85%]">
          I&apos;ll fix the auth middleware...
        </div>
      </div>
      <div className="rounded-lg bg-background/60 border border-surface-2 p-2 font-mono text-[9px] text-emerald-400/70">
        <span className="text-stone-500">+ </span>if (token.expired) refresh();
      </div>
    </div>
  );
}

function FilesDemo() {
  const items = [
    { name: "src/", icon: Folder, indent: 0 },
    { name: "providers/", icon: Folder, indent: 1 },
    { name: "auth.dart", icon: File, indent: 2 },
    { name: "connection.dart", icon: File, indent: 2 },
    { name: "screens/", icon: Folder, indent: 1 },
    { name: "chat_screen.dart", icon: File, indent: 2 },
  ];
  return (
    <div className="space-y-0.5 text-[10px] font-mono">
      {items.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors" style={{ paddingLeft: f.indent * 12 }}>
          <f.icon className="w-3 h-3 shrink-0 text-primary/50" />
          <span>{f.name}</span>
        </div>
      ))}
    </div>
  );
}

function ConnectionDemo() {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-4">
        {/* WiFi → Cellular transition */}
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px]">
            <div className="relative w-5 h-5">
              <Wifi className="w-5 h-5 text-muted-foreground/40 absolute inset-0 animate-[fadeOut_3s_ease-in-out_infinite]" />
              <Signal className="w-5 h-5 text-foreground/70 absolute inset-0 animate-[fadeIn_3s_ease-in-out_infinite]" />
            </div>
            <span className="text-muted-foreground">Network switch</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/20">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] font-medium text-emerald-400">Connected</span>
      </div>
    </div>
  );
}

function TerminalDemo() {
  const lines = [
    { text: "broski-bridge v2.1.0", color: "text-primary/60" },
    { text: "listening on :1337", color: "text-emerald-400/60" },
    { text: "phone connected ✓", color: "text-emerald-400/70" },
  ];
  return (
    <div className="font-mono text-[10px] space-y-0.5">
      {lines.map((l, i) => (
        <div key={i} className={l.color} style={{ animation: `slideInRight 0.4s ease-out ${0.8 + i * 0.2}s both` }}>
          {l.text}
        </div>
      ))}
      <div className="flex items-center gap-0.5 mt-1">
        <span className="text-stone-500">$</span>
        <div className="w-[2px] h-2.5 bg-emerald-400/60 animate-pulse" />
      </div>
    </div>
  );
}

function SyncDemo() {
  return (
    <div className="flex items-center gap-4">
      <div className="flex flex-col items-center gap-1">
        <div className="w-8 h-5 rounded-sm border border-surface-2 bg-background/50 flex items-center justify-center">
          <div className="w-5 h-3 rounded-[1px] bg-primary/20" />
        </div>
        <span className="text-[9px] text-muted-foreground">Mac</span>
      </div>
      {/* Sync line with flowing dot */}
      <div className="flex-1 relative h-px bg-surface-2">
        <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary animate-[flowRight_2s_ease-in-out_infinite]" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="w-4 h-7 rounded-md border border-surface-2 bg-background/50 flex items-center justify-center">
          <div className="w-2.5 h-4 rounded-[2px] bg-primary/20" />
        </div>
        <span className="text-[9px] text-muted-foreground">Phone</span>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold tabular-nums text-foreground">4<span className="text-sm text-muted-foreground">ms</span></div>
        <div className="text-[9px] text-muted-foreground">latency</div>
      </div>
    </div>
  );
}

// ─── Hero Phone ──────────────────────────────────────────

function HeroPhone() {
  return (
    <div className="relative w-[240px] sm:w-[260px] md:w-[280px] mx-auto md:mx-0">
      {/* Glow behind phone */}
      <div className="absolute -inset-8 bg-primary/[0.04] rounded-full blur-3xl" />
      {/* Phone frame */}
      <div className="relative rounded-[2.5rem] border border-surface-2 bg-card overflow-hidden aspect-[9/19.5] shadow-[0_8px_60px_rgba(0,0,0,0.3)]">
        {/* Dynamic Island */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[68px] h-[20px] bg-background rounded-full z-10" />
        {/* Screen content */}
        <div className="w-full h-full pt-10 px-3 pb-3 bg-background">
          {/* Status bar */}
          <div className="flex items-center justify-between px-1 mb-3" style={{ animation: "fadeInUp 0.5s ease-out 0.3s both" }}>
            <span className="text-[11px] font-semibold text-foreground">Sessions</span>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] text-emerald-400">Connected</span>
            </div>
          </div>
          {/* Session cards */}
          <SessionsDemo />
          {/* Bottom hint */}
          <div className="mt-3 text-center" style={{ animation: "fadeInUp 0.5s ease-out 1.2s both" }}>
            <div className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/50 px-2 py-1 rounded-full bg-surface-1">
              <span>2 active sessions</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sections ────────────────────────────────────────────

function Navbar() {
  const scrolled = useScrolled();
  const { light, toggle } = useTheme();
  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? "bg-background/70 backdrop-blur-2xl border-b border-surface-2" : ""}`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Image src="/broski-logo.png" alt="Broski" width={96} height={30} className="opacity-80 hover:opacity-100 transition-opacity" priority />
        <div className="flex items-center gap-4">
          <a href="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Docs</a>
          <button onClick={toggle} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-1 transition-all" aria-label="Toggle theme">
            {light ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button onClick={() => document.getElementById("waitlist-hero")?.scrollIntoView({ behavior: "smooth" })}
            className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 active:scale-[0.97] transition-all">
            Join Waitlist
          </button>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const count = useWaitlistCount();
  return (
    <section className="relative min-h-screen flex items-center pt-16 pb-16 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto w-full grid md:grid-cols-[1.1fr_0.9fr] gap-12 md:gap-16 items-center">
        {/* Text side */}
        <div>
          <Reveal>
            <p className="text-[11px] tracking-[0.25em] uppercase text-muted-foreground/60 mb-8 font-medium">
              Mobile companion for AI coding agents
            </p>
          </Reveal>
          <Reveal delay={100}>
            <h1 className="text-[2.5rem] sm:text-5xl md:text-[3.75rem] font-bold tracking-[-0.03em] leading-[1.08] mb-4">
              Your agents<br />are running.
            </h1>
          </Reveal>
          <Reveal delay={200}>
            <p className="font-serif text-2xl sm:text-3xl md:text-4xl italic text-primary mb-8 tracking-[-0.02em]">
              Take them with you.
            </p>
          </Reveal>
          <Reveal delay={300}>
            <p className="text-[15px] sm:text-base text-muted-foreground max-w-md mb-8 leading-relaxed">
              The native iOS app for Claude Code and Pi.
              Not a terminal wrapper — a real interface built for your phone.
            </p>
          </Reveal>
          <Reveal delay={400}>
            <WaitlistForm id="waitlist-hero" />
          </Reveal>
          <Reveal delay={500}>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-6 text-[13px] text-muted-foreground/60">
              <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-primary/50" />2 agents supported</span>
              <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-primary/50" />7-day free trial</span>
              <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-primary/50" />No credit card</span>
            </div>
          </Reveal>
          {count > 0 && (
            <Reveal delay={600}>
              <div className="flex items-center gap-2 mt-6 text-sm text-muted-foreground/60">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                <AnimatedNumber target={count} suffix="+" /> developers on the waitlist
              </div>
            </Reveal>
          )}
        </div>
        {/* Phone side */}
        <Reveal delay={300} className="hidden md:flex justify-center">
          <HeroPhone />
        </Reveal>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="grid md:grid-cols-[1.2fr_1fr] gap-14 md:gap-20 items-start">
          <div>
            <Reveal>
              <p className="text-[11px] tracking-[0.25em] uppercase text-muted-foreground/50 mb-5 font-medium">The problem</p>
            </Reveal>
            <Reveal delay={100}>
              <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-6">
                Not another<br /><span className="font-serif italic text-primary">terminal app.</span>
              </h2>
            </Reveal>
            <Reveal delay={200}>
              <p className="text-muted-foreground leading-relaxed max-w-md">
                SSH wrappers shrink your desktop into a phone screen.
                Connections drop when you switch networks. You&apos;re fighting the tool instead of shipping code.
              </p>
            </Reveal>
          </div>
          <div className="space-y-3">
            <Reveal delay={300}>
              <div className="p-5 rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md">
                <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground/40 mb-4 font-medium">The old way</p>
                <ul className="space-y-3">
                  {["Shrunken desktop terminal", "Drops on network switch", "Same UI for every tool", "Raw terminal output"].map((t, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-muted-foreground text-[14px]">
                      <X className="w-3.5 h-3.5 mt-0.5 shrink-0 text-stone-500/50" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={420}>
              <div className="p-5 rounded-2xl border border-primary/15 bg-primary/[0.03] backdrop-blur-md">
                <p className="text-[10px] tracking-[0.2em] uppercase text-primary/50 mb-4 font-medium">With Broski</p>
                <ul className="space-y-3">
                  {["Native mobile interface", "Survives WiFi to cellular", "Per-agent experience", "Rich UI components"].map((t, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-foreground text-[14px]">
                      <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentsSection() {
  const agents = [
    { name: "Claude Code", desc: "Anthropic's coding CLI", logo: "/logos/cc-real.png" },
    { name: "Pi", desc: "Extensible coding agent harness", logo: "/logos/pi.svg" },
  ];
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4 text-center">
            <span className="font-serif italic text-primary">One app.</span> Every agent.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="text-muted-foreground text-center max-w-lg mx-auto mb-12">
            Works with any terminal-based AI coding agent. Connect to the ones you already use.
          </p>
        </Reveal>
        <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
          {agents.map((a, i) => (
            <Reveal key={a.name} delay={200 + i * 80}>
              <div className="group p-4 sm:p-5 rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md hover:border-primary/20 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-all duration-300 text-center">
                <div className="w-10 h-10 rounded-xl bg-surface-1 border border-surface-2 flex items-center justify-center mx-auto mb-3 group-hover:border-primary/20 transition-colors">
                  {a.logo ? (
                    <Image src={a.logo} alt={a.name} width={20} height={20} className="rounded" />
                  ) : (
                    <TerminalSquare className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <h3 className="text-sm font-semibold mb-1">{a.name}</h3>
                <p className="text-[11px] text-muted-foreground/60">{a.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function BentoFeatures() {
  const features = [
    { icon: Layers, title: "Session Management", desc: "See every running session. Switch between agents, track token usage, monitor costs.", visual: <SessionsDemo />, large: true },
    { icon: MessageSquare, title: "Rich Chat UI", desc: "Markdown, syntax highlighting, inline diffs.", visual: <ChatDemo />, large: false },
    { icon: FolderOpen, title: "File Browser", desc: "Navigate and preview project files.", visual: <FilesDemo />, large: false },
    { icon: Wifi, title: "Never Drops", desc: "WiFi to cellular, sleep, background — your connection survives everything.", visual: <ConnectionDemo />, large: true },
    { icon: TerminalSquare, title: "Built-in Terminal", desc: "Full terminal when you need to go deeper.", visual: <TerminalDemo />, large: false },
    { icon: Zap, title: "Real-time Sync", desc: "RTT-adaptive batching for instant updates regardless of latency.", visual: <SyncDemo />, large: true },
  ];

  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4 text-center">
            Everything you need.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="text-muted-foreground text-center max-w-lg mx-auto mb-14">
            25 screens of purpose-built features. Not a proof of concept.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={200 + i * 70} className={f.large ? "md:col-span-2" : ""}>
              <div className="group h-full p-5 sm:p-6 rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md hover:border-primary/20 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.1)] transition-all duration-300">
                {/* Visual demo area */}
                <div className="mb-4 p-3 rounded-xl bg-card/80 border border-surface-2 overflow-hidden">
                  {f.visual}
                </div>
                {/* Text */}
                <div className="flex items-start gap-3">
                  <f.icon className="w-4 h-4 text-primary/60 mt-0.5 shrink-0" />
                  <div>
                    <h3 className="text-[14px] font-semibold mb-1 tracking-[-0.01em]">{f.title}</h3>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-5xl mx-auto">
        <Reveal><p className="text-[11px] tracking-[0.25em] uppercase text-muted-foreground/50 mb-5 font-medium text-center">Setup</p></Reveal>
        <Reveal delay={100}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] text-center mb-16">
            Running in <span className="font-serif italic text-primary">60 seconds.</span>
          </h2>
        </Reveal>
        <div className="relative">
          <div className="hidden md:block absolute top-12 left-[16.7%] right-[16.7%] h-px bg-gradient-to-r from-transparent via-surface-2 to-transparent" />
          <div className="grid md:grid-cols-3 gap-10 md:gap-8">
            {[
              { n: "01", title: "Install the bridge", desc: "One command on your Mac.", code: "broski-bridge" },
              { n: "02", title: "Scan the QR code", desc: "Open the app. Point your camera. Done.", code: null },
              { n: "03", title: "You're in", desc: "Full access to all your sessions. From anywhere.", code: null },
            ].map((s, i) => (
              <Reveal key={s.n} delay={200 + i * 150}>
                <div className="text-center relative">
                  <div className="hidden md:flex w-5 h-5 rounded-full border-2 border-surface-2 bg-background mx-auto mb-6 relative z-10 items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-primary/50" />
                  </div>
                  <span className="text-xs tracking-[0.2em] text-primary/40 font-mono">{s.n}</span>
                  <h3 className="text-lg font-semibold mt-2 mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{s.desc}</p>
                  {s.code && (
                    <div className="inline-flex items-center px-4 py-3 rounded-xl border border-surface-2 bg-surface-glass backdrop-blur-md">
                      <TypingCommand command={s.code} />
                    </div>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Security() {
  const pts = [
    { icon: Globe, title: "Direct Connection", desc: "Phone connects directly to your machine. No relay servers." },
    { icon: Lock, title: "Encrypted Transport", desc: "All traffic encrypted in transit. Never readable on the wire." },
    { icon: Shield, title: "No Cloud Relay", desc: "Your data never touches our servers. Zero knowledge." },
  ];
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="grid md:grid-cols-[1fr_1.4fr] gap-14 items-start">
          <div>
            <Reveal>
              <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-6">
                Your code<br /><span className="font-serif italic text-primary">stays yours.</span>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="text-muted-foreground leading-relaxed">Broski connects your phone directly to your machine. No third-party servers, no cloud middleman.</p>
            </Reveal>
          </div>
          <div className="space-y-3">
            {pts.map((p, i) => (
              <Reveal key={p.title} delay={200 + i * 100}>
                <div className="group p-5 rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md hover:border-primary/20 hover:-translate-y-0.5 transition-all duration-300 flex items-start gap-4">
                  <div className="w-9 h-9 rounded-xl bg-primary/[0.06] flex items-center justify-center shrink-0 group-hover:bg-primary/[0.1] transition-colors">
                    <p.icon className="w-4 h-4 text-primary/60" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold mb-1">{p.title}</h3>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{p.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-lg mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] mb-10">
            <span className="font-serif italic text-primary">Simple</span> pricing.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <div className="p-8 sm:p-10 rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <div className="mb-5">
              <span className="text-5xl sm:text-6xl font-bold tracking-[-0.04em]">Free</span>
            </div>
            <p className="text-muted-foreground mb-6">Open source. No subscription, no paywall.</p>
            <div className="grid grid-cols-2 gap-2 text-left max-w-xs mx-auto">
              {["Both agents", "25+ screens", "Unlimited sessions", "File browser", "Built-in terminal", "Priority support"].map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Check className="w-3.5 h-3.5 text-primary/50 shrink-0" />{f}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FinalCTA() {
  const count = useWaitlistCount();
  return (
    <section className="relative py-24 md:py-32 lg:py-40 px-6 overflow-hidden">
      <div className="relative max-w-3xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-6">
            Stop doom scrolling.<br /><span className="font-serif italic text-primary">Start shipping.</span>
          </h2>
        </Reveal>
        <Reveal delay={100}><p className="text-muted-foreground mb-10">Free and open source. Pair your phone to your machine.</p></Reveal>
        <Reveal delay={200} className="flex justify-center"><WaitlistForm /></Reveal>
        {count > 0 && (
          <Reveal delay={300}>
            <div className="flex items-center justify-center gap-2 mt-8 text-sm text-muted-foreground/60">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <AnimatedNumber target={count} suffix="+" /> developers waiting
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-10 px-6 border-t border-surface-2">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image src="/broski-logo.png" alt="Broski" width={72} height={22} className="opacity-40" />
          <span className="text-xs text-muted-foreground/30">&copy; {new Date().getFullYear()}</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground/50">
          <a href="/docs" className="hover:text-foreground transition-colors">Docs</a>
          <a href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy</a>
          <a href="/legal/terms" className="hover:text-foreground transition-colors">Terms</a>
          <a href="mailto:broskiappp@gmail.com" className="hover:text-foreground transition-colors">Support</a>
        </div>
      </div>
    </footer>
  );
}

// ─── Stats Bar ───────────────────────────────────────────

function StatsBar() {
  const stats = [
    { value: 25, suffix: "+", label: "Screens" },
    { value: 2, suffix: "", label: "Agents" },
    { value: 60, suffix: "s", label: "Setup" },
    { value: 0, suffix: "", label: "Cloud servers", override: "Zero" },
  ];
  return (
    <section className="py-16 md:py-20 px-6 border-y border-surface-2">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
            {stats.map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[-0.04em] text-foreground mb-1">
                  {s.override ? s.override : <AnimatedNumber target={s.value} suffix={s.suffix} />}
                </div>
                <div className="text-sm text-muted-foreground/60">{s.label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── App Showcase ────────────────────────────────────────

function AppShowcase() {
  const screens = [
    { title: "Chat with your agent", desc: "Rich markdown, code blocks, and diffs — all rendered natively." },
    { title: "Browse project files", desc: "Navigate your codebase, preview files, and review changes." },
    { title: "Full terminal access", desc: "When you need raw power, the terminal is right there." },
  ];
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <p className="text-[11px] tracking-[0.25em] uppercase text-muted-foreground/50 mb-5 font-medium text-center">Inside the app</p>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-6 text-center">
            Built for your <span className="font-serif italic text-primary">thumbs.</span>
          </h2>
        </Reveal>
        <Reveal delay={150}>
          <p className="text-muted-foreground text-center max-w-lg mx-auto mb-14">
            Every screen designed for mobile from day one. Not a desktop UI crammed into a small display.
          </p>
        </Reveal>

        {/* Large screenshot placeholders */}
        <div className="space-y-6">
          {screens.map((screen, i) => (
            <Reveal key={i} delay={200 + i * 100}>
              <div className={`group rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md overflow-hidden hover:border-primary/15 transition-all duration-300 ${i % 2 === 0 ? "" : "md:flex-row-reverse"} md:flex md:items-center`}>
                {/* Image placeholder */}
                <div className="relative md:w-[55%] aspect-[16/10] md:aspect-auto md:h-[320px] bg-gradient-to-br from-card via-surface-1 to-card overflow-hidden shrink-0">
                  <div className="absolute inset-0 flex items-center justify-center">
                    {/* Stylized phone in context */}
                    <div className="w-[140px] sm:w-[160px] rounded-[1.75rem] border border-surface-2 bg-background aspect-[9/19.5] shadow-[0_4px_40px_rgba(0,0,0,0.2)] overflow-hidden">
                      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-[48px] h-[14px] bg-background rounded-full z-10" />
                      <div className="w-full h-full pt-7 px-2 pb-2">
                        {i === 0 && <ChatDemo />}
                        {i === 1 && <FilesDemo />}
                        {i === 2 && <TerminalDemo />}
                      </div>
                    </div>
                  </div>
                  {/* Decorative grid dots */}
                  <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(rgba(168,162,158,0.15) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
                </div>
                {/* Text */}
                <div className="p-6 sm:p-8 md:p-10 md:flex-1">
                  <h3 className="text-xl sm:text-2xl font-bold tracking-[-0.02em] mb-3">{screen.title}</h3>
                  <p className="text-muted-foreground leading-relaxed max-w-md">{screen.desc}</p>
                  <div className="mt-4 flex items-center gap-1.5 text-sm text-primary/60">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Native iOS</span>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Screenshot placeholder note */}
        <Reveal delay={500}>
          <p className="text-center text-sm text-muted-foreground/40 mt-8">
            Real app screenshots coming soon — currently in TestFlight beta
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Comparison Table ────────────────────────────────────

function ComparisonTable() {
  const rows = [
    { feature: "Interface", broski: "Native mobile UI", ssh: "Raw terminal", wrappers: "Web view" },
    { feature: "Setup time", broski: "60 seconds", ssh: "15+ minutes", wrappers: "5+ minutes" },
    { feature: "Network switch", broski: "Seamless", ssh: "Disconnects", wrappers: "Often drops" },
    { feature: "Agent support", broski: "2 agents, native", ssh: "Generic", wrappers: "1-2 agents" },
    { feature: "File browsing", broski: "Built-in", ssh: "CLI only", wrappers: "Limited" },
    { feature: "Code diffs", broski: "Native viewer", ssh: "Terminal diff", wrappers: "Basic" },
    { feature: "Session management", broski: "Multi-session", ssh: "tmux required", wrappers: "Single" },
    { feature: "Works offline", broski: "Cached data", ssh: "No", wrappers: "No" },
  ];
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4 text-center">
            Broski vs <span className="font-serif italic text-primary">everything else.</span>
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="text-muted-foreground text-center max-w-lg mx-auto mb-12">
            Not all mobile coding experiences are created equal.
          </p>
        </Reveal>

        <Reveal delay={200}>
          <div className="rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-4 gap-0 border-b border-surface-2 text-sm font-semibold">
              <div className="p-4 text-muted-foreground/50" />
              <div className="p-4 text-primary border-x border-surface-2 bg-primary/[0.03]">Broski</div>
              <div className="p-4 text-muted-foreground/60">SSH + Tailscale</div>
              <div className="p-4 text-muted-foreground/60">Terminal wrappers</div>
            </div>
            {/* Rows */}
            {rows.map((row, i) => (
              <div key={i} className={`grid grid-cols-4 gap-0 text-[13px] ${i < rows.length - 1 ? "border-b border-surface-2" : ""}`}>
                <div className="p-3.5 sm:p-4 text-muted-foreground font-medium">{row.feature}</div>
                <div className="p-3.5 sm:p-4 text-foreground border-x border-surface-2 bg-primary/[0.02] font-medium">{row.broski}</div>
                <div className="p-3.5 sm:p-4 text-muted-foreground/60">{row.ssh}</div>
                <div className="p-3.5 sm:p-4 text-muted-foreground/60">{row.wrappers}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Testimonials ────────────────────────────────────────

function Testimonials() {
  const quotes = [
    {
      text: "Finally I can check on my Claude Code sessions from the couch without SSH nightmares. This is what mobile coding should feel like.",
      name: "Early beta tester",
      role: "iOS Developer",
    },
    {
      text: "The connection literally never drops. I walked from WiFi to cellular mid-session and it just kept going. Witchcraft.",
      name: "Early beta tester",
      role: "Full-stack Engineer",
    },
    {
      text: "I run 3 agents on different projects simultaneously. Being able to monitor all of them from one app while commuting is a game changer.",
      name: "Early beta tester",
      role: "Startup Founder",
    },
  ];
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <p className="text-[11px] tracking-[0.25em] uppercase text-muted-foreground/50 mb-5 font-medium text-center">Early reactions</p>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-14 text-center">
            People are <span className="font-serif italic text-primary">loving it.</span>
          </h2>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-4">
          {quotes.map((q, i) => (
            <Reveal key={i} delay={200 + i * 100}>
              <div className="group h-full p-6 rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md hover:border-primary/15 hover:-translate-y-1 transition-all duration-300 flex flex-col">
                <Quote className="w-5 h-5 text-primary/30 mb-4 shrink-0" />
                <p className="text-[14px] text-foreground/90 leading-relaxed flex-1 mb-5">
                  &ldquo;{q.text}&rdquo;
                </p>
                <div className="flex items-center gap-3 pt-4 border-t border-surface-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {q.name[0]}
                  </div>
                  <div>
                    <div className="text-[13px] font-medium">{q.name}</div>
                    <div className="text-[11px] text-muted-foreground/50">{q.role}</div>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Architecture Diagram ────────────────────────────────

function ArchitectureDiagram() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[11px] tracking-[0.25em] uppercase text-muted-foreground/50 mb-5 font-medium text-center">Architecture</p>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-6 text-center">
            How it <span className="font-serif italic text-primary">works.</span>
          </h2>
        </Reveal>
        <Reveal delay={150}>
          <p className="text-muted-foreground text-center max-w-lg mx-auto mb-14">
            Your phone talks to a lightweight bridge on your Mac. The bridge talks to your agents. Simple.
          </p>
        </Reveal>

        <Reveal delay={250}>
          <div className="relative p-6 sm:p-10 rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md">
            {/* The 3-part flow */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 md:gap-0">
              {/* Phone */}
              <div className="flex flex-col items-center gap-3 md:w-1/4">
                <div className="w-16 h-16 rounded-2xl bg-primary/[0.08] border border-primary/20 flex items-center justify-center">
                  <Smartphone className="w-7 h-7 text-primary" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold">Your iPhone</div>
                  <div className="text-[11px] text-muted-foreground/50">Broski app</div>
                </div>
              </div>

              {/* Arrow 1 */}
              <div className="flex flex-col md:flex-row items-center gap-1 md:flex-1">
                <div className="hidden md:block flex-1 h-px bg-gradient-to-r from-primary/30 to-primary/10" />
                <div className="md:hidden w-px h-8 bg-gradient-to-b from-primary/30 to-primary/10" />
                <div className="text-[10px] text-muted-foreground/40 px-2 whitespace-nowrap">WebSocket</div>
                <div className="hidden md:block flex-1 h-px bg-gradient-to-r from-primary/10 to-primary/30" />
                <div className="md:hidden w-px h-8 bg-gradient-to-b from-primary/10 to-primary/30" />
              </div>

              {/* Bridge */}
              <div className="flex flex-col items-center gap-3 md:w-1/4">
                <div className="w-16 h-16 rounded-2xl bg-surface-1 border border-surface-2 flex items-center justify-center">
                  <Monitor className="w-7 h-7 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold">Bridge</div>
                  <div className="text-[11px] text-muted-foreground/50">On your Mac</div>
                </div>
              </div>

              {/* Arrow 2 */}
              <div className="flex flex-col md:flex-row items-center gap-1 md:flex-1">
                <div className="hidden md:block flex-1 h-px bg-gradient-to-r from-surface-2 to-surface-2/50" />
                <div className="md:hidden w-px h-8 bg-gradient-to-b from-surface-2 to-surface-2/50" />
                <div className="text-[10px] text-muted-foreground/40 px-2 whitespace-nowrap">SDK</div>
                <div className="hidden md:block flex-1 h-px bg-gradient-to-r from-surface-2/50 to-surface-2" />
                <div className="md:hidden w-px h-8 bg-gradient-to-b from-surface-2/50 to-surface-2" />
              </div>

              {/* Agents */}
              <div className="flex flex-col items-center gap-3 md:w-1/4">
                <div className="w-16 h-16 rounded-2xl bg-surface-1 border border-surface-2 flex items-center justify-center">
                  <TerminalSquare className="w-7 h-7 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold">Your agents</div>
                  <div className="text-[11px] text-muted-foreground/50">Claude Code, etc.</div>
                </div>
              </div>
            </div>

            {/* Bottom labels */}
            <div className="mt-8 pt-6 border-t border-surface-2 grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-bold text-foreground">Local</div>
                <div className="text-[11px] text-muted-foreground/50">Same network or relay</div>
              </div>
              <div>
                <div className="text-lg font-bold text-foreground">Private</div>
                <div className="text-[11px] text-muted-foreground/50">No data leaves your machines</div>
              </div>
              <div>
                <div className="text-lg font-bold text-foreground">&lt;4ms</div>
                <div className="text-[11px] text-muted-foreground/50">Local network latency</div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      <Navbar />
      <Hero />
      <StatsBar />
      <Problem />
      <AgentsSection />
      <AppShowcase />
      <BentoFeatures />
      <ComparisonTable />
      <HowItWorks />
      <ArchitectureDiagram />
      <Security />
      <Testimonials />
      <Pricing />
      <FinalCTA />
      <Footer />
    </main>
  );
}
