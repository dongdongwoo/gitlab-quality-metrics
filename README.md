# gitlab-quality-metrics

GitLab의 MR(Merge Request) 데이터를 기반으로 개발자별 코드 퀄리티 지표를 뽑아주는 CLI 스크립트입니다.
외주/내부 개발자들의 작업물을 기간별로 비교 평가할 때 쓰는 걸 목표로 만들었습니다.

## 1. 설치

```bash
npm install
cp .env.example .env   # 그 다음 .env에 실제 GITLAB_URL, GITLAB_TOKEN, GITLAB_PROJECTS 입력
```

`GITLAB_TOKEN`은 GitLab > Settings > Access Tokens 에서 발급합니다.
조회만 할 거면 `read_api` scope로 충분합니다.

`GITLAB_PROJECTS`에 자주 쓰는 프로젝트를 기본값으로 넣어두면 매번 `--projects`를 안 줘도 됩니다 (아래 2번 참고).

## 2. 실행

```bash
npx tsx src/index.ts \
  --projects=123,456 \
  --since=2026-04-01 \
  --until=2026-06-18 \
  --authors=dev_a,dev_b \
  --out=report
```

- `--projects`: project ID 또는 `group/repo` 경로. 여러 개면 쉼표로 구분 (외주팀이 여러 레포에 걸쳐 작업했다면 전부 넣으면 됩니다). **생략하면 `.env`의 `GITLAB_PROJECTS` 값을 대신 사용합니다.** 둘 다 있으면 `--projects`가 우선합니다.
- `--since` / `--until`: MR 생성일 기준 기간 필터 (생략 가능)
- `--authors`: 특정 개발자만 보고 싶을 때 username 필터 (생략 시 전체)
- `--out`: 결과 파일 접두사. `report.csv`, `report.json`이 생성됩니다.
- `--exclude-source-pattern` / `--exclude-target-pattern`: 특정 source/target 브랜치 조합의 MR을 평가에서 제외 (자세한 사용법은 아래 "특정 브랜치 MR 제외하기" 참고).

`.env`에 `GITLAB_PROJECTS=dap-team/lending-platform`을 넣어뒀다면 가장 단순한 실행은 이렇게 됩니다:

```bash
npx tsx src/index.ts --out=report
```

### 특정 브랜치 MR 제외하기 (예: 스프린트 통합 MR)

`sprint1-dev`, `sprint2-dev` 같은 스프린트 브랜치를 `dev`로 통합 머지하는 MR은 여러 개발자의 코드가 한꺼번에 섞이는 "통합/리뷰용 MR"이라, 특정 개인의 퀄리티 지표로 잡으면 왜곡이 생깁니다. **이런 `sprintN-dev → dev` MR만 골라서 집계에서 빼고 싶을 때** 아래 두 옵션을 씁니다.

- `--exclude-source-pattern`: source 브랜치(머지를 보내는 쪽)에 매칭할 정규식
- `--exclude-target-pattern`: target 브랜치(머지를 받는 쪽)에 매칭할 정규식
- 둘 다 정규식이고, **둘 다 지정하면 두 조건을 모두 만족하는 MR만** 제외합니다 (AND). 하나만 주면 그 조건만으로 판단합니다.

스프린트 브랜치 → `dev` MR 제외 명령은 다음과 같습니다:

```bash
npx tsx src/index.ts \
  --projects=123 \
  --exclude-source-pattern='^sprint\d+-dev$' \
  --exclude-target-pattern='^dev$' \
  --out=report
```

- `^sprint\d+-dev$` 는 `sprint1-dev`, `sprint2-dev`, `sprint10-dev` 처럼 `sprint` + 숫자 + `-dev` 형태의 브랜치를 모두 매칭합니다.
- `^dev$` 는 target이 정확히 `dev`인 경우만 매칭합니다.
- 따라서 `sprintN-dev → dev` 형태의 통합 MR만 빠지고, 스프린트 기간 동안 각 개발자가 `feature/* → sprintN-dev`로 올린 개별 MR들은 그대로 집계됩니다.
- 실행 시 `[프로젝트] 브랜치 패턴에 의해 N개 MR 제외됨` 로그로 실제로 몇 개가 빠졌는지 확인할 수 있습니다.

