// SUBSCRIPTION USAGE TYPES

export type UsageWindow = {
	usedPercent: number; // 0-100
	resetsAt: number | null; // Unix timestamp (seconds)
	windowSeconds: number; // Window duration in seconds
};

export type ExtraUsage = {
	isEnabled: boolean;
	monthlyLimit: number | null;
	usedCredits: number | null;
	utilization: number | null; // 0-100
	currency: string;
	resetsAt: number | null;
};

export type Credits = {
	hasCredits: boolean;
	unlimited: boolean;
	balance: number | null;
};

export type ProviderUsage = {
	providerId: "claude" | "openai";
	providerName: string;
	plan: string | null;
	sessionWindow: UsageWindow | null;
	weeklyWindow: UsageWindow | null;
	weeklyOpusWindow: UsageWindow | null;
	weeklySonnetWindow: UsageWindow | null;
	extraUsage: ExtraUsage | null;
	credits: Credits | null;
	source: string;
	fetchedAt: number;
	error: string | null;
};

export type SubscriptionUsage = {
	providers: ProviderUsage[];
	fetchedAt: number;
};

// Subscription Usage Tracking
export type UsageClientMessage =
	| { type: "get_subscription_usage" }
	| { type: "get_provider_usage"; providerId: "claude" };

export type UsageServerMessage =
	| { type: "subscription_usage"; data: SubscriptionUsage; requestId?: string }
	| { type: "provider_usage"; data: ProviderUsage; requestId?: string };
