import { NextRequest, NextResponse } from "next/server";

// Google Apps Script Web App URL - set this in your environment
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// Validate email format properly
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

// Get geolocation from IP using free ip-api.com service
async function getGeoLocation(ip: string): Promise<{ country: string; city: string }> {
  try {
    // Skip for localhost/private IPs
    if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
      return { country: "Unknown", city: "Unknown" };
    }

    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city`, {
      // Short timeout to not block the request
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return { country: "Unknown", city: "Unknown" };
    }

    const data = await response.json();
    
    if (data.status === "success") {
      return {
        country: data.country || "Unknown",
        city: data.city || "Unknown",
      };
    }

    return { country: "Unknown", city: "Unknown" };
  } catch (error) {
    console.error("Geolocation error:", error);
    return { country: "Unknown", city: "Unknown" };
  }
}

// Get client IP from request headers
function getClientIP(request: NextRequest): string {
  // Try various headers that might contain the real IP
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwardedFor.split(",")[0].trim();
  }

  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }

  // Netlify specific
  const netlifyIP = request.headers.get("x-nf-client-connection-ip");
  if (netlifyIP) {
    return netlifyIP;
  }

  // Vercel specific
  const vercelIP = request.headers.get("x-vercel-forwarded-for");
  if (vercelIP) {
    return vercelIP.split(",")[0].trim();
  }

  return "";
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    // Validate email format properly (prevents spam like "a@b" or "test@test")
    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    // Get client IP and geolocation
    const clientIP = getClientIP(request);
    const { country, city } = await getGeoLocation(clientIP);

    // If Google Script URL is not configured, store locally (for testing)
    if (!GOOGLE_SCRIPT_URL) {
      console.log("Waitlist signup (no Google Script configured):", {
        email,
        country,
        city,
        ip: clientIP,
      });
      return NextResponse.json({
        success: true,
        message: "Email recorded (dev mode)",
      });
    }

    // Send to Google Sheets via Apps Script
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        timestamp: new Date().toISOString(),
        source: "broski-website",
        country,
        city,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to save to Google Sheets");
    }

    return NextResponse.json({
      success: true,
      message: "Successfully joined the waitlist!",
    });
  } catch (error) {
    console.error("Waitlist error:", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