브랜치 네이밍이 다르면 정규식만 바꾸면 됩니다. 예를 들어 target이 `dev`가 아니라 `develop`이거나, source가 `release/*`라면 그에 맞게 패턴을 조정하세요.

빌드해서 쓰고 싶으면 `npm run build && npm start -- --projects=...` 도 가능합니다.

## 3. 지표 설명

지표는 역할에 따라 **① 점수 반영 / ② 보조 / ③ 참고 / ④ 신뢰도** 로 나뉩니다.
종합점수(`qualityScore`)는 ①의 4개 지표만 가중합산해서 만들고, 나머지는 해석을 돕는 맥락 정보입니다.

### ① 점수에 반영되는 지표 (qualityScore 구성)


| 지표                          | 의미                                                       | 좋은 신호 | 가중치  |
| --------------------------- | -------------------------------------------------------- | ----- | ---- |
| reReviewedThreadRatio       | **재논의** 스레드 비율(첫 수정이 부족해 리뷰어가 같은 스레드에 다시 지적한 비율) | 낮을수록  | 0.35 |
| pipelineFirstTrySuccessRate | 첫 CI 파이프라인이 바로 success였던 비율                            | 높을수록  | 0.30 |
| reviewCommentsPer100Lines   | 변경 라인 100줄당 리뷰어 코멘트 수                                   | 낮을수록  | 0.20 |
| revertCommitRatio           | revert/hotfix/rollback 성격 커밋 비율                          | 낮을수록  | 0.15 |


가중치는 `src/metrics.ts`의 `QUALITY_WEIGHTS`(합계 1.0)에서, 감점이 시작되는 기준선은 같은 파일의 `SCORE_SCALE`에서 조정합니다.

핵심 설계 의도:

- **재작업은 "push 횟수"가 아니라 "재논의 비율"로 본다.** 단순 push 횟수(`avgPushCountPerMR`, `avgPostReviewPushCountPerMR`)는 리뷰 코멘트를 **일부러 나눠서 깔끔히 처리하는 스타일**까지 감점해 왜곡됩니다. 그래서 점수에는 **리뷰어가 같은 스레드에 다시 와서 "아직 부족하다"는 식으로 코멘트한 비율**(`reReviewedThreadRatio`)만 사용합니다.
  - 재논의 스레드 판정: 리뷰 스레드에서 첫 리뷰어 코멘트 이후의 후속 리뷰어 코멘트 중, 승인/칭찬성(LGTM·"좋습니다" 등 `APPROVAL_NOTE_PATTERN`에 매칭)이 **아닌** 코멘트가 1개 이상 있는 경우. (`SCORE_SCALE.reReviewedThreadRatio = 0.3` → 리뷰 스레드의 30%가 재논의되면 50점 수준)
  - **한계**: GitLab에서 push는 특정 스레드에 묶이지 않아 "이 push가 이 코멘트를 고쳤다"는 직접 연결은 불가능합니다. 또 `APPROVAL_NOTE_PATTERN`은 코멘트 언어/말투에 의존하는 휴리스틱이라, 실제 리뷰 언어(영어·폴란드어 등)에 맞게 점검·보강해야 합니다. push 관련 지표는 참고용으로 계속 출력됩니다.
- **코멘트는 "0개가 좋다"가 아니다.** 100줄당 리뷰 코멘트 1개까지는 건강한 리뷰 활동으로 보고 감점하지 않습니다(`SCORE_SCALE.commentDensityFreeAllowance = 1`). 그 이상으로 **과도하게 많을 때만** 감점합니다. 코멘트 0개는 리뷰가 부실했다는 신호일 수도 있으니 좋게만 보지 않습니다.
- **mergeRate는 점수에서 제외.** 스프린트 종료 시점엔 품질과 무관하게 거의 모든 MR이 머지되므로 변별력이 없습니다. 지표 자체는 참고용으로 계속 출력됩니다.

