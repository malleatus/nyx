// https://octokit.github.io/rest.js/v17#issues-list
import { Octokit } from '@octokit/rest';
import m from 'moment';

export const IssuePrefix = 'Nightly Run Failure';

function getIssueTitle(runId: string): string {
  return `${IssuePrefix}: ${runId}`;
}

interface CreateIssueArgs {
  github: Octokit;
  runId: string;
  owner: string;
  repo: string;
}

interface UpdateIssueArgs extends CreateIssueArgs {
  existingIssueNumber: number;
  existingIssueBody: string;
}

const StartDelimiter = '<!-- Nightly RUN START -->';
const EndDelimiter = '<!-- Nightly RUN END -->';
type NightlyRunFailure = [dateStr: string, url: string];

function isNightlyRunFailure(parsedLine: string[]): parsedLine is NightlyRunFailure {
  return parsedLine.length === 2;
}

function parseNightlyRunTable(issueBody: string): NightlyRunFailure[] {
  let tableStart = issueBody.indexOf(StartDelimiter);
  let tableEnd = issueBody.indexOf(EndDelimiter);

  if (tableStart === -1) {
    throw new Error(`Cannot parse issue body as a Nightly Run Issue. Unable to
      find start delimiter '${StartDelimiter}'`);
  }
  if (tableEnd === -1) {
    throw new Error(`Cannot parse issue body as a Nightly Run Issue. Unable to
      find end delimiter '${StartDelimiter}'`);
  }
  let tableStr = issueBody.substring(tableStart, tableEnd);
  // strip start delim + header
  let runsStr = tableStr.split('\n').slice(3);
  return runsStr.map((line, idx) => {
    let result = line.slice(1, -1).split('|');
    if (!isNightlyRunFailure(result)) {
      throw new Error(
        `Nightly Run table row at ${idx}, '${line}' is not in the expected format: '| dateStr | url |'`
      );
    }
    return result;
  });
}

// TODO: make `last success` a link to last successful run
// or say no success if so
function createNightlyRunTable(runFailures: NightlyRunFailure[]): string {
  return (
    runFailures.reduce(
      (acc, [dateStr, url]) => {
        return `${acc}\n| ${dateStr} | ${url}|`;
      },
      `
Nightly run failures since last success:
${StartDelimiter}
|Date | Run|
|----|---:|`
    ) + EndDelimiter
  );
}

// TODO: report commit range
// TODO: even more betterer bisect commit range (possibly as a separate workflow)
async function createIssue({ github, runId, owner, repo }: CreateIssueArgs): Promise<void> {
  const title = getIssueTitle(runId);
  const body = createNightlyRunTable([createNightlyRunFailure({ owner, repo, runId })]);

  await github.issues.create({
    owner,
    repo,
    title,
    body,
    labels: ['CI'],
  });
}

function createNightlyRunFailure({
  owner,
  repo,
  runId,
}: {
  owner: string;
  repo: string;
  runId: string;
}): NightlyRunFailure {
  // TODO: use format instead
  const date = m().toISOString().substring(0, 10);
  const runLink = `[${runId}](https://github.com/${owner}/${repo}/actions/runs/${runId})`;
  return [date, runLink];
}

async function updateIssue({
  github,
  runId,
  owner,
  repo,
  existingIssueNumber,
  existingIssueBody,
}: UpdateIssueArgs): Promise<void> {
  // TODO: catch parseerror and then what?
  const nightlyRunFailures = parseNightlyRunTable(existingIssueBody);
  nightlyRunFailures.push(createNightlyRunFailure({ owner, repo, runId }));

  const body = createNightlyRunTable(nightlyRunFailures);
  await github.issues.update({
    owner,
    repo,
    issue_number: existingIssueNumber,
    body,
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
    const issue = issueSearch.data.items[0];
    const issueNumber = issue.number;
    console.log(
      `Issue ${issueNumber} already exists summarizing nightly failures; adding ${runId}`
    );
    let existingIssueNumber = issueNumber;
    let existingIssueBody = issue.body;
    return await updateIssue({
      github,
      runId,
      owner,
      repo,
      existingIssueBody,
      existingIssueNumber,
    });
  }

  await createIssue({ github, runId, owner, repo });
}
