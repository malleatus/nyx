// https://octokit.github.io/rest.js/v17#issues-list
import { Octokit } from '@octokit/rest';
import m from 'moment';

const IssuePrefix = 'Nightly Run Failure';

function getIssueTitle(runId: string): string {
  return `${IssuePrefix}: ${runId}`;
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
  owner: string;
  repo: string;
  runId: string;
  token: string;
}

export default async function reportFailure({
  owner,
  repo,
  token,
  runId,
}: MainArgs): Promise<void> {
  const github = new Octokit({
    auth: token,
    userAgent: '@malleatus/nyx failure reporter',
  });

  // https://help.github.com/en/github/searching-for-information-on-github/searching-issues-and-pull-requests
  const issueSearch = await github.search.issuesAndPullRequests({
    q: `repo:${owner}/${repo} state:open is:issue label:CI in:title "${IssuePrefix}"`,
  });

  if (issueSearch.data.total_count > 0) {
    const issueNumber = issueSearch.data.items[0].number;
    console.log(`Issue ${issueNumber} already exists for run ${runId}`);
    return;
  }

  await createIssue({ github, runId, owner, repo });
}
