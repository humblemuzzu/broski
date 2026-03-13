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
} from "lucide-react";

// ─── Validation & Effects ────────────────────────────────

const isValidEmail = (email: string): boolean =>
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);

const fireConfetti = () => {
  const end = Date.now() + 3000;
  const colors = ["#fab283", "#ffffff", "#56b6c2"];
  (function frame() {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
};

// ─── Hooks ───────────────────────────────────────────────

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, []);
  return scrolled;
}

function useWaitlistCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    fetch("/api/waitlist-count")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setCount(d.count);
      })
      .catch(() => {});
  }, []);
  return count;
}

// ─── Data ────────────────────────────────────────────────

const AGENTS = [
  { name: "OpenCode", logo: "/logos/opencode.svg" },
  { name: "Claude Code", logo: "/logos/cc-real.png" },
  { name: "Codex", logo: "/logos/codex-icon.png" },
  { name: "Pi", logo: null },
];

const FEATURES = [
  {
    icon: Layers,
    title: "Session Management",
    description:
      "Monitor all active sessions at a glance. Switch between agents instantly.",
  },
  {
    icon: MessageSquare,
    title: "Rich Chat UI",
    description:
      "Markdown rendering, syntax-highlighted code blocks, and inline diff views.",
  },
  {
    icon: FolderOpen,
    title: "File Browser",
    description:
      "Navigate and preview project files directly from your phone.",
  },
  {
    icon: TerminalSquare,
    title: "Built-in Terminal",
    description: "Full terminal access when you need to go deeper.",
  },
  {
    icon: Wifi,
    title: "Never Drops",
    description:
      "Survives WiFi to cellular, sleep, and background. Your session stays alive.",
  },
  {
    icon: Zap,
    title: "Real-time Sync",
    description:
      "RTT-adaptive batching delivers instant updates regardless of latency.",
  },
];

const COMPARISON_OLD = [
  "Shrunken desktop terminal",
  "Drops on network switch",
  "Same UI for every tool",
  "Raw terminal output",
];

const COMPARISON_NEW = [
  "Native mobile interface",
  "Survives WiFi to cellular",
  "Per-agent experience",
  "Rich UI components",
];

const STEPS = [
  {
    number: "01",
    title: "Install the bridge",
    description: "One command on your Mac. Takes 10 seconds.",
    code: "npx broski-bridge",
  },
  {
    number: "02",
    title: "Scan the QR code",
    description: "Open the app, point your camera. Paired instantly.",
    code: null,
  },
  {
    number: "03",
    title: "You're in",
    description:
      "Full access to all your coding sessions. From anywhere.",
    code: null,
  },
];

const SECURITY_POINTS = [
  {
    icon: Globe,
    title: "Direct Connection",
    description:
      "Your phone connects directly to your machine. No relay servers in between.",
  },
  {
    icon: Lock,
    title: "Encrypted Transport",
    description:
      "All traffic encrypted in transit. Your code is never readable on the wire.",
  },
  {
    icon: Shield,
    title: "No Cloud Relay",
    description:
      "Your data never touches our servers. Zero knowledge architecture.",
  },
];

