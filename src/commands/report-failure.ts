// https://octokit.github.io/rest.js/v17#issues-list
import { Octokit } from '@octokit/rest';
import m from 'moment';
import assert from '../utils/assert';

function getIssueTitle(runId: string): string {
  return `Nightly Run Failure: ${runId}`;
}

interface CreateIssueArgs {
  github: Octokit;
  runId: string;
  owner: string;
  repo: string;
}

// TODO: report commit range
// TODO: even more betterer bisect commit range (possibly as a separate workflow)
async function createIssue({ github, runId, owner, repo }: CreateIssueArgs): Promise<void> {
  const title = getIssueTitle(runId);
  const date = m().format('D MMM YYYY');
  const url = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
  const body = `Nightly run failed on: ${date}\n${url}`;

  await github.issues.create({
    owner,
    repo,
    title,
    body,
    labels: ['CI'],
  });
}

interface MainArgs {
  env: NodeJS.ProcessEnv;
}
export default async function reportFailure({ env }: MainArgs): Promise<void> {
  const { GITHUB_TOKEN: token, RUN_ID: runId, OWNER: owner, REPO: repo } = env;

  assert(!!token, `env GITHUB_TOKEN must be set`);
  assert(!!runId, `env RUN_ID must be set`);
  assert(!!owner, `env OWNER must be set`);
  assert(!!repo, `env REPO must be set`);

  const github = new Octokit({
    auth: token,
    userAgent: '@malleatus/nyx failure reporter',
  });

  const issueTitle = getIssueTitle(runId);
  // https://help.github.com/en/github/searching-for-information-on-github/searching-issues-and-pull-requests
  const issueSearch = await github.search.issuesAndPullRequests({
    q: `repo:${owner}/${repo} state:open is:issue label:CI in:title ${issueTitle}`,
  });

  if (issueSearch.data.total_count > 0) {
    const issueNumber = issueSearch.data.items[0].number;
    console.log(`Issue ${issueNumber} already exists for run ${runId}`);
    return;
  }

  await createIssue({ github, runId, owner, repo });
}
