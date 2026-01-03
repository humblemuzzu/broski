import { NextResponse } from "next/server";

// Google Apps Script Web App URL - set this in your environment
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// Cache the count for 30 seconds to avoid hammering Google Sheets
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

    // If no Google Script URL, return mock data for development
    if (!GOOGLE_SCRIPT_URL) {
      const mockCount = 127; // Mock count for dev
      return NextResponse.json({
        success: true,
        count: mockCount,
        cached: false,
        dev: true,
      });
    }

    // Fetch count from Google Sheets via Apps Script
    const response = await fetch(`${GOOGLE_SCRIPT_URL}?action=count`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch from Google Sheets");
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
