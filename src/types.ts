// GitLab REST API 응답을 다룰 때 필요한 최소한의 필드만 정의합니다.
// (전체 스펙은 https://docs.gitlab.com/ee/api/ 참고)

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  author: GitLabUser;
  target_branch: string;
  source_branch: string;
  web_url: string;
}

export interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: GitLabUser;
  created_at: string;
  system: boolean; // true면 GitLab이 자동 생성한 시스템 메모 (예: "added 3 commits")
  resolvable?: boolean;
  resolved?: boolean;
}

export interface GitLabDiscussion {
  id: string;
  notes: GitLabNote[];
}

export interface GitLabPipeline {
  id: number;
  status: string; // success | failed | canceled | running | pending | skipped | manual ...
  created_at: string;
  updated_at: string;
  ref: string;
}

export interface GitLabMRChangeFile {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
}

export interface GitLabMRChanges {
  changes: GitLabMRChangeFile[];
}

// ---- 내부적으로 가공해서 사용하는 구조 ----

export interface EnrichedMR {
  mr: GitLabMergeRequest;
  commits: GitLabCommit[];
  discussions: GitLabDiscussion[];
  pipelines: GitLabPipeline[];
  changes: GitLabMRChangeFile[];
  pushCount: number; // MR 생성 후 추가로 push된 횟수 (재작업/수정 신호)
  postReviewPushCount: number; // 첫 리뷰어 코멘트 이후 push된 횟수 (리뷰 반영 재작업 신호)
  additions: number;
  deletions: number;
}

export interface DeveloperScoreBreakdown {
  lowReReview: number | null; // 0~100, 리뷰 스레드 데이터 없으면 null (재논의가 적을수록 높음)
  pipelineFirstTry: number | null; // 0~100, 파이프라인 데이터 없으면 null
  lowCommentDensity: number | null; // 0~100, 변경 라인 데이터 없으면 null
  lowUnresolvedComments: number | null; // 0~100, 변경 라인 데이터 없으면 null
  lowRevertRatio: number; // 0~100, 높을수록 좋음
  lowOversizedMRRatio: number; // 0~100, 대형 MR 비율이 낮을수록 높음
  testChangeCoverage: number | null; // 0~100, 변경 라인 데이터 없으면 null
}

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface DeveloperMetrics {
  username: string;
  name: string;
  totalMRs: number;
  mergedMRs: number;
  closedWithoutMerge: number;
  mergeRate: number; // mergedMRs / totalMRs

  totalLinesChanged: number;
  avgLinesChangedPerMR: number;
  effectiveWorkloadLinesChanged: number; // 작업량 점수에 실제 반영한 변경 라인 수
  initLikeMRs: number; // 초기 구축/스캐폴딩 성격으로 라인 기여도를 낮춘 MR 수
  initLikeLinesChanged: number; // 초기 구축/스캐폴딩 성격 MR의 원본 변경 라인 수

  totalReviewComments: number;
  avgReviewCommentsPerMR: number; // 본인 제외, 타인이 남긴 코멘트 평균
  reviewCommentsPer100Lines: number; // 코드량 대비 코멘트 밀도
  unresolvedReviewComments: number; // 본인 제외, 미해결 상태의 resolvable 코멘트 수
  unresolvedReviewCommentsPer100Lines: number;

  totalPushCount: number;
  avgPushCountPerMR: number; // 평균 추가 push 횟수
  totalPostReviewPushCount: number;
  avgPostReviewPushCountPerMR: number; // 첫 리뷰어 코멘트 이후 평균 추가 push 횟수 (참고용)

  totalReviewThreads: number; // 리뷰어가 코멘트한 스레드 수
  reReviewedThreads: number; // 첫 수정이 부족해 리뷰어가 다시 지적한 스레드 수
  reReviewedThreadRatio: number; // reReviewedThreads / totalReviewThreads (점수 반영, 낮을수록 좋음)

  pipelineEvaluatedMRs: number; // 파이프라인 데이터가 있어 first try 평가가 가능한 MR 수
  pipelineMissingMRs: number;
  pipelineCoverageRate: number; // pipelineEvaluatedMRs / totalMRs
  pipelineFirstTrySuccessRate: number; // 첫 파이프라인이 success였던 비율

  totalCommits: number;
  revertCommits: number;
  revertCommitRatio: number; // revert/hotfix/rollback 성격 커밋 비율

  oversizedMRs: number; // 변경 라인 수가 기준을 넘는 MR 수
  oversizedMRRatio: number;

  totalTestLinesChanged: number;
  testChangeRatio: number; // 테스트 변경 라인 / 전체 변경 라인

  avgHoursToMerge: number | null;

  scoreBreakdown: DeveloperScoreBreakdown;
  scoreCoverageRate: number; // 실제 점수 산정에 사용된 가중치 비율. 1에 가까울수록 데이터가 충분함
  confidenceScore: number; // 표본 수와 데이터 커버리지를 반영한 신뢰도 점수
  confidenceLevel: ConfidenceLevel;
  workloadScore: number; // 같은 리포트 내 작업량 상대 점수(MR 수 + 변경 라인)
  platformReadinessScore: number; // 품질 점수와 작업량 점수를 함께 본 선별용 점수
  dataWarnings: string[];

  qualityScore: number; // 0~100, metrics.ts의 가중치 기반 산출
}