### ② 보조 지표 (현재는 점수 미반영, 운영 성숙도에 따라 점수화 가능)


| 지표                                  | 의미                                  | 좋은 신호 |
| ----------------------------------- | ----------------------------------- | ----- |
| unresolvedReviewCommentsPer100Lines | 100줄당 **미해결(resolve 안 됨)** 리뷰 코멘트 수 | 낮을수록  |
| oversizedMRRatio                    | 변경 800줄 이상(대형) MR의 비율               | 낮을수록  |


- `unresolved...`는 단순 코멘트 수보다 "실제로 안 짚고 넘어간 품질 이슈"에 가깝습니다. resolve 규칙을 엄격히 운영하는 팀이라면 점수 항목으로 승격해도 좋습니다.
- `oversizedMRRatio`는 MR 분리 능력/리뷰 가능성을 봅니다. 큰 MR은 코멘트 밀도를 인위적으로 낮게 보이게 만들 수 있어 같이 봐야 합니다. (대형 MR 기준선은 `SCORE_SCALE.oversizedMRLines = 800`줄)

### ③ 참고 지표 (점수 제외, 맥락 파악용)


| 지표                          | 의미                     | 비고                                   |
| --------------------------- | ---------------------- | ------------------------------------ |
| mergeRate                   | 전체 MR 중 머지된 비율         | 대부분 머지되는 조직에선 변별력 낮음                 |
| avgHoursToMerge             | 생성→머지 평균 소요 시간         | 리뷰어 지연/일정/승인 정책 영향이 커서 참고만           |
| avgLinesChangedPerMR        | MR당 평균 변경 라인           | MR 크기 감안용                            |
| avgPushCountPerMR           | MR당 전체 추가 push 평균      | 리뷰 전 self-push 포함이라 점수엔 미사용          |
| avgPostReviewPushCountPerMR | MR당 첫 리뷰 이후 push 평균    | 재작업 참고용. 점수는 스레드 기반 재논의 비율로 대체됨       |


### ④ 신뢰도 지표 (점수와 분리해서 함께 봐야 함)


| 지표                | 의미                                      |
| ----------------- | --------------------------------------- |
| confidenceScore   | 표본 수(MR 개수)와 데이터 커버리지를 반영한 0~100 신뢰도    |
| confidenceLevel   | `low` / `medium` / `high` 등급            |
| scoreCoverageRate | 실제 점수 계산에 사용된 가중치 비율(%). 100%에 가까울수록 충분 |


- MR이 1~2개뿐인 개발자는 우연히 높은 점수가 나올 수 있습니다. 이를 막되 점수를 인위적으로 깎지 않도록, **신뢰도는 `qualityScore`에 곱하지 않고 별도 칼럼으로** 제공합니다.
- `confidenceScore = 표본계수 × 커버리지계수 × 100`. 표본계수는 MR 수(≥10:1.0, ≥5:0.8, ≥3:0.6, ≥1:0.4), 커버리지계수는 측정된 지표 비중(`0.5 + 0.5 × scoreCoverageRate`)으로 계산합니다.
- **`confidenceLevel`이 다른 개발자끼리 점수를 직접 비교하지 마세요.** (예: high 등급 80점 vs low 등급 95점 → low 쪽이 더 낫다고 단정 불가)

### 점수 계산 방식 (데이터 없으면 자동 제외)

데이터가 없어 측정 불가능한 지표는 0점으로 깎는 대신 **점수 계산에서 빼고, 적용된 가중치 합으로만 정규화**합니다. 그래서 `scoreCoverageRate`가 같이 표시됩니다.

- 리뷰어 코멘트가 달린 스레드가 하나도 없으면(아무도 리뷰 안 함) `reReviewedThreadRatio`를 측정할 수 없어 → 해당 가중치(0.35) 제외.
- MR 파이프라인(`merge_request_event`)이 아니라 브랜치 push 파이프라인만 쓰는 프로젝트는 `GET /merge_requests/:iid/pipelines`가 비어 있어 `pipelineFirstTrySuccessRate`가 측정되지 않습니다 → 해당 가중치(0.30) 제외.
- diff(변경 라인) 정보가 없으면 코멘트 밀도(0.20) 제외.
- 이렇게 하면 "데이터 없음"과 "측정했는데 0점"이 구분되어, 파이프라인이 없는 팀이 전원 0점으로 깎이는 왜곡이 사라집니다. 단, 커버리지가 낮은 점수는 그만큼 신뢰도가 떨어지므로 `scoreCoverageRate` / `confidenceLevel`과 함께 해석하세요.

