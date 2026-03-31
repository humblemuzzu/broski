"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Terminal,
  Cpu,
  Mic,
  Server,
  Layers,
  Globe,
  Gamepad2,
  Sparkles,
  Hash,
  DollarSign,
  Brain,
  Wrench,
  Lock,
  GitBranch,
  Zap,
  BookOpen,
  Crown,
  Star,
  Gem,
  Flame,
  Shield,
  Command,
  Variable,
  X,
  Sun,
  Moon,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────

const isValidEmail = (e: string) =>
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(e);

const fireConfetti = () => {
  const end = Date.now() + 3000;
  const colors = ["#e8c4a0", "#fafaf9", "#a8a29e"];
  (function f() {
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

function useWaitlistCount() {
  const [c, setC] = useState(0);
  useEffect(() => {
    fetch("/api/waitlist-count")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setC(d.count);
      })
      .catch(() => {});
  }, []);
  return c;
}

function useActiveSection() {
  const [active, setActive] = useState("");
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { threshold: 0.15, rootMargin: "-80px 0px -40% 0px" }
    );
    const sections = document.querySelectorAll("section[id]");
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);
  return active;
}

// ─── Shared Components ───────────────────────────────────

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
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          delay ? setTimeout(() => setV(true), delay) : setV(true);
          obs.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -30px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${v ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"} ${className}`}
    >
      {children}
    </div>
  );
}

function AnimatedNumber({
  target,
  suffix = "",
}: {
  target: number;
  suffix?: string;
}) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
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
      },
      { threshold: 0.5 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);
  return (
    <span ref={ref} className="tabular-nums">
      {val.toLocaleString()}
      {suffix}
    </span>
  );
}

