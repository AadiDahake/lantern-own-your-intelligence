/**
 * The Reflex API, https://reflex.runloop.ai/api, for the calls the forge engine makes.
 *
 * Shapes follow the public OpenAPI document (`runloopai/reflex-os`, `openapi/openapi.public.json`,
 * version 1.0.0): personas are read and launched by id, an agent has a `devboxId` and a
 * `tunnelKey`, its events are read by sequence from `/agents/{id}/stream`, and a snapshot of its
 * disk ends the run and seeds the next launch. Every call carries the organization header.
 */

export type ReflexAgentStatus =
  | "starting"
  | "running"
  | "needs_input"
  | "completed"
  | "interrupted"
  | "stopping"
  | "stopped"
  | "error"
  | "terminated";

export type ReflexAgent = {
  id: string;
  streamId: string;
  agentType: string;
  status: ReflexAgentStatus;
  turnState: "working" | "idle" | null;
  devboxId: string | null;
  tunnelKey: string | null;
  name: string;
  personaId: string | null;
  model: string | null;
  prUrl: string | null;
  daemons: { name: string; port: number; url: string; info?: string }[] | null;
};

export type ReflexPersona = {
  id: string;
  name: string;
  agentType: string;
  systemPrompt: string | null;
  model: string | null;
  blueprintName: string | null;
  sandboxOptions: { resourceSize?: string | null; snapshotId?: string | null } | null;
  promptMode: "implement" | "plan" | "review" | null;
  defaultPrompt: string | null;
};

export type ReflexEvent = {
  id: string;
  sequence?: number;
  streamId: string;
  type: string;
  payload: unknown;
  timestamp: number;
  origin?: string;
  source?: string;
};

export type ReflexSnapshot = { id: string; name: string; sourceDevboxId: string; sourceAgentId?: string };

export type ReflexSnapshotStatus = {
  status: "in_progress" | "error" | "complete" | "deleted";
  errorMessage?: string;
  snapshot?: ReflexSnapshot;
};

export type LaunchPersonaInput = {
  prompt: string;
  promptStrategy?: "prepend-default" | "replace";
  name?: string;
  promptMode?: "implement" | "plan" | "review";
  repoSlug?: string;
  repoBranch?: string;
  extraEnvVars?: { key: string; value?: string; secretRef?: string; isSecret?: boolean }[];
  sandboxOptions?: {
    snapshotId?: string | null;
    resourceSize?: "SMALL" | "MEDIUM" | "LARGE" | "X_LARGE" | "XX_LARGE" | null;
    idleTimeMinutes?: number | null;
    blueprintName?: string | null;
  };
};

export class ReflexError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ReflexError";
  }
}

export type ReflexClientOptions = {
  apiKey: string;
  organizationId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAgent(value: unknown): ReflexAgent {
  if (!isRecord(value) || typeof value.id !== "string") throw new ReflexError("Reflex returned no agent.", 502);
  return {
    id: value.id,
    streamId: String(value.streamId ?? ""),
    agentType: String(value.agentType ?? ""),
    status: String(value.status ?? "starting") as ReflexAgentStatus,
    turnState: value.turnState === "working" || value.turnState === "idle" ? value.turnState : null,
    devboxId: typeof value.devboxId === "string" ? value.devboxId : null,
    tunnelKey: typeof value.tunnelKey === "string" ? value.tunnelKey : null,
    name: String(value.name ?? ""),
    personaId: typeof value.personaId === "string" ? value.personaId : null,
    model: typeof value.model === "string" ? value.model : null,
    prUrl: typeof value.prUrl === "string" ? value.prUrl : null,
    daemons: Array.isArray(value.daemons) ? (value.daemons as ReflexAgent["daemons"]) : null,
  };
}

function toPersona(value: unknown): ReflexPersona {
  if (!isRecord(value) || typeof value.id !== "string") throw new ReflexError("Reflex returned no persona.", 502);
  return {
    id: value.id,
    name: String(value.name ?? ""),
    agentType: String(value.agentType ?? ""),
    systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt : null,
    model: typeof value.model === "string" ? value.model : null,
    blueprintName: typeof value.blueprintName === "string" ? value.blueprintName : null,
    sandboxOptions: isRecord(value.sandboxOptions) ? (value.sandboxOptions as ReflexPersona["sandboxOptions"]) : null,
    promptMode:
      value.promptMode === "implement" || value.promptMode === "plan" || value.promptMode === "review"
        ? value.promptMode
        : null,
    defaultPrompt: typeof value.defaultPrompt === "string" ? value.defaultPrompt : null,
  };
}

function toEvents(value: unknown): ReflexEvent[] {
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.events) ? value.events : [];
  return list.filter((event): event is ReflexEvent => isRecord(event) && typeof event.type === "string");
}

