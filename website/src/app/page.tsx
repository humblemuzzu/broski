"use client";

import { useState } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaitlistProgress } from "@/components/waitlist-progress";
import { ThemeSwitcher } from "@/components/theme-switcher";

// Email validation regex - checks for proper format
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

// Fire confetti celebration
const fireConfetti = () => {
  const duration = 3000;
  const end = Date.now() + duration;

  const colors = ["#fab283", "#56b6c2", "#7fd88f", "#ffffff"];

  (function frame() {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: colors,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: colors,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();
};

export default function Home() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate email format properly
    if (!email || !isValidEmail(email)) {
      setStatus("error");
      setMessage("Please enter a valid email address");
      return;
    }

    setStatus("loading");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus("success");
        setMessage("You're on the list! We'll be in touch soon.");
        setEmail("");
        // Fire confetti celebration!
        fireConfetti();
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  };

  return (
    <main className="min-h-screen flex flex-col bg-background">
      {/* Theme Switcher */}
      <ThemeSwitcher />
      
      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-12 sm:py-20 md:py-32">
        <div className="w-full max-w-3xl mx-auto text-center space-y-6 sm:space-y-8">
          {/* Logo */}
          <div className="animate-fade-in">
            <Image
              src="/broski-logo.png"
              alt="Broski"
              width={220}
              height={72}
              className="mx-auto"
              priority
            />
          </div>

          {/* Tagline */}
          <p className="text-muted-foreground text-sm tracking-widest uppercase animate-fade-in-delay-1">
            Your AI Coding Companion
          </p>

          {/* Main Headline */}
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-semibold tracking-tight leading-tight animate-fade-in-delay-2">
            Vibe code from anywhere.
            <br />
            <span className="text-primary">An IDE in your pocket.</span>
          </h1>

          {/* Subheadline */}
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-xl mx-auto px-2 animate-fade-in-delay-3">
            The mobile-first interface for Claude Code, OpenCode, and beyond. 
            Ship code while away from your desk.
          </p>

          {/* Email Form */}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 w-full max-w-md mx-auto mt-6 sm:mt-8 animate-fade-in-delay-3"
          >
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-14 sm:h-12 text-base bg-card border-border/50 placeholder:text-muted-foreground/60 focus-visible:ring-primary/50"
              disabled={status === "loading"}
            />
            <Button
              type="submit"
              size="lg"
              className="w-full h-14 sm:h-12 px-8 font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
              disabled={status === "loading"}
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
                  Join waitlist
                  <svg
                    className="w-4 h-4 ml-1"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>
                </>
              )}
            </Button>
          </form>

          {/* Status Message */}
          {message && (
            <p
              className={`text-sm ${
                status === "success" ? "text-foreground" : "text-destructive"
              }`}
            >
              {message}
            </p>
          )}

          {/* Waitlist Progress Bar */}
          <div className="mt-12 animate-fade-in-delay-3">
            <WaitlistProgress goal={10000} refreshInterval={30000} />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 border-t border-border/30">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-center text-xl sm:text-2xl md:text-3xl font-semibold mb-10 sm:mb-16">
            Everything you need, <span className="text-primary">nothing you don&apos;t</span>
          </h2>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 md:gap-12">
            {/* Feature 1 */}
            <div className="space-y-4 text-center md:text-left">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto md:mx-0">
                <svg
                  className="w-6 h-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium">Mobile Native</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Built for touch. Swipe through sessions, tap to approve changes, 
                and stay productive on the go.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="space-y-4 text-center md:text-left">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto md:mx-0">
                <svg
                  className="w-6 h-6 text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium">Multiple Backends</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Connect to Claude Code, OpenCode, or your own setup. 
                One interface, many possibilities.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="space-y-4 text-center md:text-left">
              <div className="w-12 h-12 rounded-xl bg-[#7fd88f]/10 flex items-center justify-center mx-auto md:mx-0">
                <svg
                  className="w-6 h-6 text-[#7fd88f]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium">Privacy First</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Your code stays yours. Direct connections to your machines, 
                no cloud middleman required.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 sm:py-8 px-4 sm:px-6 border-t border-border/30">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Image
              src="/broski-logo.png"
              alt="Broski"
              width={80}
              height={24}
              className="opacity-60"
            />
          </div>
          <p className="text-xs text-muted-foreground/60">
            Built for developers, by developers
          </p>
        </div>
      </footer>
    </main>
  );
}
