/**
 * GitHub, through the REST API and one GraphQL mutation.
 *
 * `GithubClient` is bound to one token and knows nothing about projects. The exported functions
 * resolve the project's token first (the linked account's, else the server credential) and are
 * what the console routes call. The forge engine builds a client from the token it was given, so
 * a command-line run needs no database to open a pull request.
 */
import { activeGithubToken } from "./github/connection";

export type GithubRepository = {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  updatedAt: string | null;
};

type RepoPayload = {
  id: number;
  full_name: string;
  name: string;
  owner?: { login?: string };
  private: boolean;
  default_branch?: string;
  description?: string | null;
  html_url: string;
  updated_at?: string | null;
};

export type PullRequest = {
  number: number;
  url: string;
  nodeId: string;
  draft: boolean;
  state: string;
  /** Null while GitHub is still computing it. */
  mergeable: boolean | null;
  mergeableState: string | null;
  headSha: string;
};

type PullPayload = {
  number: number;
  html_url: string;
  node_id: string;
  draft?: boolean;
  state: string;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  head?: { sha?: string };
};

const API = "https://api.github.com";
const GRAPHQL = "https://api.github.com/graphql";

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

function toRepository(payload: RepoPayload): GithubRepository {
  return {
    id: payload.id,
    fullName: payload.full_name,
    owner: payload.owner?.login ?? payload.full_name.split("/")[0] ?? "",
    name: payload.name,
    private: Boolean(payload.private),
    defaultBranch: payload.default_branch ?? "main",
    description: payload.description ?? null,
    htmlUrl: payload.html_url,
    updatedAt: payload.updated_at ?? null,
  };
}

function toPullRequest(payload: PullPayload): PullRequest {
  return {
    number: payload.number,
    url: payload.html_url,
    nodeId: payload.node_id,
    draft: Boolean(payload.draft),
    state: payload.state,
    mergeable: payload.mergeable ?? null,
    mergeableState: payload.mergeable_state ?? null,
    headSha: payload.head?.sha ?? "",
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class GithubClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(path.startsWith("http") ? path : `${API}${path}`, {
      method,
      headers: { ...this.headers(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new GithubError(
        `GitHub answered ${response.status} to ${method} ${path}. ${detail.slice(0, 300)}`.trim(),
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Every repository the token can reach, newest activity first. */
  async listRepositories(): Promise<GithubRepository[]> {
    const collected: GithubRepository[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const payload = await this.request<RepoPayload[]>(
        "GET",
        `/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&page=${page}`,
      ).catch((error: GithubError) => {
        throw new Error(`GitHub rejected the repository list (${error.status}). ${error.message}`);
      });
      collected.push(...payload.map(toRepository));
      if (payload.length < 100) break;
    }
    return collected;
  }

  /** What GitHub knows about `owner/name`, or null when the token cannot see it. */
  async getRepository(fullName: string): Promise<GithubRepository | null> {
    try {
      return toRepository(await this.request<RepoPayload>("GET", `/repos/${fullName}`));
    } catch (error) {
      if (error instanceof GithubError && (error.status === 404 || error.status === 403)) return null;
      throw new Error(`GitHub rejected the repository check (${(error as GithubError).status}).`);
    }
  }

  async openDraftPullRequest(
    fullName: string,
    input: { title: string; body: string; head: string; base: string },
  ): Promise<PullRequest> {
    return toPullRequest(
      await this.request<PullPayload>("POST", `/repos/${fullName}/pulls`, { ...input, draft: true }),
    );
  }

  async getPullRequest(fullName: string, number: number): Promise<PullRequest> {
    return toPullRequest(await this.request<PullPayload>("GET", `/repos/${fullName}/pulls/${number}`));
  }

  /** The open pull request whose head is `branch`, or null. */
  async findOpenPullRequest(fullName: string, owner: string, branch: string): Promise<PullRequest | null> {
    const pulls = await this.request<PullPayload[]>(
      "GET",
      `/repos/${fullName}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    return pulls[0] ? toPullRequest(pulls[0]) : null;
  }

  /** Turns a draft into a reviewable pull request. Returns true when it is no longer a draft. */
  async markReadyForReview(nodeId: string): Promise<boolean> {
    const response = await this.fetchImpl(GRAPHQL, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        query: `mutation($id: ID!) {
          markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } }
        }`,
        variables: { id: nodeId },
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { markPullRequestReadyForReview?: { pullRequest?: { isDraft?: boolean } } };
      errors?: { message: string }[];
    };
    if (!response.ok || payload.errors?.length) {
      throw new GithubError(
        `GitHub could not mark the pull request ready. ${payload.errors?.map((e) => e.message).join("; ") ?? ""}`.trim(),
        response.status,
      );
    }
    return payload.data?.markPullRequestReadyForReview?.pullRequest?.isDraft === false;
  }

  /** GitHub computes `mergeable` lazily. Polls until it is known, then refuses a false. */
  async waitUntilMergeable(
    fullName: string,
    number: number,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<PullRequest> {
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    let pull = await this.getPullRequest(fullName, number);
    while (pull.mergeable === null && Date.now() < deadline) {
      await sleep(options.intervalMs ?? 3_000);
      pull = await this.getPullRequest(fullName, number);
    }
    if (pull.mergeable === false) {
      throw new Error(`Pull request #${number} is not mergeable (${pull.mergeableState ?? "unknown"}).`);
    }
    return pull;
  }

  /** Squash-merges and returns the merge commit sha. */
  async mergeSquash(fullName: string, number: number, title: string, message = ""): Promise<string> {
    const result = await this.request<{ sha: string }>("PUT", `/repos/${fullName}/pulls/${number}/merge`, {
      merge_method: "squash",
      commit_title: title,
      commit_message: message,
    });
    return result.sha;
  }

  async comment(fullName: string, number: number, body: string): Promise<void> {
    await this.request("POST", `/repos/${fullName}/issues/${number}/comments`, { body });
  }

  async closePullRequest(fullName: string, number: number, comment?: string): Promise<void> {
    if (comment) await this.comment(fullName, number, comment);
    await this.request("PATCH", `/repos/${fullName}/pulls/${number}`, { state: "closed" });
  }
}

/** A client on the token every GitHub call for this project should use. */
export async function githubClientFor(projectId: string): Promise<GithubClient> {
  return new GithubClient(await activeGithubToken(projectId));
}

/**
 * Every repository this project's token can reach, newest activity first.
 *
 * A fine-grained token scoped to a single repository returns exactly that one, which is the honest
 * answer: the list is what Lantern is actually allowed to open issues and pull requests in.
 */
export async function listRepositories(projectId: string): Promise<GithubRepository[]> {
  return (await githubClientFor(projectId)).listRepositories();
}

/** Confirms the token can read `owner/name`, and returns what GitHub knows about it. */
export async function getRepository(
  projectId: string,
  fullName: string,
): Promise<GithubRepository | null> {
  return (await githubClientFor(projectId)).getRepository(fullName);
}