function WaitlistForm({ id }: { id?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [msg, setMsg] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !isValidEmail(email)) {
      setStatus("error");
      setMsg("Please enter a valid email");
      return;
    }
    setStatus("loading");
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (d.success) {
        setStatus("success");
        setMsg("You're on the list!");
        setEmail("");
        fireConfetti();
      } else {
        setStatus("error");
        setMsg(d.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMsg("Something went wrong.");
    }
  };
  return (
    <div className="w-full max-w-md">
      <form
        id={id}
        onSubmit={submit}
        className="flex flex-col sm:flex-row gap-3"
      >
        <input
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "loading"}
          className="flex-1 h-12 px-4 rounded-xl bg-surface-1 border border-surface-2 text-foreground placeholder:text-stone-500 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all text-[15px]"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-semibold hover:brightness-110 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap text-[15px]"
        >
          {status === "loading" ? (
            "Joining..."
          ) : (
            <>
              <span>Join Waitlist</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
      {msg && (
        <p
          className={`text-sm mt-3 ${status === "success" ? "text-emerald-500" : "text-red-400"}`}
        >
          {msg}
        </p>
      )}
    </div>
  );
}

// ─── Animated Terminal ───────────────────────────────────

const CODE_SNIPPETS = [
  {
    label: "KAIROS — Background Agent",
    lines: [
      { text: "// src/commands/assistant.ts", style: "comment" },
      { text: 'export const KAIROS = "kairos"', style: "code" },
      { text: "// persistent daemon, survives terminal close", style: "comment" },
      { text: "// push notifications, GitHub webhooks", style: "comment" },
      { text: 'featureFlag: "KAIROS"', style: "highlight" },
    ],
  },
  {
    label: "Buddy — Virtual Pet System",
    lines: [
      { text: "// src/buddy/species.ts", style: "comment" },
      { text: "const SPECIES = [", style: "code" },
      { text: '  "duck","goose","blob","cat","dragon",', style: "code" },
      { text: '  "octopus","owl","penguin","capybara"...', style: "code" },
      { text: "// 18 species, hex-encoded to avoid build checks", style: "highlight" },
    ],
  },
  {
    label: "Undercover Mode",
    lines: [
      { text: "// src/permissions/undercover.ts", style: "comment" },
      { text: "if (isAnthropicEmployee && isPublicRepo) {", style: "code" },
      { text: '  mode = "UNDERCOVER"', style: "highlight" },
      { text: "  stripCoAuthoredBy(commit)", style: "code" },
      { text: "  // can force ON but NEVER force OFF", style: "comment" },
    ],
  },
  {
    label: "Voice Mode — Push to Talk",
    lines: [
      { text: "// src/voice/stream.ts", style: "comment" },
      { text: "const STT_PROVIDER = Deepgram.Nova3", style: "code" },
      { text: "// Hold Space to talk", style: "comment" },
      { text: 'ws.connect("voice_stream")', style: "code" },
      { text: 'featureFlag: "VOICE_MODE"', style: "highlight" },
    ],
  },
  {
    label: "Ultraplan — 30min Opus Planning",
    lines: [
      { text: "// src/commands/ultraplan.ts", style: "comment" },
      { text: "// Sends task to remote Claude Code instance", style: "comment" },
      { text: "// Running Opus for up to 30 minutes", style: "comment" },
      { text: "const ULTRAPLAN_TIMEOUT = 30 * 60 * 1000", style: "code" },
      { text: 'featureFlag: "ULTRAPLAN"', style: "highlight" },
    ],
  },
];

function AnimatedTerminal() {
  const [idx, setIdx] = useState(0);
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    setVisibleLines(0);
    const snippet = CODE_SNIPPETS[idx];
    let line = 0;
    const iv = setInterval(() => {
      line++;
      setVisibleLines(line);
      if (line >= snippet.lines.length) {
        clearInterval(iv);
        setTimeout(() => setIdx((i) => (i + 1) % CODE_SNIPPETS.length), 2500);
      }
    }, 180);
    return () => clearInterval(iv);
  }, [idx]);

  const snippet = CODE_SNIPPETS[idx];

  return (
    <div className="rounded-2xl border border-surface-2 bg-stone-950 dark:bg-stone-950 overflow-hidden shadow-[0_8px_60px_rgba(0,0,0,0.4)]">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-2 bg-surface-1/50">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
        </div>
        <span className="text-[10px] text-muted-foreground font-mono ml-2">
          {snippet.label}
        </span>
      </div>
      {/* Code */}
      <div className="p-4 sm:p-5 font-mono text-[12px] sm:text-[13px] leading-relaxed min-h-[160px]">
        {snippet.lines.map((line, i) => (
          <div
            key={`${idx}-${i}`}
            className={`transition-all duration-300 ${i < visibleLines ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"}`}
          >
            {line.style === "comment" && (
              <span className="text-stone-400">{line.text}</span>
            )}
            {line.style === "code" && (
              <span className="text-stone-300">{line.text}</span>
            )}
            {line.style === "highlight" && (
              <span className="text-primary">{line.text}</span>
            )}
          </div>
        ))}
        <div className="mt-1 flex items-center">
          <span className="text-stone-400">❯ </span>
          <span className="inline-block w-[2px] h-[14px] bg-primary/70 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// ─── Spinner Verbs ───────────────────────────────────────

const SPINNER_VERBS = [
  "Boondoggling",
  "Canoodling",
  "Flibbertigibbeting",
  "Discombobulating",
  "Shenaniganing",
  "Lollygagging",
  "Bamboozling",
  "Snorkeling",
  "Gallivanting",
  "Wibble-wobbling",
  "Perambulating",
  "Razzle-dazzling",
  "Cattywampusing",
  "Skedaddling",
  "Hornswoggling",
  "Rigamaroling",
  "Ballyhoo-ing",
  "Whatchamacalliting",
  "Gobsmacking",
  "Lickety-splitting",
  "Topsy-turvying",
  "Kerfuffling",
  "Codswalloping",
  "Higgledy-piggling",
  "Fiddle-faddling",
  "Willy-nillying",
  "Argle-bargling",
  "Namby-pambying",
  "Flim-flamming",
  "Pitter-pattering",
  "Riff-raffing",
  "Hobnobbing",
  "Mish-mashing",
  "Helter-skeltering",
  "Wishy-washying",
  "Dilly-dallying",
  "Shilly-shallying",
  "Pell-melling",
  "Roly-polying",
  "Hurly-burlying",
  "Humdrum-drumming",
  "Hubbub-bubbling",
  "Jiggery-pokerying",
  "Mumbo-jumboing",
  "Hokey-pokeying",
  "Hanky-pankying",
  "Hocus-pocusing",
  "Itsy-bitsying",
  "Toing-and-froing",
  "Zig-zagging",
];

function SpinnerVerbs() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const iv = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % SPINNER_VERBS.length);
        setVisible(true);
      }, 200);
    }, 1200);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex items-center gap-3 font-mono">
      <div className="relative w-5 h-5">
        <div
          className="absolute inset-0 border-2 border-primary/30 border-t-primary rounded-full"
          style={{ animation: "spin 0.8s linear infinite" }}
        />
      </div>
      <span
        className={`text-xl sm:text-2xl text-primary transition-all duration-200 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}
      >
        {SPINNER_VERBS[idx]}
      </span>
      <span className="text-muted-foreground">...</span>
    </div>
  );
}

// ─── Buddy Generator ─────────────────────────────────────

const BUDDY_SPECIES = [
  "duck",
  "goose",
  "blob",
  "cat",
  "dragon",
  "octopus",
  "owl",
  "penguin",
  "turtle",
  "snail",
  "ghost",
  "axolotl",
  "capybara",
  "cactus",
  "robot",
  "rabbit",
  "mushroom",
  "chonk",
];

const BUDDY_EYES = ["·", "✦", "×", "◉", "@", "°"];
const BUDDY_HATS = [
  "none",
  "crown",
  "tophat",
  "propeller",
  "halo",
  "wizard",
  "beanie",
  "tinyduck",
];

// ── CC-authentic sprite data (from Claude Code src/buddy/) ───────────
// Each species: 3 frames, 5 lines, 12 chars wide. {E} = eye placeholder.
const CC_BODIES: Record<string, string[][]> = {
  duck:     [['            ','    __      ','  <({E} )___  ','   (  ._>   ','    `--´    '],['            ','    __      ','  <({E} )___  ','   (  ._>   ','    `--´~   '],['            ','    __      ','  <({E} )___  ','   (  .__>  ','    `--´    ']],
  goose:    [['            ','     ({E}>    ','     ||     ','   _(__)_   ','    ^^^^    '],['            ','    ({E}>     ','     ||     ','   _(__)_   ','    ^^^^    '],['            ','     ({E}>>   ','     ||     ','   _(__)_   ','    ^^^^    ']],
  blob:     [['            ','   .----.   ','  ( {E}  {E} )  ','  (      )  ','   `----´   '],['            ','  .------.  ',' (  {E}  {E}  ) ',' (        ) ','  `------´  '],['            ','    .--.    ','   ({E}  {E})   ','   (    )   ','    `--´    ']],
  cat:      [['            ','   /\\_/\\    ','  ( {E}   {E})  ','  (  ω  )   ','  (")_(")   '],['            ','   /\\_/\\    ','  ( {E}   {E})  ','  (  ω  )   ','  (")_(")~  '],['            ','   /\\-/\\    ','  ( {E}   {E})  ','  (  ω  )   ','  (")_(")   ']],
  dragon:   [['            ','  /^\\  /^\\  ',' <  {E}  {E}  > ',' (   ~~   ) ','  `-vvvv-´  '],['            ','  /^\\  /^\\  ',' <  {E}  {E}  > ',' (        ) ','  `-vvvv-´  '],['   ~    ~   ','  /^\\  /^\\  ',' <  {E}  {E}  > ',' (   ~~   ) ','  `-vvvv-´  ']],
  octopus:  [['            ','   .----.   ','  ( {E}  {E} )  ','  (______)  ','  /\\/\\/\\/\\  '],['            ','   .----.   ','  ( {E}  {E} )  ','  (______)  ','  \\/\\/\\/\\/  '],['     o      ','   .----.   ','  ( {E}  {E} )  ','  (______)  ','  /\\/\\/\\/\\  ']],
  owl:      [['            ','   /\\  /\\   ','  (({E})({E}))  ','  (  ><  )  ','   `----´   '],['            ','   /\\  /\\   ','  (({E})({E}))  ','  (  ><  )  ','   .----.   '],['            ','   /\\  /\\   ','  (({E})(-))  ','  (  ><  )  ','   `----´   ']],
  penguin:  [['            ','  .---.     ','  ({E}>{E})     ',' /(   )\\    ','  `---´     '],['            ','  .---.     ','  ({E}>{E})     ',' |(   )|    ','  `---´     '],['  .---.     ','  ({E}>{E})     ',' /(   )\\    ','  `---´     ','   ~ ~      ']],
  turtle:   [['            ','   _,--._   ','  ( {E}  {E} )  ',' /[______]\\ ','  ``    ``  '],['            ','   _,--._   ','  ( {E}  {E} )  ',' /[______]\\ ','   ``  ``   '],['            ','   _,--._   ','  ( {E}  {E} )  ',' /[======]\\ ','  ``    ``  ']],
  snail:    [['            ',' {E}    .--.  ','  \\  ( @ )  ','   \\_`--´   ','  ~~~~~~~   '],['            ','  {E}   .--.  ','  |  ( @ )  ','   \\_`--´   ','  ~~~~~~~   '],['            ',' {E}    .--.  ','  \\  ( @  ) ','   \\_`--´   ','   ~~~~~~   ']],
  ghost:    [['            ','   .----.   ','  / {E}  {E} \\  ','  |      |  ','  ~`~``~`~  '],['            ','   .----.   ','  / {E}  {E} \\  ','  |      |  ','  `~`~~`~`  '],['    ~  ~    ','   .----.   ','  / {E}  {E} \\  ','  |      |  ','  ~~`~~`~~  ']],
  axolotl:  [['            ','}~(______)~{','}~({E} .. {E})~{','  ( .--. )  ','  (_/  \\_)  '],['            ','~}(______){~','~}({E} .. {E}){~','  ( .--. )  ','  (_/  \\_)  '],['            ','}~(______)~{','}~({E} .. {E})~{','  (  --  )  ','  ~_/  \\_~  ']],
  capybara: [['            ','  n______n  ',' ( {E}    {E} ) ',' (   oo   ) ','  `------´  '],['            ','  n______n  ',' ( {E}    {E} ) ',' (   Oo   ) ','  `------´  '],['    ~  ~    ','  u______n  ',' ( {E}    {E} ) ',' (   oo   ) ','  `------´  ']],
  cactus:   [['            ',' n  ____  n ',' | |{E}  {E}| | ',' |_|    |_| ','   |    |   '],['            ','    ____    ',' n |{E}  {E}| n ',' |_|    |_| ','   |    |   '],['            ',' n  ____  n ',' | |{E}  {E}| | ',' |_|    |_| ','   |    |   ']],
  robot:    [['            ','   .[||].   ','  [ {E}  {E} ]  ','  [ ==== ]  ','  `------´  '],['            ','   .[||].   ','  [ {E}  {E} ]  ','  [ -==- ]  ','  `------´  '],['     *      ','   .[||].   ','  [ {E}  {E} ]  ','  [ ==== ]  ','  `------´  ']],
  rabbit:   [['            ','   (\\__/)   ','  ( {E}  {E} )  ',' =(  ..  )= ','  (")__(")  '],['            ','   (|__/)   ','  ( {E}  {E} )  ',' =(  ..  )= ','  (")__(")  '],['            ','   (\\__/)   ','  ( {E}  {E} )  ',' =( .  . )= ','  (")__(")  ']],
  mushroom: [['            ',' .-o-OO-o-. ','(__________)','   |{E}  {E}|   ','   |____|   '],['            ',' .-O-oo-O-. ','(__________)','   |{E}  {E}|   ','   |____|   '],['   . o  .   ',' .-o-OO-o-. ','(__________)','   |{E}  {E}|   ','   |____|   ']],
  chonk:    [['            ','  /\\    /\\  ',' ( {E}    {E} ) ',' (   ..   ) ','  `------´  '],['            ','  /\\    /|  ',' ( {E}    {E} ) ',' (   ..   ) ','  `------´  '],['            ','  /\\    /\\  ',' ( {E}    {E} ) ',' (   ..   ) ','  `------´~ ']],
};
const CC_HAT_LINES: Record<string, string> = {
  none: '',       crown: '   \\^^^/    ', tophat: '   [___]    ',
  propeller: '    -+-     ', halo: '   (   )    ', wizard: '    /^\\     ',
  beanie: '   (___)    ', tinyduck: '    ,>      ',
};
// CC's idle animation: mostly frame 0, occasional fidget, -1 = blink
const IDLE_SEQ = [0,0,0,0,1,0,0,0,-1,0,0,2,0,0,0];
// CC's exact mulberry32 PRNG
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function ccHash(s: string): number {
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0;
}
const CC_SALT = 'friend-2026-401';
const CC_RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };
const CC_RARITY_FLOOR: Record<string, number> = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 };
function ccRoll(userId: string) {
  const rng = mulberry32(ccHash(userId + CC_SALT));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  // rarity
  const total = Object.values(CC_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * total; let rarity = 'common';
  for (const r of RARITIES) { roll -= CC_RARITY_WEIGHTS[r as keyof typeof CC_RARITY_WEIGHTS]; if (roll < 0) { rarity = r; break; } }
  const species = pick(BUDDY_SPECIES);
  const eye = pick(BUDDY_EYES);
  const hat = rarity === 'common' ? 'none' : pick(BUDDY_HATS);
  const shiny = rng() < 0.01;
  // stats (1-100, peak/dump)
  const floor = CC_RARITY_FLOOR[rarity] ?? 5;
  const STATS = ['DEBUGGING','PATIENCE','CHAOS','WISDOM','SNARK'] as const;
  const peak = pick(STATS); let dump = pick(STATS); while (dump === peak) dump = pick(STATS);
  const stats: Record<string, number> = {};
  for (const name of STATS) {
    if (name === peak) stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    else if (name === dump) stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    else stats[name] = floor + Math.floor(rng() * 40);
  }
  return { species, eye, hat, rarity, shiny, stats };
}
const RARITIES = ['common','uncommon','rare','epic','legendary'] as const;
const RARITY_CSS: Record<string, { color: string; glow: string; border: string }> = {
  common:    { color: 'text-stone-400',   glow: '', border: 'border-stone-700' },
  uncommon:  { color: 'text-emerald-400', glow: '', border: 'border-emerald-800' },
  rare:      { color: 'text-blue-400',    glow: 'shadow-[0_0_20px_rgba(96,165,250,0.2)]', border: 'border-blue-700' },
  epic:      { color: 'text-purple-400',  glow: 'shadow-[0_0_25px_rgba(168,85,247,0.25)]', border: 'border-purple-700' },
  legendary: { color: 'text-amber-400',   glow: 'shadow-[0_0_35px_rgba(251,191,36,0.3)]', border: 'border-amber-600' },
};
const RARITY_STARS: Record<string, string> = { common: '★', uncommon: '★★', rare: '★★★', epic: '★★★★', legendary: '★★★★★' };

// Species body colors for color mode
const SPECIES_COLORS: Record<string, string> = {
  duck: '#F5D63D', goose: '#E8E4DA', blob: '#A8E6CF', cat: '#F5A623',
  dragon: '#6BCB77', octopus: '#C084FC', owl: '#C4944C', penguin: '#778899',
  turtle: '#5B9A5B', snail: '#FFB6C1', ghost: '#D4D0E0', axolotl: '#FF8FAB',
  capybara: '#B8860B', cactus: '#6BCB77', robot: '#8BA8BD', rabbit: '#E8E0D8',
  mushroom: '#E05555', chonk: '#F5A623',
};
const HAT_COLORS: Record<string, string> = {
  crown: '#FFD93D', tophat: '#555', propeller: '#60A5FA',
  halo: '#FFD93D', wizard: '#7C3AED', beanie: '#FF6B6B', tinyduck: '#F5D63D',
};
const EYE_COLOR = '#fff';

function renderCCSprite(species: string, eye: string, hat: string, frame: number, blink: boolean): string[] {
  const frames = CC_BODIES[species] ?? CC_BODIES.blob!;
  const body = frames[frame % frames.length]!.map(l => l.replaceAll('{E}', blink ? '-' : eye));
  if (hat !== 'none' && !body[0]!.trim()) body[0] = CC_HAT_LINES[hat] ?? body[0]!;
  if (!body[0]!.trim() && frames.every(f => !f[0]!.trim())) body.shift();
  return body;
}

const RARITY_TIERS = [
  { name: "Common", chance: "60%", color: "text-stone-500", bg: "bg-stone-400/10", border: "border-stone-400/20" },
  { name: "Uncommon", chance: "25%", color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20" },
  { name: "Rare", chance: "10%", color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20" },
  { name: "Epic", chance: "4%", color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/20" },
  { name: "Legendary", chance: "1%", color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
];

const RARITY_ICONS = [Star, Star, Gem, Flame, Crown];

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function BuddyGenerator() {
  const [input, setInput] = useState("");
  const [buddy, setBuddy] = useState<{
    species: string;
    eyes: string;
    hat: string;
    rarity: string;
    shiny: boolean;
    stats: Record<string, number>;
  } | null>(null);
  const [tick, setTick] = useState(0);
  const [petCount, setPetCount] = useState(0);
  const [showHeart, setShowHeart] = useState(false);
  const [petting, setPetting] = useState(false);
  const [colorMode, setColorMode] = useState(false);

  const generate = useCallback(() => {
    if (!input.trim()) return;
    const rolled = ccRoll(input.trim());
    setBuddy({ ...rolled, eyes: rolled.eye });
    setPetCount(0);
  }, [input]);

  const doPet = () => {
    setShowHeart(true);
    setPetting(true);
    setPetCount((c) => c + 1);
    setTimeout(() => setShowHeart(false), 800);
    setTimeout(() => setPetting(false), 2500);
  };

  // 500ms tick — exactly like CC
  useEffect(() => {
    if (!buddy) return;
    const timer = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(timer);
  }, [buddy]);

  return (
    <div className="rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md p-6">
      {/* Input */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Enter any username or ID..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          className="flex-1 h-11 px-4 rounded-xl bg-background border border-surface-2 text-foreground placeholder:text-stone-400 focus:outline-none focus:border-primary/40 transition-all text-sm font-mono"
        />
        <button
          onClick={generate}
          className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 active:scale-[0.97] transition-all"
        >
          Generate Buddy
        </button>
      </div>

      {buddy && (() => {
        const rc = RARITY_CSS[buddy.rarity] ?? RARITY_CSS.common!;
        // CC idle sequence: frame 0 mostly, fidget 1/2, -1 = blink
        const step = petting ? (tick % 3) : IDLE_SEQ[tick % IDLE_SEQ.length]!;
        const blink = step === -1;
        const frame = blink ? 0 : step;
        const spriteLines = renderCCSprite(buddy.species, buddy.eyes, buddy.hat, frame, blink);
        // Heart burst (CC style)
        const H = '♥';
        const heartFrames = [`   ${H}    ${H}   `, `  ${H}  ${H}   ${H}  `, ` ${H}   ${H}  ${H}   `];
        const heartLine = petting ? heartFrames[tick % heartFrames.length] : null;

        return (
          <div className={`rounded-xl overflow-hidden border ${rc.border} ${rc.glow} transition-all duration-700 animate-in fade-in duration-500`}>
            {/* Terminal chrome */}
            <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#161b22] border-b border-white/5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-[11px] text-stone-500 font-mono">/buddy generate {input}</span>
            </div>

            <div className="flex flex-col md:flex-row bg-[#0d1117]">
              {/* Creature panel */}
              <div className="flex-1 flex flex-col items-center justify-center py-8 px-6 relative">
                {buddy.shiny && (
                  <div className="absolute top-3 left-4 text-[10px] text-amber-400 font-mono animate-pulse tracking-[0.2em]">
                    ✨ SHINY ✨
                  </div>
                )}
                {petCount > 0 && (
                  <div className="absolute top-3 right-4 text-[10px] text-pink-400/60 font-mono">
                    ♡ ×{petCount}
                  </div>
                )}
                {showHeart && (
                  <div className="absolute top-8 right-6 animate-bounce text-xl select-none">❤️</div>
                )}

                {/* CC-authentic ASCII sprite */}
                <div className="select-none cursor-pointer" onClick={doPet}>
                  <pre className="text-center text-lg sm:text-xl leading-tight font-mono whitespace-pre" style={{ letterSpacing: '0.05em' }}>
                    {heartLine && <span className="text-red-400">{heartLine}{'\n'}</span>}
                    {colorMode ? spriteLines.map((line, i) => {
                      const isHatLine = buddy.hat !== 'none' && i === 0 && CC_HAT_LINES[buddy.hat];
                      const bodyColor = SPECIES_COLORS[buddy.species] ?? '#ccc';
                      const hatColor = HAT_COLORS[buddy.hat] ?? bodyColor;
                      // Colorize: eyes get white, hat line gets hat color, body gets species color
                      const colored = isHatLine
                        ? <span key={i} style={{ color: hatColor }}>{line}</span>
                        : <span key={i}>{line.split('').map((ch, j) => {
                            if (ch === buddy.eyes || ch === '-') return <span key={j} style={{ color: EYE_COLOR }}>{ch}</span>;
                            if (ch === ' ') return ch;
                            return <span key={j} style={{ color: bodyColor }}>{ch}</span>;
                          })}</span>;
                      return <span key={i}>{colored}{i < spriteLines.length - 1 ? '\n' : ''}</span>;
                    }) : <span className={rc.color}>{spriteLines.join('\n')}</span>}
                  </pre>
                </div>

                {/* Name + rarity stars */}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-sm font-bold font-mono" style={colorMode ? { color: SPECIES_COLORS[buddy.species] } : undefined}>
                    <span className={colorMode ? undefined : rc.color}>
                      {buddy.species.charAt(0).toUpperCase() + buddy.species.slice(1)}
                    </span>
                  </span>
                  <span className={`text-xs font-mono ${rc.color} opacity-70`}>
                    {RARITY_STARS[buddy.rarity]}
                  </span>
                </div>
                <span className={`text-[10px] font-mono ${rc.color} opacity-50 mt-0.5`}>
                  {buddy.rarity}
                </span>

                <p className="text-[10px] text-stone-600 font-mono mt-3 flex items-center gap-2">
                  <span><span className="text-green-500/70">$</span> click to pet</span>
                  <span className="text-stone-700">·</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setColorMode(!colorMode); }}
                    className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${colorMode ? 'text-stone-300 bg-white/10' : 'text-stone-600 hover:text-stone-400'}`}
                  >
                    {colorMode ? '◉ color' : '◯ color'}
                  </button>
                </p>
              </div>

              {/* Stats panel */}
              <div className="flex-1 py-6 px-5 border-t md:border-t-0 md:border-l border-white/5 space-y-2.5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-mono text-stone-500 uppercase tracking-[0.15em]">
                    Stat Block
                  </span>
                </div>
                {Object.entries(buddy.stats).map(([stat, val]) => {
                  const filled = Math.round((val / 100) * 20);
                  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
                  const statColor = val >= 70 ? "text-emerald-400" : val >= 40 ? "text-blue-400" : val >= 20 ? "text-amber-400" : "text-red-400";
                  return (
                    <div key={stat} className="font-mono text-xs">
                      <div className="flex justify-between mb-0.5">
                        <span className="text-stone-500">{stat}</span>
                        <span className={statColor}>{val}</span>
                      </div>
                      <div className={`${statColor} opacity-50 text-[11px] leading-none tracking-tighter`}>
                        {bar}
                      </div>
                    </div>
                  );
                })}
                <div className="border-t border-white/5 pt-3 mt-4 space-y-1">
                  <div className="text-[10px] font-mono text-stone-600">
                    seed: <span className="text-stone-500">{ccHash(input.trim() + CC_SALT).toString(16).padStart(8, "0")}</span>
                  </div>
                  <div className="text-[10px] font-mono text-stone-600">
                    eyes: <span className="text-stone-500">{buddy.eyes}</span> · hat: <span className="text-stone-500">{buddy.hat}</span> · pets: <span className="text-pink-400/60">{petCount}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Context Layers Diagram ──────────────────────────────

function ContextDiagram() {
  const [activeLayer, setActiveLayer] = useState(0);
  const layers = [
    {
      name: "Snip Compact",
      desc: "Removes old messages entirely from context window",
      color: "bg-emerald-400",
      detail: "Oldest messages are simply deleted when context starts filling up.",
    },
    {
      name: "Microcompact",
      desc: "Clears old tool results, keeps N most recent",
      color: "bg-blue-400",
      detail: "Tool call results are expensive. Old ones get wiped while keeping the last few intact.",
    },
    {
      name: "Context Collapse",
      desc: "Archives old turns with summaries (projection system)",
      color: "bg-purple-400",
      detail: "A 'projection' system creates summaries of old turns and replaces the originals.",
    },
    {
      name: "Auto-compact",
      desc: "At ~87% capacity, forks agent to summarize conversation",
      color: "bg-amber-400",
      detail: "A separate Sonnet agent writes a summary. It is explicitly told 'Do NOT call any tools. Tool calls will be REJECTED.'",
    },
    {
      name: "Reactive Compact",
      desc: "Last resort when API returns 'prompt too long'",
      color: "bg-red-400",
      detail: "Emergency compaction triggered by API errors. Aggressively trims everything possible.",
    },
  ];

  return (
    <div className="space-y-4">
      {layers.map((layer, i) => (
        <button
          key={i}
          onClick={() => setActiveLayer(i)}
          className={`w-full text-left p-4 rounded-xl border transition-all duration-300 ${
            activeLayer === i
              ? "border-primary/30 bg-primary/[0.04]"
              : "border-surface-2 bg-surface-glass hover:border-surface-2/80"
          }`}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">
                L{i + 1}
              </span>
              <div className={`w-2 h-2 rounded-full ${layer.color}`} />
            </div>
            <h4 className="text-sm font-semibold">{layer.name}</h4>
          </div>
          <p className="text-xs text-muted-foreground ml-8">{layer.desc}</p>
          {activeLayer === i && (
            <p className="text-xs text-foreground/70 ml-8 mt-2 leading-relaxed border-t border-surface-2 pt-2">
              {layer.detail}
            </p>
          )}
        </button>
      ))}
      <div className="mt-4 p-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.04]">
        <p className="text-xs text-amber-600 dark:text-amber-400 font-mono">
          💡 After compaction, Claude can re-read its own transcript to recover context it needs.
        </p>
      </div>
    </div>
  );
}

// ─── Feature Card ────────────────────────────────────────

function FeatureCard({
  icon: Icon,
  title,
  codename,
  flag,
  children,
  index,
}: {
  icon: React.ElementType;
  title: string;
  codename?: string;
  flag: string;
  children: React.ReactNode;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Reveal delay={index * 60}>
      <div
        className={`group p-5 sm:p-6 rounded-2xl border transition-all duration-300 cursor-pointer ${
          expanded
            ? "border-primary/25 bg-primary/[0.03]"
            : "border-surface-2 bg-surface-glass backdrop-blur-md hover:border-primary/15"
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center shrink-0 group-hover:bg-primary/[0.12] transition-colors">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-[15px] font-semibold">{title}</h3>
              {codename && (
                <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-surface-2">
                  {codename}
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-primary mb-2">
              {flag}
            </div>
            <div
              className={`text-[13px] text-muted-foreground leading-relaxed overflow-hidden transition-all duration-300 ${
                expanded ? "max-h-[500px] opacity-100" : "max-h-[3.6em]"
              }`}
            >
              {children}
            </div>
            {!expanded && (
              <button className="text-[11px] text-primary mt-1 hover:text-primary transition-colors">
                Read more →
              </button>
            )}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

// ─── Sections ────────────────────────────────────────────

function StickyTopBar() {
  const scrolled = useScrolled();
  const { light, toggle } = useTheme();
  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-background/80 backdrop-blur-2xl border-b border-surface-2"
          : "bg-background/40 backdrop-blur-md"
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
        <a
          href="/"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Image
            src="/broski-logo.png"
            alt="Broski"
            width={72}
            height={22}
            className="opacity-60 hover:opacity-100 transition-opacity"
          />
        </a>
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-1 transition-all"
            aria-label="Toggle theme"
          >
            {light ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <a
            href="#waitlist-source"
            className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors group"
          >
            <span className="hidden sm:inline text-muted-foreground">
              Control Claude Code from your phone
            </span>
            <span className="text-primary font-medium">
              Join Waitlist
            </span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>
      </div>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center pt-20 pb-16 px-6 overflow-hidden">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(232,196,160,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(232,196,160,0.3) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      <div className="max-w-5xl mx-auto w-full">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center">
          <div>
            <Reveal>
              <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-6 font-mono">
                claude code source analysis
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h1 className="text-[3rem] sm:text-[4rem] md:text-[5rem] font-bold tracking-[-0.04em] leading-[0.95] mb-4">
                We read
                <br />
                every line.
              </h1>
            </Reveal>
            <Reveal delay={200}>
              <p className="font-serif text-2xl sm:text-3xl md:text-4xl italic text-primary mb-8 tracking-[-0.02em]">
                So you don&apos;t have to.
              </p>
            </Reveal>
            <Reveal delay={300}>
              <p className="text-[15px] text-muted-foreground max-w-lg mb-6 leading-relaxed">
                Claude Code&apos;s entire source code leaked. Thousands of files.
                An agent orchestration platform disguised as a terminal chat.
                We read all of it. Here&apos;s what the source code reveals about
                how to actually use this thing.
              </p>
            </Reveal>
            <Reveal delay={400}>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Terminal className="w-4 h-4" />
                  <span>Full source code</span>
                </div>
                <div className="w-px h-4 bg-surface-2" />
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Zap className="w-4 h-4" />
                  <span>Actionable insights</span>
                </div>
              </div>
            </Reveal>
          </div>
          <Reveal delay={300} className="hidden lg:block">
            <AnimatedTerminal />
          </Reveal>
        </div>
        {/* Mobile terminal */}
        <Reveal delay={400} className="lg:hidden mt-10">
          <AnimatedTerminal />
        </Reveal>
      </div>
    </section>
  );
}

// ─── Table of Contents ───────────────────────────────────

const TOC_ITEMS = [
  { id: "claude-md", label: "CLAUDE.md — Your Highest Leverage Config", number: "01" },
  { id: "subagents", label: "Subagents Share the Prompt Cache", number: "02" },
  { id: "context", label: "5 Compaction Strategies — Context Is Everything", number: "03" },
  { id: "hooks", label: "The Hook System — The Real Extension API", number: "04" },
  { id: "hidden-features", label: "Hidden Features — What's Coming Next", number: "05" },
  { id: "commands", label: "Commands Nobody Told You About", number: "06" },
  { id: "env-vars", label: "Environment Variables That Change Everything", number: "07" },
  { id: "cost-math", label: "The Real Cost Math", number: "08" },
  { id: "tool-limits", label: "Every Tool's Real Limits", number: "09" },
  { id: "undercover", label: "Undercover Mode — When Anthropic Hides Claude", number: "10" },
  { id: "buddy", label: "Buddy — The Virtual Pet Nobody Expected", number: "11" },
];

function TableOfContents() {
  const active = useActiveSection();
  return (
    <section className="py-16 md:py-24 px-6 border-y border-surface-2">
      <div className="max-w-5xl mx-auto">
        <div className="grid md:grid-cols-[280px_1fr] gap-8">
          <Reveal>
            <div>
              <p className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3 font-mono">
                Contents
              </p>
              <p className="text-sm text-muted-foreground">
                Everything we found — from practical tips to hidden features.
              </p>
            </div>
          </Reveal>
          <div className="space-y-0">
            {TOC_ITEMS.map((item, i) => (
              <Reveal key={item.id} delay={i * 40}>
                <a
                  href={`#${item.id}`}
                  className={`flex items-center gap-4 py-3 border-b border-surface-2 group transition-colors ${
                    active === item.id
                      ? "text-primary"
                      : "text-foreground hover:text-primary"
                  }`}
                >
                  <span className="text-xs font-mono text-muted-foreground w-6">
                    {item.number}
                  </span>
                  <span className="text-[15px] flex-1">{item.label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section 1: CLAUDE.md ────────────────────────────────

function ClaudeMdSection() {
  return (
    <section id="claude-md" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 01
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            CLAUDE.md is loaded{" "}
            <span className="font-serif italic text-primary">every single turn.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-6 leading-relaxed">
            This is the single highest leverage thing you can do and almost nobody does it properly.
          </p>
        </Reveal>
        <Reveal delay={160}>
          <div className="space-y-6 text-[15px] text-foreground/90 leading-relaxed">
            <p>
              The source code shows that Claude Code reads your CLAUDE.md files on <strong>every query iteration</strong>. Not at session start. Every turn. That means every time you send a message, it re-reads your instructions.
            </p>
            <p>There&apos;s a whole hierarchy:</p>
            <div className="rounded-2xl border border-surface-2 bg-surface-glass p-5 space-y-3 font-mono text-sm">
              <div className="flex items-start gap-3">
                <span className="text-primary font-bold shrink-0">~/.claude/CLAUDE.md</span>
                <span className="text-muted-foreground">— global (your coding style, preferences)</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary font-bold shrink-0">./CLAUDE.md</span>
                <span className="text-muted-foreground">— project level (architecture decisions, conventions)</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary font-bold shrink-0">.claude/rules/*.md</span>
                <span className="text-muted-foreground">— modular rules (scoped instructions)</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary font-bold shrink-0">CLAUDE.local.md</span>
                <span className="text-muted-foreground">— private notes (gitignored)</span>
              </div>
            </div>
            <p>
              You get <strong>40,000 characters</strong>. That&apos;s a LOT. Most people use maybe 200. Put your architecture decisions in there. Your file conventions. Your testing patterns. Your &quot;never do this&quot; rules. The model reads them <em>every single turn</em>.
            </p>
            <p>
              This is the difference between Claude Code being a generic assistant and Claude Code being <strong>your</strong> assistant that knows <strong>your</strong> codebase.
            </p>
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/[0.04]">
              <p className="text-sm font-semibold text-foreground mb-1">💡 If you do one thing after reading this:</p>
              <p className="text-sm text-muted-foreground">Write a real CLAUDE.md for your project. Architecture, conventions, testing patterns, file structure. 40K chars. Loaded every turn. Highest leverage config you have.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 2: Subagents ────────────────────────────────

function SubagentsSection() {
  return (
    <section id="subagents" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 02
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            Subagents share the{" "}
            <span className="font-serif italic text-primary">prompt cache.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-6 leading-relaxed">
            Parallelism is basically free. This blew our minds.
          </p>
        </Reveal>
        <Reveal delay={160}>
          <div className="space-y-6 text-[15px] text-foreground/90 leading-relaxed">
            <p>
              When Claude Code forks a subagent, it creates a <strong>byte-identical copy</strong> of the parent context. The API caches this. So spawning 5 agents to work on different parts of your codebase costs <strong>barely more than 1 agent</strong> doing it sequentially.
            </p>
            <p>Read that again. 5 agents. Same cost as 1. Because they all hit the prompt cache.</p>
            <p>The source code has three execution models for subagents:</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl border border-surface-2 bg-surface-glass">
                <h4 className="text-sm font-bold mb-2">Fork</h4>
                <p className="text-xs text-muted-foreground">Inherits parent context. Cache-optimized. Max 200 turns. Reports back in under 500 words. Can&apos;t spawn sub-forks.</p>
              </div>
              <div className="p-4 rounded-xl border border-surface-2 bg-surface-glass">
                <h4 className="text-sm font-bold mb-2">Teammate</h4>
                <p className="text-xs text-muted-foreground">Separate pane in tmux/iTerm. Communicates via file-based mailbox. Full tool access. Runs in parallel.</p>
              </div>
              <div className="p-4 rounded-xl border border-surface-2 bg-surface-glass">
                <h4 className="text-sm font-bold mb-2">Worktree</h4>
                <p className="text-xs text-muted-foreground">Gets its own git worktree. Isolated branch per agent. No merge conflicts between parallel workers.</p>
              </div>
            </div>
            <p>
              There are also <strong>5 built-in agent types</strong>: general-purpose, Explore (read-only search, uses Haiku), Plan (architect, read-only), Verification (adversarial — tries to <em>break</em> your code), and Guide (help with Claude Code itself).
            </p>
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/[0.04]">
              <p className="text-sm font-semibold text-foreground mb-1">💡 Stop using Claude Code single-threaded.</p>
              <p className="text-sm text-muted-foreground">Tell it to spin up 5 agents: one doing a security audit, one refactoring, one writing tests, one updating docs, one fixing bugs. All at the same time. All sharing the cache. The architecture is built for this.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 4: Hooks ────────────────────────────────────

function HooksSection() {
  return (
    <section id="hooks" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 04
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            The hook system is the{" "}
            <span className="font-serif italic text-primary">real extension API.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-6 leading-relaxed">
            25+ lifecycle events. 5 hook types. Almost nobody knows about this.
          </p>
        </Reveal>
        <Reveal delay={160}>
          <div className="space-y-6 text-[15px] text-foreground/90 leading-relaxed">
            <p>The source code reveals 25+ lifecycle events you can hook into:</p>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              {[
                { event: "PreToolUse", desc: "Runs before any tool executes" },
                { event: "PostToolUse", desc: "Runs after any tool completes" },
                { event: "UserPromptSubmit", desc: "Runs when you send a message" },
                { event: "SessionStart", desc: "Session lifecycle start" },
                { event: "TaskCreated", desc: "When a task is spawned" },
                { event: "StopHook", desc: "After model completes a turn" },
              ].map((h) => (
                <div key={h.event} className="p-3 rounded-xl border border-surface-2 bg-surface-glass">
                  <code className="text-sm font-mono text-primary font-bold">{h.event}</code>
                  <p className="text-xs text-muted-foreground mt-1">{h.desc}</p>
                </div>
              ))}
            </div>
            <p>With <strong>5 types of hooks</strong>:</p>
            <div className="rounded-2xl border border-surface-2 bg-surface-glass p-5 space-y-2 font-mono text-sm">
              <div><span className="text-primary font-bold">command</span> <span className="text-muted-foreground">— run a shell command</span></div>
              <div><span className="text-primary font-bold">prompt</span> <span className="text-muted-foreground">— inject context via LLM</span></div>
              <div><span className="text-primary font-bold">agent</span> <span className="text-muted-foreground">— run a full agent verification loop</span></div>
              <div><span className="text-primary font-bold">HTTP</span> <span className="text-muted-foreground">— call a webhook</span></div>
              <div><span className="text-primary font-bold">function</span> <span className="text-muted-foreground">— run JavaScript</span></div>
            </div>
            <p>The <code className="text-sm bg-surface-1 border border-surface-2 px-1.5 py-0.5 rounded font-mono">UserPromptSubmit</code> hook is especially powerful. You can inject <code className="text-sm bg-surface-1 border border-surface-2 px-1.5 py-0.5 rounded font-mono">additionalContext</code> into every single message. Automatically attach test output, recent git diffs, or project state to every prompt — without typing it.</p>
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/[0.04]">
              <p className="text-sm font-semibold text-foreground mb-1">💡 Real examples of what you can build:</p>
              <p className="text-sm text-muted-foreground">Auto-run linting before every file write. Run tests after every edit. Inject relevant docs into every prompt. Send Slack notifications when tasks complete. Validate security patterns before code ships. This is how you build a custom dev environment on top of Claude Code — not by prompting better, by hooking into the system.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 5: Hidden Features ──────────────────────────

function HiddenFeatures() {
  return (
    <section id="hidden-features" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 05
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            What&apos;s coming{" "}
            <span className="font-serif italic text-primary">next.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-12">
            Nine features hidden behind feature flags. None of these are
            documented. All of them are partially or fully implemented in the
            codebase.
          </p>
        </Reveal>

        <div className="space-y-3">
          <FeatureCard
            icon={Cpu}
            title="KAIROS — Persistent Background Agent"
            flag='featureFlag: "KAIROS" | "KAIROS_BRIEF" | "KAIROS_PUSH_NOTIFICATION" | "KAIROS_GITHUB_WEBHOOKS"'
            index={0}
          >
            <p className="mb-2">
              Claude Code is building a mode where Claude runs persistently in the
              background. Activated via{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                claude assistant
              </code>
              .
            </p>
            <ul className="space-y-1.5 list-none">
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Suggests actions proactively without you asking
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Send push notifications to your device
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Subscribe to GitHub PR events (review comments, CI results)
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Manage teams of sub-agents
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Survives terminal closure
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Maintains daily memory logs
              </li>
            </ul>
          </FeatureCard>

          <FeatureCard
            icon={Mic}
            title="Voice Mode — Push to Talk"
            flag='featureFlag: "VOICE_MODE"'
            index={1}
          >
            <p className="mb-2">
              Push-to-talk voice input using Anthropic&apos;s{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                voice_stream
              </code>{" "}
              WebSocket STT endpoint.
            </p>
            <ul className="space-y-1.5 list-none">
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Uses native audio capture (cpal) on macOS/Linux/Windows
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Hold Space to talk
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                Fallback to SoX for unsupported platforms
              </li>
              <li className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                STT provider: Deepgram Nova 3
              </li>
            </ul>
          </FeatureCard>

          <FeatureCard
            icon={Server}
            title="Background Sessions"
            flag='featureFlag: "BG_SESSIONS"'
            index={2}
          >
            <p>
              Run sessions in tmux with{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                claude --bg
              </code>
              . List with{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                claude ps
              </code>
              . View logs with{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                claude logs
              </code>
              . Reconnect with{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                claude attach
              </code>
              . Stop with{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                claude kill
              </code>
              .
            </p>
          </FeatureCard>

          <FeatureCard
            icon={Brain}
            title="Ultraplan — 30-Minute Deep Planning"
            flag='featureFlag: "ULTRAPLAN"'
            index={3}
          >
            <p>
              Sends your task to a remote Claude Code Remote instance running Opus
              for up to 30 minutes of deep planning. Multi-agent exploration with
              full context.
            </p>
          </FeatureCard>

          <FeatureCard
            icon={Globe}
            title="SSH Remote"
            flag='featureFlag: "SSH_REMOTE"'
            index={4}
          >
            <p>
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                claude ssh &lt;host&gt; [dir]
              </code>{" "}
              — deploys the Claude Code binary to a remote host and tunnels API
              auth back. No remote setup needed.
            </p>
          </FeatureCard>

          <FeatureCard
            icon={Zap}
            title="Daemon Mode"
            flag='featureFlag: "DAEMON"'
            index={5}
          >
            <p>
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                claude daemon
              </code>{" "}
              — a long-running supervisor process that manages background workers.
              The foundation for persistent agent infrastructure.
            </p>
          </FeatureCard>

          <FeatureCard
            icon={Terminal}
            title='Computer Use MCP (codename "Chicago")'
            codename="Chicago"
            flag='featureFlag: "CHICAGO_MCP"'
            index={6}
          >
            <p>
              Built-in computer use via MCP server. Enabled with the{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                --computer-use-mcp
              </code>{" "}
              flag. Claude can see your screen and interact with your desktop.
            </p>
          </FeatureCard>

          <FeatureCard
            icon={Layers}
            title="Coordinator Mode — Multi-Agent Orchestration"
            flag='featureFlag: "COORDINATOR_MODE" | CLAUDE_CODE_COORDINATOR_MODE=1'
            index={7}
          >
            <p>
              Claude becomes a multi-agent orchestrator spawning parallel workers.
              Workers run independently and report back. Shared scratchpad for
              coordination.
            </p>
          </FeatureCard>

          <FeatureCard
            icon={GitBranch}
            title="Fork Subagent"
            flag='featureFlag: "FORK_SUBAGENT"'
            index={8}
          >
            <p>
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">
                /fork
              </code>{" "}
              creates a subagent that inherits your full conversation context. Runs
              in background, reports back in under 500 words. Children can&apos;t
              spawn sub-forks.
            </p>
          </FeatureCard>
        </div>
      </div>
    </section>
  );
}

// ─── Section 2: Buddy ────────────────────────────────────

function BuddySection() {
  return (
    <section id="buddy" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 11
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            <span className="font-serif italic text-primary">Buddy.</span> The
            virtual pet nobody expected.
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-10">
            Yes, really. Claude Code has a fully implemented virtual pet system
            buried in its source. Your pet is deterministically generated from
            your user ID — you can&apos;t change or cheat it.
          </p>
        </Reveal>

        {/* Species grid */}
        <Reveal delay={160}>
          <div className="mb-8">
            <h3 className="text-sm font-semibold mb-4 text-muted-foreground">
              18 Species
            </h3>
            <div className="flex flex-wrap gap-2">
              {BUDDY_SPECIES.map((species) => (
                <span
                  key={species}
                  className="text-xs font-mono px-3 py-1.5 rounded-lg bg-surface-1 border border-surface-2 text-muted-foreground hover:text-primary hover:border-primary/20 transition-colors cursor-default"
                >
                  {species}
                </span>
              ))}
            </div>
          </div>
        </Reveal>

        {/* Rarity tiers */}
        <Reveal delay={200}>
          <div className="mb-8 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {RARITY_TIERS.map((tier, i) => {
              const Icon = RARITY_ICONS[i];
              return (
                <div
                  key={tier.name}
                  className={`p-3 rounded-xl border ${tier.border} ${tier.bg} text-center`}
                >
                  <Icon className={`w-4 h-4 ${tier.color} mx-auto mb-1`} />
                  <div className={`text-sm font-semibold ${tier.color}`}>
                    {tier.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {tier.chance}
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>

        {/* Fun facts */}
        <Reveal delay={240}>
          <div className="grid sm:grid-cols-3 gap-3 mb-10">
            <div className="p-4 rounded-xl border border-surface-2 bg-surface-glass">
              <div className="text-2xl mb-2">👀</div>
              <h4 className="text-sm font-semibold mb-1">6 Eye Styles</h4>
              <div className="flex gap-2 text-lg">
                {BUDDY_EYES.map((e) => (
                  <span key={e} className="text-muted-foreground">
                    {e}
                  </span>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-xl border border-surface-2 bg-surface-glass">
              <div className="text-2xl mb-2">🎩</div>
              <h4 className="text-sm font-semibold mb-1">8 Hats</h4>
              <p className="text-xs text-muted-foreground">
                Commons get no hat. Uncommon+ only.
                Crown, tophat, propeller, halo, wizard, beanie, tinyduck.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-surface-2 bg-surface-glass">
              <div className="text-2xl mb-2">✨</div>
              <h4 className="text-sm font-semibold mb-1">1% Shiny Chance</h4>
              <p className="text-xs text-muted-foreground">
                Your buddy has a 1% chance of being shiny.
                Deterministic — same ID, same result.
              </p>
            </div>
          </div>
        </Reveal>

        {/* Easter egg callout */}
        <Reveal delay={280}>
          <div className="p-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] mb-10">
            <p className="text-xs text-amber-600 dark:text-amber-400 font-mono">
              🔍 The species &quot;capybara&quot; collides with an internal model
              codename, so ALL species names are hex-encoded in the source to
              avoid build-time string checks. Teaser window: April 1-7, 2026.
            </p>
          </div>
        </Reveal>

        {/* Interactive generator */}
        <Reveal delay={320}>
          <h3 className="text-lg font-semibold mb-4">
            What&apos;s your buddy?
          </h3>
          <BuddyGenerator />
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 3: Undercover Mode ──────────────────────────

function UndercoverSection() {
  const [revealed, setRevealed] = useState(false);
  return (
    <section id="undercover" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 10
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            <span className="font-serif italic text-primary">
              Undercover Mode.
            </span>
            <br />
            When Anthropic hides Claude.
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-12">
            When Anthropic employees contribute to open-source repos, undercover
            mode activates <em>automatically</em>. Claude is told to hide all
            traces of its involvement.
          </p>
        </Reveal>

        {/* The reveal */}
        <Reveal delay={160}>
          <div className="relative rounded-2xl border border-surface-2 bg-stone-950 dark:bg-stone-950 overflow-hidden mb-8">
            {/* Fake terminal header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-2 bg-surface-1/50">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              </div>
              <span className="text-[10px] text-muted-foreground font-mono ml-2">
                undercover_mode.ts
              </span>
            </div>
            <div className="p-5 font-mono text-[12px] sm:text-[13px] leading-relaxed space-y-1">
              <div className="text-stone-400">
                // src/permissions/undercover.ts
              </div>
              <div>
                <span className="text-purple-400/80">if</span>
                <span className="text-stone-300">
                  {" "}
                  (isAnthropicEmployee {"&&"} isPublicRepo) {"{"}
                </span>
              </div>
              <div className="pl-4">
                <span className="text-stone-300">
                  mode ={" "}
                </span>
                <span className="text-emerald-400/80">
                  &quot;UNDERCOVER&quot;
                </span>
              </div>
              <div className="text-stone-400 pl-4">
                // You are operating UNDERCOVER in a
              </div>
              <div className="text-stone-400 pl-4">
                // PUBLIC/OPEN-SOURCE repository.
              </div>
              <div className="text-stone-400 pl-4">
                // Do not blow your cover.
              </div>
              <div className="text-stone-300">{"}"}</div>
            </div>
          </div>
        </Reveal>

        {/* What gets stripped */}
        <Reveal delay={200}>
          <h3 className="text-lg font-semibold mb-4">What gets stripped:</h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            {[
              {
                before: 'Co-Authored-By: Claude <claude@anthropic.com>',
                after: "(removed entirely)",
                icon: EyeOff,
              },
              {
                before: "Model codenames: Capybara, Tengu",
                after: "(scrubbed from output)",
                icon: EyeOff,
              },
              {
                before: '"Fixed by Claude Opus 4.6"',
                after: '"Fix race condition in file watcher initialization"',
                icon: Eye,
              },
              {
                before: "Internal repo names, Claude Code mentions",
                after: "(all references removed)",
                icon: EyeOff,
              },
            ].map((item, i) => (
              <div
                key={i}
                className="p-4 rounded-xl border border-surface-2 bg-surface-glass"
              >
                <div className="flex items-center gap-2 mb-2">
                  <item.icon className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-mono text-red-500 line-through">
                    {item.before}
                  </span>
                </div>
                <span className="text-xs font-mono text-emerald-500">
                  → {item.after}
                </span>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Safety rules */}
        <Reveal delay={240}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="p-5 rounded-xl border border-red-300 dark:border-red-400/20 bg-red-50 dark:bg-red-400/[0.06]">
              <Lock className="w-5 h-5 text-red-500 mb-3" />
              <h4 className="text-sm font-semibold mb-2">
                Can force ON, but NEVER force OFF
              </h4>
              <p className="text-xs text-muted-foreground">
                Safety net against leaks. Once undercover mode activates for a
                repository, there&apos;s no way to disable it.
              </p>
            </div>
            <div className="p-5 rounded-xl border border-surface-2 bg-surface-glass">
              <Shield className="w-5 h-5 text-primary mb-3" />
              <h4 className="text-sm font-semibold mb-2">
                Internal codenames revealed
              </h4>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono text-primary">Capybara</span> =
                model codename.{" "}
                <span className="font-mono text-primary">Tengu</span> = Claude
                Code&apos;s internal project codename. Shows
                &quot;undercover&quot; in the status bar on internal builds.
              </p>
            </div>
          </div>
        </Reveal>

        {/* Dramatic toggle */}
        <Reveal delay={280}>
          <div className="mt-8 text-center">
            <button
              onClick={() => setRevealed(!revealed)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-1 border border-surface-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/20 transition-all"
            >
              {revealed ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              {revealed ? "Activate Undercover Mode" : "Show real commit message"}
            </button>
            <div className="mt-4 font-mono text-sm">
              {revealed ? (
                <span className="text-muted-foreground">
                  Fix race condition in file watcher initialization
                </span>
              ) : (
                <span className="text-primary">
                  [Claude Opus 4.6] Refactored file watcher with enhanced race
                  condition handling — Co-Authored-By: Claude
                </span>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 4: Hidden Commands ──────────────────────────

function CommandsSection() {
  const userCommands = [
    { cmd: "/btw", desc: "Ask a side question without interrupting main conversation" },
    { cmd: "/context", desc: "Visualize context usage as a colored grid" },
    { cmd: "/diff", desc: "View uncommitted changes and per-turn diffs" },
    { cmd: "/stickers", desc: "Order physical Claude Code stickers (stickermule.com)" },
    { cmd: "/insights", desc: "Generate comprehensive session analysis report (3,200-line module!)" },
    { cmd: "/advisor opus", desc: "Enable a second model that watches and advises" },
    { cmd: "/desktop", desc: "Hand off session to Claude Desktop app" },
    { cmd: "/mobile", desc: "QR code to download Claude mobile app" },
    { cmd: "/think-back", desc: '"Your 2025 Claude Code Year in Review" animation' },
    { cmd: "/ultraplan", desc: "30-min deep planning with remote Opus agent" },
    { cmd: "/buddy", desc: "Your virtual companion pet" },
    { cmd: "/fork", desc: "Fork conversation into background subagent" },
    { cmd: "/bridge", desc: "Remote control mode" },
  ];

  const internalCommands = [
    { cmd: "/break-cache", desc: "Force invalidate prompt cache" },
    { cmd: "/good-claude", desc: "Good Claude mode (stubbed)" },
    { cmd: "/dump-system-prompt", desc: "Print full system prompt" },
    { cmd: "/bughunter", desc: "Bug hunter tool" },
    { cmd: "/commit-push-pr", desc: "Full commit → push → PR → Slack pipeline" },
  ];

  return (
    <section id="commands" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 06
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            Commands nobody{" "}
            <span className="font-serif italic text-primary">told you about.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-12">
            13 undocumented slash commands available to all users, plus 5
            internal-only commands for Anthropic employees.
          </p>
        </Reveal>

        {/* User commands */}
        <Reveal delay={160}>
          <div className="rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-surface-2 bg-surface-1/30">
              <span className="text-xs font-mono text-muted-foreground">
                Available to all users
              </span>
            </div>
            {userCommands.map((cmd, i) => (
              <div
                key={cmd.cmd}
                className={`flex items-start gap-4 px-5 py-3.5 ${
                  i < userCommands.length - 1 ? "border-b border-surface-2" : ""
                } hover:bg-primary/[0.02] transition-colors`}
              >
                <code className="text-sm font-mono text-primary shrink-0 w-36 sm:w-40">
                  {cmd.cmd}
                </code>
                <span className="text-sm text-muted-foreground">{cmd.desc}</span>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Internal commands */}
        <Reveal delay={200}>
          <div className="rounded-2xl border border-red-300 dark:border-red-400/20 bg-red-50 dark:bg-red-400/[0.04] overflow-hidden">
            <div className="px-5 py-3 border-b border-red-200 dark:border-red-400/10 bg-red-100/50 dark:bg-red-400/[0.06]">
              <div className="flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-red-500" />
                <span className="text-xs font-mono text-red-500">
                  Anthropic internal only
                </span>
              </div>
            </div>
            {internalCommands.map((cmd, i) => (
              <div
                key={cmd.cmd}
                className={`flex items-start gap-4 px-5 py-3.5 ${
                  i < internalCommands.length - 1
                    ? "border-b border-red-200 dark:border-red-400/10"
                    : ""
                }`}
              >
                <code className="text-sm font-mono text-red-500 shrink-0 w-36 sm:w-40">
                  {cmd.cmd}
                </code>
                <span className="text-sm text-muted-foreground">
                  {cmd.desc}
                </span>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 5: Environment Variables ────────────────────

function EnvVarsSection() {
  const groups = [
    {
      label: "Kill switches",
      vars: [
        { name: "CLAUDE_CODE_DISABLE_THINKING=1", desc: "Disable extended thinking" },
        { name: "DISABLE_AUTO_COMPACT=1", desc: "Stop automatic context compaction" },
        { name: "CLAUDE_CODE_DISABLE_AUTO_MEMORY=1", desc: "Stop auto memory extraction" },
        { name: "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1", desc: "No background processing" },
        { name: "CLAUDE_CODE_DISABLE_CLAUDE_MDS=1", desc: "Ignore all CLAUDE.md files" },
      ],
    },
    {
      label: "Tuning",
      vars: [
        { name: "BASH_DEFAULT_TIMEOUT_MS=600000", desc: "10min bash timeout (default 2min)" },
        { name: "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=20", desc: "Max parallel tool calls (default 10)" },
        { name: "CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=50000", desc: "Double the default file read limit" },
        { name: "CLAUDE_CODE_SCROLL_SPEED=3", desc: "Fix scroll speed for some terminals" },
      ],
    },
    {
      label: "Power user",
      vars: [
        { name: "CLAUDE_CODE_ABLATION_BASELINE=1", desc: "Disable ALL smart features at once" },
        { name: "CLAUDE_CODE_SIMPLE=1", desc: "Bare minimum mode" },
      ],
    },
  ];

  return (
    <section id="env-vars" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 07
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            Environment variables that{" "}
            <span className="font-serif italic text-primary">
              change everything.
            </span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-12">
            Copy-paste these into your shell to unlock hidden behavior.
          </p>
        </Reveal>

        <div className="space-y-6">
          {groups.map((group, gi) => (
            <Reveal key={group.label} delay={160 + gi * 60}>
              <div className="rounded-2xl border border-surface-2 bg-stone-950 dark:bg-stone-950 overflow-hidden">
                <div className="px-5 py-3 border-b border-surface-2 bg-surface-1/30">
                  <div className="flex items-center gap-2">
                    <Variable className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-mono text-muted-foreground">
                      # {group.label}
                    </span>
                  </div>
                </div>
                <div className="p-4 sm:p-5 space-y-2">
                  {group.vars.map((v) => (
                    <div
                      key={v.name}
                      className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4"
                    >
                      <code className="text-[12px] sm:text-[13px] font-mono text-emerald-500 shrink-0">
                        {v.name}
                      </code>
                      <span className="text-[11px] sm:text-xs text-stone-400">
                        # {v.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section 6: Cost Math ────────────────────────────────

function CostSection() {
  const models = [
    { name: "Sonnet 4/4.5/4.6", input: "$3", output: "$15", cacheWrite: "$3.75", cacheRead: "$0.30" },
    { name: "Opus 4.5/4.6", input: "$5", output: "$25", cacheWrite: "$6.25", cacheRead: "$0.50" },
    { name: "Opus 4.6 (fast)", input: "$30", output: "$150", cacheWrite: "$37.50", cacheRead: "$3.00" },
    { name: "Haiku 4.5", input: "$1", output: "$5", cacheWrite: "$1.25", cacheRead: "$0.10" },
    { name: "Opus 4/4.1", input: "$15", output: "$75", cacheWrite: "$18.75", cacheRead: "$1.50" },
  ];

  return (
    <section id="cost-math" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 08
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            The real{" "}
            <span className="font-serif italic text-primary">cost math.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-12">
            Per-million-token pricing pulled directly from the source. These are
            the rates hardcoded into Claude Code&apos;s cost calculator.
          </p>
        </Reveal>

        <Reveal delay={160}>
          <div className="rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-2">
                  <th className="text-left p-4 text-muted-foreground font-medium">
                    Model
                  </th>
                  <th className="text-right p-4 text-muted-foreground font-medium">
                    Input/1M
                  </th>
                  <th className="text-right p-4 text-muted-foreground font-medium">
                    Output/1M
                  </th>
                  <th className="text-right p-4 text-muted-foreground font-medium">
                    Cache Write
                  </th>
                  <th className="text-right p-4 text-muted-foreground font-medium">
                    Cache Read
                  </th>
                </tr>
              </thead>
              <tbody>
                {models.map((m, i) => (
                  <tr
                    key={m.name}
                    className={
                      i < models.length - 1 ? "border-b border-surface-2" : ""
                    }
                  >
                    <td className="p-4 font-medium whitespace-nowrap">
                      {m.name}
                    </td>
                    <td className="p-4 text-right font-mono text-emerald-500">
                      {m.input}
                    </td>
                    <td className="p-4 text-right font-mono text-primary">
                      {m.output}
                    </td>
                    <td className="p-4 text-right font-mono text-muted-foreground">
                      {m.cacheWrite}
                    </td>
                    <td className="p-4 text-right font-mono text-muted-foreground">
                      {m.cacheRead}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal delay={200}>
          <div className="mt-6 grid sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border border-surface-2 bg-surface-glass">
              <DollarSign className="w-4 h-4 text-primary mb-2" />
              <h4 className="text-sm font-semibold mb-1">
                Output capped at 8K tokens
              </h4>
              <p className="text-xs text-muted-foreground">
                Not 32K as docs suggest. Default{" "}
                <code className="text-[11px] bg-surface-2 px-1 rounded">
                  maxOutputTokens
                </code>{" "}
                is 16,384 but effective is 8,192 per turn.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-surface-2 bg-surface-glass">
              <Zap className="w-4 h-4 text-primary mb-2" />
              <h4 className="text-sm font-semibold mb-1">
                Cache expires in 5 minutes
              </h4>
              <p className="text-xs text-muted-foreground">
                Prompt cache TTL is 300s. Auto-compact triggers at ~87% of
                context window. Unknown models default to $5/$25 tier.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 7: How Claude Code Thinks ───────────────────

function ContextSection() {
  return (
    <section id="context" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 03
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            5 compaction strategies.{" "}
            <span className="font-serif italic text-primary">Context is everything.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-6 leading-relaxed">
            The source has FIVE different ways to compress your conversation when it gets too long. This tells you context overflow is a central problem the engineers spent a LOT of time on.
          </p>
        </Reveal>
        <Reveal delay={140}>
          <div className="space-y-4 text-[15px] text-foreground/90 leading-relaxed mb-8">
            <p>What this means for you: use <code className="text-sm bg-surface-1 border border-surface-2 px-1.5 py-0.5 rounded font-mono">/compact</code> proactively. Don&apos;t wait for the system to auto-compact and lose context you care about. The default window is 200K tokens, but you can opt into 1M with the <code className="text-sm bg-surface-1 border border-surface-2 px-1.5 py-0.5 rounded font-mono">[1m]</code> model suffix.</p>
            <p>Long sessions accumulate &quot;session memory&quot; — structured summaries of task specs, file lists, workflow state, errors, and learnings. This is why <strong>resuming a session is better than starting fresh</strong>. Use <code className="text-sm bg-surface-1 border border-surface-2 px-1.5 py-0.5 rounded font-mono">--continue</code>. Always.</p>
          </div>
        </Reveal>

        <Reveal delay={160}>
          <ContextDiagram />
        </Reveal>

        <Reveal delay={200}>
          <div className="mt-8 p-5 rounded-2xl border border-surface-2 bg-stone-950 dark:bg-stone-950">
            <div className="font-mono text-[12px] sm:text-[13px] space-y-1">
              <div className="text-stone-400">
                // The compaction prompt literally says:
              </div>
              <div className="text-amber-500">
                &quot;Do NOT call any tools. Tool calls will be REJECTED.&quot;
              </div>
              <div className="text-stone-400 mt-2">
                // Because Sonnet 4.6+ sometimes tries to call tools
              </div>
              <div className="text-stone-400">
                // during the compaction summary. Anthropic had to
              </div>
              <div className="text-stone-400">
                // add this explicitly to stop it.
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Section 8: Tool Limits ──────────────────────────────

function ToolLimitsSection() {
  const tools = [
    {
      name: "Bash",
      icon: Terminal,
      limits: [
        "2-minute default timeout (max 10 minutes with env var)",
        "30K character inline output limit",
        "64MB persisted output to file",
        "Auto-backgrounds after 120 seconds",
      ],
    },
    {
      name: "File Read",
      icon: BookOpen,
      limits: [
        "2,000 lines max per read",
        "256KB default file size limit",
        "25K tokens output limit",
        "Deduplicates unchanged files (saves ~18% tokens)",
      ],
    },
    {
      name: "File Edit",
      icon: Wrench,
      limits: [
        "Must read file first (enforced by runtime)",
        "Max 1GiB file size",
        "Fuzzy quote matching for edit anchors",
        "Blocks editing binary files",
      ],
    },
    {
      name: "Web Search",
      icon: Globe,
      limits: [
        "Max 8 searches per tool call",
        "US region only",
        "Uses Haiku internally for result processing",
        "Not available in all plans",
      ],
    },
    {
      name: "Web Fetch",
      icon: Globe,
      limits: [
        "10MB max response",
        "60-second timeout",
        "15-minute URL cache",
        "125-char quote limit for non-preapproved domains",
        "~130 preapproved domains (GitHub, npm, MDN, etc.)",
      ],
    },
    {
      name: "Agent / Subagent",
      icon: Layers,
      limits: [
        "5 built-in types: general, explore, plan, verification, guide",
        "Max 200 turns for fork subagents",
        "Report-back limit: 500 words",
        "Children cannot spawn sub-forks",
      ],
    },
  ];

  return (
    <section id="tool-limits" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 09
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            Every tool&apos;s real{" "}
            <span className="font-serif italic text-primary">limits.</span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-12">
            The actual constraints hardcoded into each tool. These determine what
            Claude Code can and can&apos;t do per turn.
          </p>
        </Reveal>

        <div className="grid sm:grid-cols-2 gap-3">
          {tools.map((tool, i) => (
            <Reveal key={tool.name} delay={160 + i * 50}>
              <div className="h-full p-5 rounded-2xl border border-surface-2 bg-surface-glass backdrop-blur-md hover:border-primary/15 transition-all duration-300">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/[0.08] flex items-center justify-center">
                    <tool.icon className="w-4 h-4 text-primary" />
                  </div>
                  <h3 className="text-[15px] font-semibold">{tool.name}</h3>
                </div>
                <ul className="space-y-2">
                  {tool.limits.map((limit, j) => (
                    <li
                      key={j}
                      className="flex items-start gap-2 text-[13px] text-muted-foreground"
                    >
                      <ChevronRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                      {limit}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section 9: Spinner Verbs ────────────────────────────

function SpinnerSection() {
  return (
    <section id="spinner" className="py-24 md:py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-4 font-mono">
            Section 09
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-4">
            204 things Claude Code{" "}
            <span className="font-serif italic text-primary">
              says while thinking.
            </span>
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-muted-foreground max-w-2xl mb-12">
            The thinking spinner isn&apos;t random. There are exactly 204 verbs
            hardcoded into the source. Here are some highlights:
          </p>
        </Reveal>

        {/* Live spinner */}
        <Reveal delay={160}>
          <div className="flex items-center justify-center p-10 rounded-2xl border border-surface-2 bg-stone-950 dark:bg-stone-950 mb-10">
            <SpinnerVerbs />
          </div>
        </Reveal>

        {/* Word cloud */}
        <Reveal delay={200}>
          <div className="flex flex-wrap gap-2 justify-center">
            {SPINNER_VERBS.map((verb, i) => (
              <span
                key={verb}
                className="text-xs font-mono px-2 py-1 rounded bg-surface-1 border border-surface-2 text-muted-foreground hover:text-primary hover:border-primary/20 transition-colors cursor-default"
                style={{
                  fontSize: `${10 + (((i * 7 + 3) % 5) * 0.8)}px`,
                  opacity: 0.4 + (((i * 13 + 5) % 7) / 10),
                }}
              >
                {verb}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Final CTA ───────────────────────────────────────────

function FinalCTA() {
  const count = useWaitlistCount();
  return (
    <section
      id="waitlist-source"
      className="relative py-24 md:py-32 lg:py-40 px-6 overflow-hidden"
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent" />
      <div className="relative max-w-3xl mx-auto text-center">
        <Reveal>
          <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-6 font-mono">
            One more thing
          </p>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.1] mb-6">
            Now imagine controlling
            <br />
            all of this{" "}
            <span className="font-serif italic text-primary">
              from your phone.
            </span>
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <p className="text-muted-foreground max-w-lg mx-auto mb-10 leading-relaxed">
            Broski gives you a native iOS interface to manage Claude Code
            sessions, approve permissions, browse files, and chat — all from
            your pocket. KAIROS running in the background? Monitor it. Session
            costs piling up? Track them. Permissions pending? Approve from the
            bus.
          </p>
        </Reveal>
        <Reveal delay={300} className="flex justify-center">
          <WaitlistForm id="waitlist-source-form" />
        </Reveal>
        {count > 0 && (
          <Reveal delay={400}>
            <div className="flex items-center justify-center gap-2 mt-8 text-sm text-muted-foreground">
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

// ─── Footer ──────────────────────────────────────────────

function Footer() {
  return (
    <footer className="py-10 px-6 border-t border-surface-2">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image
            src="/broski-logo.png"
            alt="Broski"
            width={72}
            height={22}
            className="opacity-40"
          />
          <span className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()}
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href="/" className="hover:text-foreground transition-colors">
            Home
          </a>
          <a href="/docs" className="hover:text-foreground transition-colors">
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
        </div>
      </div>
    </footer>
  );
}

// ─── Page ────────────────────────────────────────────────

export default function SourcePage() {
  return (
    <main className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      <style jsx global>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <StickyTopBar />
      <HeroSection />
      <TableOfContents />
      {/* Value sections first */}
      <ClaudeMdSection />
      <div className="border-t border-surface-2" />
      <SubagentsSection />
      <div className="border-t border-surface-2" />
      <ContextSection />
      <div className="border-t border-surface-2" />
      <HooksSection />
      <div className="border-t border-surface-2" />
      {/* Then the discovery sections */}
      <HiddenFeatures />
      <div className="border-t border-surface-2" />
      <CommandsSection />
      <div className="border-t border-surface-2" />
      <EnvVarsSection />
      <div className="border-t border-surface-2" />
      <CostSection />
      <div className="border-t border-surface-2" />
      <ToolLimitsSection />
      <div className="border-t border-surface-2" />
      {/* Fun/viral sections last */}
      <UndercoverSection />
      <div className="border-t border-surface-2" />
      <BuddySection />
      <div className="border-t border-surface-2" />
      <SpinnerSection />
      <div className="border-t border-surface-2" />
      <FinalCTA />
      <Footer />
    </main>
  );
}
