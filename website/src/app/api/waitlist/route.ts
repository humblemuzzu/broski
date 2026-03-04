import { NextRequest, NextResponse } from "next/server";

const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
const WAITLIST_API_KEY = process.env.WAITLIST_API_KEY;

// Validate email format
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) && email.length <= 254;
};

// ─── IP rate limiting ──────────────────────────────────────────────────────
const RATE_LIMIT_MAX = 3; // max submissions per window
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const ipSubmissions = new Map<string, number[]>();

// Cleanup stale entries every 5 minutes
let lastCleanup = Date.now();
function cleanupStaleEntries() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) return;
  lastCleanup = now;
  for (const [ip, timestamps] of ipSubmissions.entries()) {
    const valid = timestamps.filter((t) => t > now - RATE_LIMIT_WINDOW_MS);
    if (valid.length === 0) {
      ipSubmissions.delete(ip);
    } else {
      ipSubmissions.set(ip, valid);
    }
  }
}

function isIpRateLimited(ip: string): boolean {
  if (!ip) return false; // can't rate limit without IP
  cleanupStaleEntries();
  const now = Date.now();
  const timestamps = (ipSubmissions.get(ip) ?? []).filter(
    (t) => t > now - RATE_LIMIT_WINDOW_MS,
  );
  return timestamps.length >= RATE_LIMIT_MAX;
}

function recordIpSubmission(ip: string): void {
  if (!ip) return;
  const now = Date.now();
  const timestamps = (ipSubmissions.get(ip) ?? []).filter(
    (t) => t > now - RATE_LIMIT_WINDOW_MS,
  );
  timestamps.push(now);
  ipSubmissions.set(ip, timestamps);
}

// ─── Geolocation ───────────────────────────────────────────────────────────

async function getGeoLocation(ip: string): Promise<{ country: string; city: string }> {
  try {
    if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
      return { country: "Unknown", city: "Unknown" };
    }
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { country: "Unknown", city: "Unknown" };
    const data = await response.json();
    if (data.status === "success") {
      return {
        country: data.country || "Unknown",
        city: data.city || "Unknown",
      };
    }
    return { country: "Unknown", city: "Unknown" };
  } catch {
    return { country: "Unknown", city: "Unknown" };
  }
}

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIP = request.headers.get("x-real-ip");
  if (realIP) return realIP;
  const netlifyIP = request.headers.get("x-nf-client-connection-ip");
  if (netlifyIP) return netlifyIP;
  const vercelIP = request.headers.get("x-vercel-forwarded-for");
  if (vercelIP) return vercelIP.split(",")[0].trim();
  return "";
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    if (!CONVEX_SITE_URL) {
      console.error("CONVEX_SITE_URL not configured");
      return NextResponse.json(
        { success: false, error: "Server configuration error" },
        { status: 500 },
      );
    }

    const clientIP = getClientIP(request);

    // IP rate limit
    if (isIpRateLimited(clientIP)) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const { email } = await request.json();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid email address" },
        { status: 400 },
      );
    }

    const { country, city } = await getGeoLocation(clientIP);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (WAITLIST_API_KEY) {
      headers["X-Waitlist-Key"] = WAITLIST_API_KEY;
    }

    const response = await fetch(`${CONVEX_SITE_URL}/waitlist/join`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        source: "broski-website",
        country,
        city,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => null);
      const errMsg = errData?.error || "Something went wrong. Please try again.";
      return NextResponse.json(
        { success: false, error: errMsg },
        { status: response.status >= 500 ? 500 : response.status },
      );
    }

    const data = await response.json();

    // Only record successful submissions for rate limiting
    if (data.ok && data.message !== "You're already on the waitlist!") {
      recordIpSubmission(clientIP);
    }

    return NextResponse.json({
      success: data.ok,
      message: data.message || "Successfully joined the waitlist!",
    });
  } catch (error) {
    console.error("Waitlist error:", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
