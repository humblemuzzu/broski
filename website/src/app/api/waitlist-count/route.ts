import { NextResponse } from "next/server";

const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;

// Cache the count for 30 seconds to reduce calls to Convex
let cachedCount: number | null = null;
let cacheTime: number = 0;
const CACHE_DURATION = 30 * 1000; // 30 seconds

export async function GET() {
  try {
    // Return cached value if fresh
    const now = Date.now();
    if (cachedCount !== null && now - cacheTime < CACHE_DURATION) {
      return NextResponse.json({
        success: true,
        count: cachedCount,
        cached: true,
      });
    }

    if (!CONVEX_SITE_URL) {
      return NextResponse.json({ success: true, count: 0, dev: true });
    }

    // Fetch count from Convex
    const response = await fetch(`${CONVEX_SITE_URL}/waitlist/count`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch count from backend");
    }

    const data = await response.json();

    // Update cache
    cachedCount = data.count || 0;
    cacheTime = now;

    return NextResponse.json({
      success: true,
      count: cachedCount,
      cached: false,
    });
  } catch (error) {
    console.error("Waitlist count error:", error);

    // Return cached value on error if available
    if (cachedCount !== null) {
      return NextResponse.json({
        success: true,
        count: cachedCount,
        cached: true,
        stale: true,
      });
    }

    return NextResponse.json(
      { success: false, error: "Failed to get count", count: 0 },
      { status: 500 }
    );
  }
}