// ─── Utility Components ──────────────────────────────────

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay) setTimeout(() => setVisible(true), delay);
          else setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function WaitlistForm({ id }: { id?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !isValidEmail(email)) {
      setStatus("error");
      setMessage("Please enter a valid email address");
      return;
    }
    setStatus("loading");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (data.success) {
        setStatus("success");
        setMessage("You're on the list!");
        setEmail("");
        fireConfetti();
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Something went wrong.");
    }
  };

  return (
    <div className="w-full max-w-md">
      <form
        id={id}
        onSubmit={handleSubmit}
        className="flex flex-col sm:flex-row gap-3"
      >
        <input
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "loading"}
          className="flex-1 h-12 px-4 rounded-lg bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-white/25 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/25 transition-all text-[15px]"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="h-12 px-6 rounded-lg bg-primary text-primary-foreground font-medium hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap text-[15px]"
        >
          {status === "loading" ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Joining...
            </span>
          ) : (
            <>
              Join Waitlist <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
      {message && (
        <p
          className={`text-sm mt-3 ${
            status === "success" ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

function PhoneMockup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-[180px] sm:w-[200px] md:w-[220px]">
        <div className="relative rounded-[2.5rem] border-[2px] border-white/[0.08] bg-black overflow-hidden aspect-[9/19.5] shadow-[0_0_60px_rgba(250,178,131,0.03)]">
          {/* Dynamic Island */}
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[72px] h-[22px] bg-black rounded-full z-10 border border-white/[0.05]" />
          {/* Screen */}
          <div className="w-full h-full pt-12 pb-4 px-3">{children}</div>
        </div>
      </div>
      <span className="text-sm text-muted-foreground font-medium">
        {label}
      </span>
    </div>
  );
}

// ─── Sections ────────────────────────────────────────────

function Navbar() {
  const scrolled = useScrolled();

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-background/80 backdrop-blur-xl border-b border-white/[0.06]"
          : ""
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Image
          src="/broski-logo.png"
          alt="Broski"
          width={100}
          height={32}
          className="opacity-90 hover:opacity-100 transition-opacity"
          priority
        />
        <div className="flex items-center gap-6">
          <a
            href="/docs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
          >
            Docs
          </a>
          <button
            onClick={() =>
              document
                .getElementById("waitlist-hero")
                ?.scrollIntoView({ behavior: "smooth" })
            }
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 active:scale-[0.98] transition-all"
          >
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
    <section className="relative min-h-screen flex items-center justify-center pt-16 pb-20 px-6 overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(250,178,131,0.06),transparent)]" />
      {/* Dot grid */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:32px_32px]" />

      <div className="relative max-w-3xl mx-auto text-center">
        <Reveal>
          <p className="text-xs sm:text-sm tracking-[0.2em] uppercase text-muted-foreground mb-8">
            The mobile companion for AI coding agents
          </p>
        </Reveal>

        <Reveal delay={100}>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-4">
            Your agents are running.
          </h1>
        </Reveal>

        <Reveal delay={200}>
          <p className="font-serif text-3xl sm:text-4xl md:text-6xl italic text-primary/90 mb-8">
            Take them with you.
          </p>
        </Reveal>

        <Reveal delay={300}>
          <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
            The native iOS app for Claude Code, OpenCode, Codex, and Pi.
            <br className="hidden sm:block" />
            Not a terminal wrapper — a real interface for your coding agents.
          </p>
        </Reveal>

        <Reveal delay={400} className="flex justify-center">
          <WaitlistForm id="waitlist-hero" />
        </Reveal>

        {count > 0 && (
          <Reveal delay={500}>
            <div className="flex items-center justify-center gap-2 mt-8 text-sm text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                {count.toLocaleString()}+ developers on the waitlist
              </span>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6">
            The problem
          </p>
        </Reveal>

        <Reveal delay={100}>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.15] mb-6">
            Not another
            <br />
            <span className="font-serif italic text-primary/90">
              terminal app.
            </span>
          </h2>
        </Reveal>

        <Reveal delay={200}>
          <p className="text-lg text-muted-foreground max-w-2xl mb-16 leading-relaxed">
            SSH wrappers shrink your desktop into a phone screen. Connections
            drop when you switch networks. You&apos;re fighting the tool
            instead of shipping code.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-2 gap-4 md:gap-6">
          <Reveal delay={300}>
            <div className="p-6 sm:p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] h-full">
              <p className="text-xs tracking-[0.15em] uppercase text-muted-foreground/60 mb-6">
                The old way
              </p>
              <ul className="space-y-4">
                {COMPARISON_OLD.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 text-muted-foreground"
                  >
                    <X className="w-4 h-4 mt-0.5 shrink-0 text-red-400/60" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={400}>
            <div className="p-6 sm:p-8 rounded-2xl bg-primary/[0.04] border border-primary/[0.12] h-full">
              <p className="text-xs tracking-[0.15em] uppercase text-primary/70 mb-6">
                With Broski
              </p>
              <ul className="space-y-4">
                {COMPARISON_NEW.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 text-foreground"
                  >
                    <Check className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Showcase() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.15] mb-4">
            See everything.
            <br />
            <span className="font-serif italic text-primary/90">
              Control everything.
            </span>
          </h2>
        </Reveal>

        <Reveal delay={100}>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-16">
            25 screens of native UI designed for mobile. Not a web view —
            real Flutter, built for your thumbs.
          </p>
        </Reveal>

        <Reveal delay={200}>
          <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-8 sm:gap-10 md:gap-16">
            {/* Sessions mockup */}
            <PhoneMockup label="Sessions">
              <div className="space-y-2.5 mt-2">
                <div className="h-3 w-20 rounded bg-white/10" />
                <div className="space-y-2">
                  {[0.8, 0.6, 0.4].map((opacity, i) => (
                    <div
                      key={i}
                      className="rounded-xl p-3 bg-white/[0.04] border border-white/[0.06]"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: `rgba(250,178,131,${opacity})`,
                          }}
                        />
                        <div
                          className="h-2 rounded bg-white/15"
                          style={{ width: `${60 - i * 10}%` }}
                        />
                      </div>
                      <div className="h-1.5 w-3/4 rounded bg-white/[0.06]" />
                    </div>
                  ))}
                </div>
              </div>
            </PhoneMockup>

            {/* Chat mockup */}
            <PhoneMockup label="Chat">
              <div className="space-y-3 mt-2">
                <div className="h-3 w-16 rounded bg-white/10 mx-auto" />
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <div className="rounded-2xl rounded-tr-sm px-3 py-2 bg-primary/20 max-w-[75%]">
                      <div className="h-1.5 w-20 rounded bg-primary/30" />
                      <div className="h-1.5 w-14 rounded bg-primary/20 mt-1" />
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-tl-sm px-3 py-2 bg-white/[0.06] max-w-[80%]">
                      <div className="h-1.5 w-24 rounded bg-white/10" />
                      <div className="h-1.5 w-20 rounded bg-white/[0.06] mt-1" />
                      <div className="h-1.5 w-16 rounded bg-white/[0.06] mt-1" />
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2">
                    <div className="h-1.5 w-16 rounded bg-emerald-400/20" />
                    <div className="h-1.5 w-24 rounded bg-blue-400/15 mt-1" />
                    <div className="h-1.5 w-20 rounded bg-white/[0.06] mt-1" />
                  </div>
                </div>
              </div>
            </PhoneMockup>

            {/* Terminal mockup */}
            <PhoneMockup label="Terminal">
              <div className="space-y-1.5 mt-2">
                <div className="h-3 w-16 rounded bg-white/10" />
                <div className="space-y-1">
                  {[
                    { w: "85%", c: "emerald" },
                    { w: "70%", c: "white" },
                    { w: "90%", c: "white" },
                    { w: "60%", c: "amber" },
                    { w: "75%", c: "white" },
                    { w: "80%", c: "emerald" },
                    { w: "50%", c: "white" },
                  ].map(({ w, c }, i) => (
                    <div
                      key={i}
                      className="h-1.5 rounded"
                      style={{
                        width: w,
                        backgroundColor:
                          c === "emerald"
                            ? "rgba(52,211,153,0.15)"
                            : c === "amber"
                              ? "rgba(251,191,36,0.12)"
                              : "rgba(255,255,255,0.06)",
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <div className="h-1.5 w-8 rounded bg-emerald-400/25" />
                  <div className="w-1.5 h-3 bg-emerald-400/60 animate-pulse" />
                </div>
              </div>
            </PhoneMockup>
          </div>
        </Reveal>

        <Reveal delay={400}>
          <p className="text-sm text-muted-foreground/60 mt-12">
            Screenshots from the actual app coming soon
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function AgentsSection() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6 border-t border-white/[0.04]">
      <div className="max-w-4xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.15] mb-4">
            <span className="font-serif italic text-primary/90">
              One app.
            </span>{" "}
            Every agent.
          </h2>
        </Reveal>

        <Reveal delay={100}>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-16">
            Works with any terminal-based AI coding agent. Connect to the
            ones you already use.
          </p>
        </Reveal>

        <Reveal delay={200}>
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
            {AGENTS.map((agent) => (
              <div
                key={agent.name}
                className="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
              >
                {agent.logo ? (
                  <Image
                    src={agent.logo}
                    alt={agent.name}
                    width={24}
                    height={24}
                    className="rounded"
                  />
                ) : (
                  <TerminalSquare className="w-5 h-5 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">{agent.name}</span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={300}>
          <p className="text-sm text-muted-foreground/60 mt-8">
            More agents added with every update
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.15] mb-4 text-center">
            Everything you need.
          </h2>
        </Reveal>

        <Reveal delay={100}>
          <p className="text-lg text-muted-foreground text-center max-w-xl mx-auto mb-16">
            25 screens of purpose-built features. Not a proof of concept — a
            real product.
          </p>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delay={200 + i * 80}>
              <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.10] transition-colors h-full">
                <feature.icon className="w-5 h-5 text-primary/80 mb-4" />
                <h3 className="text-[15px] font-semibold mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
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
    <section className="py-24 md:py-32 lg:py-40 px-6 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 text-center">
            Setup
          </p>
        </Reveal>

        <Reveal delay={100}>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-center mb-16">
            Running in{" "}
            <span className="font-serif italic text-primary/90">
              60 seconds.
            </span>
          </h2>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-8 md:gap-10">
          {STEPS.map((step, i) => (
            <Reveal key={step.number} delay={200 + i * 120}>
              <div className="text-center md:text-left">
                <span className="text-xs tracking-[0.15em] text-primary/60 font-mono">
                  {step.number}
                </span>
                <h3 className="text-xl font-semibold mt-2 mb-3">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {step.description}
                </p>
                {step.code && (
                  <div className="inline-flex items-center px-4 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] font-mono text-sm text-foreground/80">
                    <span className="text-primary/60 mr-2">$</span>
                    {step.code}
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Security() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.15] mb-6">
            Your code
            <br />
            <span className="font-serif italic text-primary/90">
              never leaves your network.
            </span>
          </h2>
        </Reveal>

        <Reveal delay={100}>
          <p className="text-lg text-muted-foreground max-w-2xl mb-16 leading-relaxed">
            Broski connects your phone directly to your machine. No
            third-party servers, no cloud middleman. Your code stays between
            your devices.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-4 md:gap-6">
          {SECURITY_POINTS.map((point, i) => (
            <Reveal key={point.title} delay={200 + i * 100}>
              <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] h-full">
                <point.icon className="w-5 h-5 text-primary/80 mb-4" />
                <h3 className="text-[15px] font-semibold mb-2">
                  {point.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {point.description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section className="py-24 md:py-32 lg:py-40 px-6 border-t border-white/[0.04]">
      <div className="max-w-2xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-12">
            <span className="font-serif italic text-primary/90">Simple</span>{" "}
            pricing.
          </h2>
        </Reveal>

        <Reveal delay={100}>
          <div className="p-8 sm:p-10 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
            <div className="mb-6">
              <span className="text-5xl sm:text-6xl font-bold tracking-tight">
                $9.99
              </span>
              <span className="text-xl text-muted-foreground ml-1">
                /month
              </span>
            </div>
            <p className="text-muted-foreground mb-2">
              7-day free trial. Cancel anytime.
            </p>
            <p className="text-muted-foreground/60 text-sm">
              No tiers. No limits. Full access to everything.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FinalCTA() {
  const count = useWaitlistCount();

  return (
    <section className="py-24 md:py-32 lg:py-40 px-6 border-t border-white/[0.04]">
      <div className="max-w-3xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.15] mb-6">
            Stop doom scrolling.
            <br />
            <span className="font-serif italic text-primary/90">
              Start shipping.
            </span>
          </h2>
        </Reveal>

        <Reveal delay={100}>
          <p className="text-lg text-muted-foreground mb-10">
            Launching soon. Be the first to know.
          </p>
        </Reveal>

        <Reveal delay={200} className="flex justify-center">
          <WaitlistForm />
        </Reveal>

        {count > 0 && (
          <Reveal delay={300}>
            <div className="flex items-center justify-center gap-2 mt-8 text-sm text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                {count.toLocaleString()}+ developers on the waitlist
              </span>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-8 px-6 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image
            src="/broski-logo.png"
            alt="Broski"
            width={80}
            height={24}
            className="opacity-50"
          />
          <span className="text-xs text-muted-foreground/40">
            &copy; {new Date().getFullYear()}
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground/60">
          <a
            href="/docs"
            className="hover:text-foreground transition-colors"
          >
            Docs
          </a>
          <a
            href="/legal/privacy"
            className="hover:text-foreground transition-colors"
          >
            Privacy
          </a>
          <a
            href="/legal/terms"
            className="hover:text-foreground transition-colors"
          >
            Terms
          </a>
          <a
            href="mailto:broskiappp@gmail.com"
            className="hover:text-foreground transition-colors"
          >
            Support
          </a>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />
      <Hero />
      <Problem />
      <Showcase />
      <AgentsSection />
      <Features />
      <HowItWorks />
      <Security />
      <Pricing />
      <FinalCTA />
      <Footer />
    </main>
  );
}
