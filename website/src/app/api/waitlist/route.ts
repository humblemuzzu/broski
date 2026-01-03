import { NextRequest, NextResponse } from "next/server";

// Google Apps Script Web App URL - set this in your environment
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    // Validate email
    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { success: false, error: "Invalid email address" },
        { status: 400 }
      );
    }

    // If Google Script URL is not configured, store locally (for testing)
    if (!GOOGLE_SCRIPT_URL) {
      console.log("Waitlist signup (no Google Script configured):", email);
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