### 출력 결과 필드 전체 설명

콘솔 표에는 핵심만, `report.csv` / `report.json`에는 아래 모든 필드가 들어갑니다.


| 필드                                                     | 설명                                    |
| ------------------------------------------------------ | ------------------------------------- |
| username / name                                        | GitLab 사용자명 / 표시 이름                   |
| totalMRs                                               | 집계 대상 MR 총 개수(필터·제외 적용 후)             |
| mergedMRs / closedWithoutMerge                         | 머지된 MR 수 / 머지 없이 닫힌 MR 수              |
| mergeRate                                              | mergedMRs / totalMRs                  |
| totalLinesChanged / avgLinesChangedPerMR               | 전체 변경 라인 합 / MR당 평균                   |
| totalReviewComments / avgReviewCommentsPerMR           | 타인이 남긴 리뷰 코멘트 합 / MR당 평균              |
| reviewCommentsPer100Lines                              | 변경 100줄당 리뷰 코멘트 수(밀도)                 |
| unresolvedReviewComments / ...Per100Lines              | 미해결 리뷰 코멘트 수 / 100줄당 밀도               |
| totalPushCount / avgPushCountPerMR                     | 전체 추가 push 합 / MR당 평균(리뷰 전 포함, 참고용)   |
| totalPostReviewPushCount / avgPostReviewPushCountPerMR | 리뷰 이후 push 합 / MR당 평균(참고용)             |
| totalReviewThreads / reReviewedThreads / reReviewedThreadRatio | 리뷰 스레드 수 / 재논의된 스레드 수 / 비율(**점수 반영**) |
| pipelineEvaluatedMRs / pipelineMissingMRs              | 파이프라인 데이터가 있던/없던 MR 수                 |
| pipelineFirstTrySuccessRate                            | 첫 파이프라인 success 비율(평가 가능한 MR 기준)      |
| totalCommits / revertCommits / revertCommitRatio       | 커밋 합 / revert성 커밋 수 / 비율              |
| oversizedMRs / oversizedMRRatio                        | 대형(≥800줄) MR 수 / 비율                   |
| avgHoursToMerge                                        | 생성→머지 평균 시간(머지된 MR 없으면 null)          |
| scoreBreakdown.{lowReReview, pipelineFirstTry, lowCommentDensity, lowRevertRatio} | 각 점수 반영 지표의 0~100 환산 점수(데이터 없으면 null) |
| scoreCoverageRate                                      | 점수 계산에 사용된 가중치 비율(%)                  |
| confidenceScore / confidenceLevel                      | 신뢰도 점수 / 등급                           |
| qualityScore                                           | 0~100 종합 점수(내림차순 정렬 기준)               |


## 4. 파일 구조

```
src/
  types.ts        GitLab API 응답 및 내부 타입(EnrichedMR, DeveloperMetrics 등)
  gitlabClient.ts API 호출 (페이지네이션, 동시성 제어)
  metrics.ts      지표 계산 로직 (diff 라인, 리뷰 이후 push, 코멘트 밀도, 종합 점수, 신뢰도)
  branchFilter.ts source/target 브랜치 패턴으로 평가 제외 MR 필터링
  output.ts       콘솔 테이블 / CSV / JSON 출력
  index.ts        CLI 진입점
mock-server.ts    실제 GitLab 없이 로직을 테스트해볼 수 있는 가짜 서버
```

`mock-server.ts`로 로직만 먼저 검증해보고 싶으면:

```bash
npx tsx mock-server.ts &
GITLAB_URL=http://localhost:4567 GITLAB_TOKEN=dummy npx tsx src/index.ts --projects=1
```

