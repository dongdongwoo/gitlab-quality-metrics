import 'dotenv/config';
import { parseArgs } from 'node:util';
import {
  fetchMergeRequests,
  fetchMRCommits,
  fetchMRDiscussions,
  fetchMRPipelines,
  fetchMRChanges,
  createLimiter,
  type GitLabConfig,
} from './gitlabClient.js';
import { sumChanges, countPushEvents, countPostReviewPushEvents } from './metrics.js';
import { aggregateDeveloperMetrics } from './metrics.js';
import { printConsoleTable, writeCsv, writeJson } from './output.js';
import { filterOutBranchPattern } from './branchFilter.js';
import type { EnrichedMR } from './types.js';

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      projects: { type: 'string' }, // 쉼표로 구분된 project ID 또는 "group/project" 경로
      since: { type: 'string' }, // ISO 날짜, 예: 2026-01-01
      until: { type: 'string' },
      authors: { type: 'string' }, // 쉼표로 구분된 username 필터 (선택)
      out: { type: 'string', default: 'report' }, // 출력 파일 접두사
      concurrency: { type: 'string', default: '5' },
      // 스프린트 통합 MR처럼 "여러 개발자 코드가 한꺼번에 섞이는" MR을 빼고 싶을 때 사용.
      // source_branch, target_branch 각각 정규식으로 매칭. 예:
      //   --exclude-source-pattern="^sprint\d+-dev$" --exclude-target-pattern="^dev$"
      'exclude-source-pattern': { type: 'string' },
      'exclude-target-pattern': { type: 'string' },
    },
  });
  return values;
}

async function main() {
  const args = parseCliArgs();

  const baseUrl = process.env.GITLAB_URL;
  const token = process.env.GITLAB_TOKEN;
  if (!baseUrl || !token) {
    console.error(
      'GITLAB_URL, GITLAB_TOKEN 환경변수가 필요합니다. .env.example을 참고해 .env 파일을 만들어주세요.',
    );
    process.exit(1);
  }
  if (!args.projects && !process.env.GITLAB_PROJECTS) {
    console.error(
      '프로젝트를 지정해야 합니다. --projects=123,456 옵션을 쓰거나, .env에 GITLAB_PROJECTS를 설정하세요.',
    );
    process.exit(1);
  }

  const projectsValue = args.projects ?? process.env.GITLAB_PROJECTS!;
  const config: GitLabConfig = { baseUrl, token };
  const projectIds = projectsValue.split(',').map((s) => s.trim());
  const authorFilter = args.authors ? new Set(args.authors.split(',').map((s) => s.trim())) : null;
  const limit = createLimiter(Number(args.concurrency ?? 5));

  const excludeSourcePattern = args['exclude-source-pattern']
    ? new RegExp(args['exclude-source-pattern'])
    : undefined;
  const excludeTargetPattern = args['exclude-target-pattern']
    ? new RegExp(args['exclude-target-pattern'])
    : undefined;

  const mrsByAuthor = new Map<string, EnrichedMR[]>();

  for (const projectId of projectIds) {
    console.log(`[${projectId}] MR 목록 조회 중...`);
    const mrs = await fetchMergeRequests(config, projectId, {
      since: args.since,
      until: args.until,
    });

    const afterAuthorFilter = authorFilter
      ? mrs.filter((m) => authorFilter.has(m.author.username))
      : mrs;

    const { kept: targetMRs, excludedCount } = filterOutBranchPattern(afterAuthorFilter, {
      sourcePattern: excludeSourcePattern,
      targetPattern: excludeTargetPattern,
    });
    if (excludedCount > 0) {
      console.log(`[${projectId}] 브랜치 패턴에 의해 ${excludedCount}개 MR 제외됨`);
    }

    console.log(`[${projectId}] 총 ${targetMRs.length}개 MR 상세 데이터 수집 중...`);

    let done = 0;
    await Promise.all(
      targetMRs.map((mr) =>
        limit(async () => {
          const [commits, discussions, pipelines, changesRes] = await Promise.all([
            fetchMRCommits(config, projectId, mr.iid),
            fetchMRDiscussions(config, projectId, mr.iid),
            fetchMRPipelines(config, projectId, mr.iid),
            fetchMRChanges(config, projectId, mr.iid).catch(() => ({ changes: [] })),
          ]);

          const { additions, deletions } = sumChanges(changesRes.changes ?? []);
          const enriched: EnrichedMR = {
            mr,
            commits,
            discussions,
            pipelines,
            changes: changesRes.changes ?? [],
            pushCount: countPushEvents(discussions),
            postReviewPushCount: countPostReviewPushEvents(discussions, mr.author.username),
            additions,
            deletions,
          };

          const list = mrsByAuthor.get(mr.author.username) ?? [];
          list.push(enriched);
          mrsByAuthor.set(mr.author.username, list);

          done++;
          if (done % 10 === 0) {
            console.log(`[${projectId}] ${done}/${targetMRs.length} 완료`);
          }
        }),
      ),
    );
  }

  const metrics = aggregateDeveloperMetrics(mrsByAuthor);

  printConsoleTable(metrics);

  const csvPath = `${args.out}.csv`;
  const jsonPath = `${args.out}.json`;
  writeCsv(metrics, csvPath);
  writeJson(metrics, jsonPath);
  console.log(`\n결과 저장 완료: ${csvPath}, ${jsonPath}`);
}

main().catch((err) => {
  console.error('실행 중 오류 발생:', err);
  process.exit(1);
});
