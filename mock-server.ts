import { createServer } from "node:http";

// 개발자 2명, MR 3개에 대한 더미 데이터로 페이지네이션/지표 계산 로직을 검증합니다.
const mrs = [
  {
    id: 1, iid: 1, project_id: 1, title: "Add lending pool", state: "merged",
    created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-02T00:00:00Z",
    merged_at: "2026-05-02T10:00:00Z", closed_at: null,
    author: { id: 10, username: "dev_a", name: "Dev A" },
    target_branch: "main", source_branch: "feat/lending", web_url: "https://x/1",
  },
  {
    id: 2, iid: 2, project_id: 1, title: "Fix approve flow", state: "merged",
    created_at: "2026-05-05T00:00:00Z", updated_at: "2026-05-07T00:00:00Z",
    merged_at: "2026-05-07T05:00:00Z", closed_at: null,
    author: { id: 11, username: "dev_b", name: "Dev B" },
    target_branch: "main", source_branch: "fix/approve", web_url: "https://x/2",
  },
  {
    id: 3, iid: 3, project_id: 1, title: "Revert: Fix approve flow", state: "closed",
    created_at: "2026-05-08T00:00:00Z", updated_at: "2026-05-08T01:00:00Z",
    merged_at: null, closed_at: "2026-05-08T01:00:00Z",
    author: { id: 11, username: "dev_b", name: "Dev B" },
    target_branch: "main", source_branch: "revert/fix-approve", web_url: "https://x/3",
  },
  {
    id: 4, iid: 4, project_id: 1, title: "Sprint 1 통합", state: "merged",
    created_at: "2026-05-10T00:00:00Z", updated_at: "2026-05-10T02:00:00Z",
    merged_at: "2026-05-10T02:00:00Z", closed_at: null,
    author: { id: 12, username: "tech_lead", name: "Tech Lead" },
    target_branch: "dev", source_branch: "sprint1-dev", web_url: "https://x/4",
  },
];

const commitsByMr: Record<number, any[]> = {
  1: [{ id: "a1", short_id: "a1", title: "Add lending pool", message: "Add lending pool", author_name: "Dev A", author_email: "a@x.com", authored_date: "2026-05-01T00:00:00Z" }],
  2: [
    { id: "b1", short_id: "b1", title: "Fix approve flow", message: "Fix approve flow", author_name: "Dev B", author_email: "b@x.com", authored_date: "2026-05-05T00:00:00Z" },
    { id: "b2", short_id: "b2", title: "Address review comments", message: "Address review comments", author_name: "Dev B", author_email: "b@x.com", authored_date: "2026-05-06T00:00:00Z" },
  ],
  3: [{ id: "c1", short_id: "c1", title: "Revert: Fix approve flow", message: "Revert: Fix approve flow", author_name: "Dev B", author_email: "b@x.com", authored_date: "2026-05-08T00:00:00Z" }],
};

const discussionsByMr: Record<number, any[]> = {
  1: [
    { id: "d1", notes: [{ id: 1, body: "looks good", author: { id: 99, username: "reviewer", name: "Reviewer" }, created_at: "2026-05-01T01:00:00Z", system: false }] },
  ],
  2: [
    { id: "d2", notes: [
      { id: 2, body: "added 1 new commit to the merge request", author: { id: 11, username: "dev_b", name: "Dev B" }, created_at: "2026-05-05T00:00:01Z", system: true },
      { id: 3, body: "this looks risky, please double check", author: { id: 99, username: "reviewer", name: "Reviewer" }, created_at: "2026-05-05T02:00:00Z", system: false },
      { id: 4, body: "added 1 new commit to the merge request", author: { id: 11, username: "dev_b", name: "Dev B" }, created_at: "2026-05-06T00:00:01Z", system: true },
      { id: 5, body: "still concerned about edge case", author: { id: 99, username: "reviewer", name: "Reviewer" }, created_at: "2026-05-06T02:00:00Z", system: false },
    ] },
  ],
  3: [],
};

const pipelinesByMr: Record<number, any[]> = {
  1: [{ id: 1, status: "success", created_at: "2026-05-01T00:30:00Z", updated_at: "2026-05-01T00:40:00Z", ref: "feat/lending" }],
  2: [
    { id: 2, status: "failed", created_at: "2026-05-05T00:30:00Z", updated_at: "2026-05-05T00:40:00Z", ref: "fix/approve" },
    { id: 3, status: "success", created_at: "2026-05-06T00:30:00Z", updated_at: "2026-05-06T00:40:00Z", ref: "fix/approve" },
  ],
  3: [],
};

const changesByMr: Record<number, any> = {
  1: { changes: [{ old_path: "a.sol", new_path: "a.sol", diff: "@@ -1,2 +1,4 @@\n+line1\n+line2\n line3\n-oldline", new_file: false, deleted_file: false, renamed_file: false }] },
  2: { changes: [{ old_path: "b.sol", new_path: "b.sol", diff: "@@ -1,1 +1,2 @@\n+fix\n-bug", new_file: false, deleted_file: false, renamed_file: false }] },
  3: { changes: [{ old_path: "b.sol", new_path: "b.sol", diff: "@@ -1,2 +1,1 @@\n-fix\n+bug", new_file: false, deleted_file: false, renamed_file: false }] },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const path = url.pathname;
  res.setHeader("Content-Type", "application/json");

  if (path === "/api/v4/projects/1/merge_requests") {
    res.end(JSON.stringify(mrs));
    return;
  }
  const commitMatch = path.match(/\/merge_requests\/(\d+)\/commits/);
  if (commitMatch) {
    res.end(JSON.stringify(commitsByMr[Number(commitMatch[1])] ?? []));
    return;
  }
  const discMatch = path.match(/\/merge_requests\/(\d+)\/discussions/);
  if (discMatch) {
    res.end(JSON.stringify(discussionsByMr[Number(discMatch[1])] ?? []));
    return;
  }
  const pipeMatch = path.match(/\/merge_requests\/(\d+)\/pipelines/);
  if (pipeMatch) {
    res.end(JSON.stringify(pipelinesByMr[Number(pipeMatch[1])] ?? []));
    return;
  }
  const changeMatch = path.match(/\/merge_requests\/(\d+)\/changes/);
  if (changeMatch) {
    res.end(JSON.stringify(changesByMr[Number(changeMatch[1])] ?? { changes: [] }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found", path }));
});

server.listen(4567, () => {
  console.log("Mock GitLab API listening on http://localhost:4567");
});
