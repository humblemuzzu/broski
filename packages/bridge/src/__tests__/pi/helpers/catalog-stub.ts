/**
 * Stands where pi.dev stands for a test: the catalogue server a network refresh asks (`/api/models/providers/<id>`).
 * It answers 404 (nothing newer than the models shipped with Pi) unless a test gave a provider a catalogue, and counts
 * what it was asked, so a test sees that a refresh went to it and nowhere else.
 */

export interface CatalogModel {
	readonly id: string;
	readonly name: string;
	readonly api: string;
	readonly baseUrl: string;
	readonly reasoning: boolean;
	readonly input: readonly string[];
	readonly cost: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
	};
	readonly contextWindow: number;
	readonly maxTokens: number;
}

export function catalogModel(id: string): CatalogModel {
	return {
		id,
		name: `Catalogue ${id}`,
		api: "openai-completions",
		baseUrl: "http://127.0.0.1:1/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4_096,
	};
}

export class CatalogStub {
	readonly asked: string[] = [];
	private readonly catalogues = new Map<string, readonly CatalogModel[]>();
	private readonly server: ReturnType<typeof Bun.serve>;

	private constructor() {
		this.server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request) => {
				const provider = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
				this.asked.push(provider);
				const models = this.catalogues.get(provider);
				if (models === undefined) return new Response("none", { status: 404 });
				return Response.json(
					{ models },
					{ headers: { "last-modified": new Date(Date.now() + 86_400_000).toUTCString() } },
				);
			},
		});
	}

	static start(): CatalogStub {
		return new CatalogStub();
	}

	get url(): string {
		return `http://127.0.0.1:${this.server.port}`;
	}

	/** The next network refresh reads these as the provider's newer catalogue. */
	publish(provider: string, models: readonly CatalogModel[]): void {
		this.catalogues.set(provider, models);
	}

	stop(): Promise<void> {
		return this.server.stop(true);
	}
}
