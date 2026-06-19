import type {
  GitLabMergeRequest,
  GitLabCommit,
  GitLabDiscussion,
  GitLabPipeline,
  GitLabMRChanges,
} from './types.js';

export interface GitLabConfig {
  baseUrl: string; // 예: https://gitlab.com 또는 사내 self-hosted GitLab URL
  token: string; // Personal/Project Access Token (api scope 필요)
}

// GitLab API는 한 번에 최대 100개까지 반환하며, Link 헤더로 다음 페이지를 안내합니다.
// 이 함수는 모든 페이지를 순회해서 전체 결과를 합쳐줍니다.
async function fetchAllPages<T>(
  config: GitLabConfig,
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = new URL(`${config.baseUrl}/api/v4${path}`);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      headers: { 'PRIVATE-TOKEN': config.token },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `GitLab API 호출 실패 (${res.status} ${res.statusText}): ${url.pathname} ${body}`,
      );
    }

    const data = (await res.json()) as T[];
    results.push(...data);

    const nextPage = res.headers.get('x-next-page');
    if (!nextPage) break;
    page = Number(nextPage);
  }

  return results;
}

async function fetchOne<T>(config: GitLabConfig, path: string): Promise<T> {
  const res = await fetch(`${config.baseUrl}/api/v4${path}`, {
    headers: { 'PRIVATE-TOKEN': config.token },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitLab API 호출 실패 (${res.status} ${res.statusText}): ${path} ${body}`);
  }
  return (await res.json()) as T;
}

export async function fetchMergeRequests(
  config: GitLabConfig,
  projectId: string,
  opts: { since?: string; until?: string },
): Promise<GitLabMergeRequest[]> {
  const params: Record<string, string> = {
    state: 'all',
    scope: 'all',
    order_by: 'created_at',
    sort: 'asc',
  };
  if (opts.since) params.created_after = opts.since;
  if (opts.until) params.created_before = opts.until;

  return fetchAllPages<GitLabMergeRequest>(
    config,
    `/projects/${encodeURIComponent(projectId)}/merge_requests`,
    params,
  );
}

export async function fetchMRCommits(
  config: GitLabConfig,
  projectId: string,
  mrIid: number,
): Promise<GitLabCommit[]> {
  return fetchAllPages<GitLabCommit>(
    config,
    `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/commits`,
  );
}

export async function fetchMRDiscussions(
  config: GitLabConfig,
  projectId: string,
  mrIid: number,
): Promise<GitLabDiscussion[]> {
  return fetchAllPages<GitLabDiscussion>(
    config,
    `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/discussions`,
  );
}

export async function fetchMRPipelines(
  config: GitLabConfig,
  projectId: string,
  mrIid: number,
): Promise<GitLabPipeline[]> {
  return fetchAllPages<GitLabPipeline>(
    config,
    `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/pipelines`,
  );
}

export async function fetchMRChanges(
  config: GitLabConfig,
  projectId: string,
  mrIid: number,
): Promise<GitLabMRChanges> {
  return fetchOne<GitLabMRChanges>(
    config,
    `/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/changes`,
  );
}

// 동시에 너무 많은 요청을 보내면 GitLab Rate Limit(429)에 걸릴 수 있어
// 간단한 동시성 제한(semaphore)을 둡니다.
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const run = queue.shift()!;
    run();
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