export class ReflexClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ReflexClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://reflex.runloop.ai/api").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "x-organization-id": this.options.organizationId,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new ReflexError(`Reflex answered ${response.status} to ${method} ${path}. ${text.slice(0, 300)}`.trim(), response.status);
    }
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, data: data as T };
  }

  async listPersonas(): Promise<ReflexPersona[]> {
    const { data } = await this.request<unknown[]>("GET", "/agent-personas");
    return (Array.isArray(data) ? data : []).map(toPersona);
  }

  async getPersona(id: string): Promise<ReflexPersona> {
    return toPersona((await this.request<unknown>("GET", `/agent-personas/${id}`)).data);
  }

  /** Starts an agent from a persona, with the run's prompt and sandbox layered on top. */
  async launchPersona(id: string, input: LaunchPersonaInput): Promise<ReflexAgent> {
    return toAgent((await this.request<unknown>("POST", `/agent-personas/${id}/launch`, input)).data);
  }

  async getAgent(id: string): Promise<ReflexAgent> {
    return toAgent((await this.request<unknown>("GET", `/agents/${id}`)).data);
  }

  /** The agent's events from `fromSeq` on, oldest first. */
  async streamEvents(id: string, fromSeq = 0): Promise<ReflexEvent[]> {
    const { data } = await this.request<unknown>("GET", `/agents/${id}/stream?fromSeq=${fromSeq}`);
    return toEvents(data).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }

  /** Sends one chat message. Returns the acknowledging event, or the pending command id. */
  async sendMessage(id: string, message: string): Promise<{ pending: boolean; commandId: string | null }> {
    const { status, data } = await this.request<Record<string, unknown>>("POST", `/agents/${id}/message`, { message });
    if (status === 202) return { pending: true, commandId: String((data as { commandId?: string }).commandId ?? "") };
    return { pending: false, commandId: null };
  }

  async stopAgent(id: string): Promise<void> {
    await this.request("POST", `/agents/${id}/stop`);
  }

  async completeAgent(id: string): Promise<void> {
    await this.request("POST", `/agents/${id}/complete`);
  }

  async devboxStatus(id: string): Promise<unknown> {
    return (await this.request<unknown>("GET", `/agents/${id}/devbox-status`)).data;
  }

  async devboxLogs(id: string): Promise<unknown> {
    return (await this.request<unknown>("GET", `/agents/${id}/devbox-logs`)).data;
  }

  async servicesStatus(id: string): Promise<{ id: string; label?: string; port?: number; status: string; running?: boolean }[]> {
    const { data } = await this.request<{ services?: unknown[] }>("GET", `/agents/${id}/services/status`);
    return (Array.isArray(data?.services) ? data.services : []) as {
      id: string;
      label?: string;
      port?: number;
      status: string;
      running?: boolean;
    }[];
  }

  /** Ends the agent's run and captures its disk. Poll `snapshotStatus` until complete. */
  async snapshotAgent(id: string, name: string, commitMessage?: string): Promise<ReflexSnapshot> {
    const { data } = await this.request<ReflexSnapshot>("POST", `/agents/${id}/snapshots`, {
      name,
      ...(commitMessage ? { commitMessage } : {}),
    });
    if (!isRecord(data) || typeof data.id !== "string") throw new ReflexError("Reflex returned no snapshot.", 502);
    return data;
  }

  async snapshotStatus(id: string): Promise<ReflexSnapshotStatus> {
    return (await this.request<ReflexSnapshotStatus>("GET", `/snapshots/${id}/status`)).data;
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.request("DELETE", `/snapshots/${id}`);
  }
}

/** Fields of an untyped payload worth a trace title, in order of preference. */
const TEXT_KEYS = ["message", "text", "command", "name", "tool", "title", "summary", "content", "output", "result"];

/** The most descriptive string in an event payload, for a trace title. */
export function payloadText(payload: unknown, depth = 0): string | null {
  if (typeof payload === "string") return payload;
  if (!isRecord(payload) || depth > 3) return null;
  for (const key of TEXT_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  for (const key of TEXT_KEYS) {
    const nested = payloadText(payload[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}
