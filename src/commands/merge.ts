import { Octokit } from '@octokit/rest';
import {
  GitHubContext,
  readRepository,
  isStatusEvent,
  isPullRequestReviewEvent,
} from '../utils/read-context';
import assert from '../utils/assert';

type PromiseFulfillmentValue<P extends Promise<unknown>> = P extends Promise<infer FV> ? FV : never;

export enum ExitCode {
  Ok = 0,
  NoStatuses = 80,
  StatusRed = 81,
  StatusPending = 82,
  ChecksRed = 83,
  // either in progress or still only queued
  ChecksPending = 84,
  NoApprovals = 90,
  Rejected = 91,
  Unknown = 99,
  DidNotRun = 100,
}

interface MainArgs {
  owner: string;
  repo: string;
  token: string;
  pullNumber: number;
}

type PullsListReviewsResponse = PromiseFulfillmentValue<
  ReturnType<Octokit['pulls']['listReviews']>
>['data'];
type ReposListCollaboratorsResponse = PromiseFulfillmentValue<
  ReturnType<Octokit['repos']['listCollaborators']>
>['data'];

function filterReviewsByCollaborators(
  reviews: PullsListReviewsResponse,
  collaborators: ReposListCollaboratorsResponse
): PullsListReviewsResponse {
  return reviews.filter((review) => {
    return collaborators.some((c) => {
      return c.login === review.user.login;
    });
  });
}

export default async function merge({
  owner,
  repo,
  pullNumber,
  token,
}: MainArgs): Promise<ExitCode> {
  const github = new Octokit({
    auth: token,
    userAgent: '@malleatus/nyx automerger',
  });

  let { data: pr } = await github.pulls.get({
    owner,
    repo,
    // eslint-disable-next-line @typescript-eslint/camelcase
    pull_number: pullNumber,
  });

  let { data: statuses } = await github.repos.listStatusesForRef({
    owner,
    repo,
    ref: pr.head.ref,
  });

  if (statuses.some((s) => s.state === 'failure')) {
    return ExitCode.StatusRed;
  }

  if (statuses.some((s) => s.state === 'pending')) {
    return ExitCode.StatusPending;
  }

  if (statuses.some((s) => s.state !== 'success')) {
    // none are failure; none are pending, presumably we have a bug or there is
    // a new kind of status
    return ExitCode.Unknown;
  }

  let { data: checks } = await github.checks.listForRef({
    owner,
    repo,
    ref: pr.head.ref,
  });

  if (checks.total_count === 0 && statuses.length === 0) {
    return ExitCode.NoStatuses;
  }

  if (checks.check_runs.some((cr) => cr.status !== 'completed')) {
    return ExitCode.ChecksPending;
  }

  // success | failure | neutral | cancelled | timed_out | action_required
  if (checks.check_runs.some((cr) => cr.conclusion !== 'success')) {
    // TODO: maybe tolerate success check + neutral check?
    return ExitCode.ChecksRed;
  }

  let { data: reviews } = await github.pulls.listReviews({
    owner,
    repo,
    // eslint-disable-next-line @typescript-eslint/camelcase
    pull_number: pullNumber,
  });

  if (reviews.length === 0) {
    return ExitCode.NoApprovals;
  }

  let { data: collaborators } = await github.repos.listCollaborators({
    owner,
    repo,
  });

  let collaboratorReviews = filterReviewsByCollaborators(reviews, collaborators);

  if (collaboratorReviews.filter((review) => review.state === 'APPROVED').length === 0) {
    return ExitCode.NoApprovals;
  }

  if (collaboratorReviews.some((review) => review.state === 'CHANGES_REQUESTED')) {
    return ExitCode.Rejected;
  }

  await github.pulls.merge({
    owner,
    repo,
    // eslint-disable-next-line @typescript-eslint/camelcase
    pull_number: pullNumber,
  });

  return ExitCode.Ok;
}

interface ContextArgs {
  context: GitHubContext;
  token: string;

  // for unit testing
  _mergeFn?: typeof merge;
}
export async function mergeByContext({
  context,
  token,

  _mergeFn = merge,
}: ContextArgs): Promise<ExitCode> {
  let { owner, repo } = readRepository(context);
  const github = new Octokit({
    auth: token,
    userAgent: '@malleatus/nyx automerger (by context)',
  });

  let event = context.event;
  if (isStatusEvent(event)) {
    if (event.branches.length === 0) {
      // status for a commit not on any branch
      return ExitCode.DidNotRun;
    }

    // TODO: check each branch
    let branchName = event.branches[0].name;
    let pulls = (
      await github.pulls.list({
        owner,
        repo,
        head: `${owner}:${branchName}`,
      })
    ).data;

    if (pulls.length === 0) {
      // status for a commit not in a pr
      return ExitCode.DidNotRun;
    }

    return _mergeFn({
      owner,
      repo,
      pullNumber: pulls[0].number,
      token,
    });
  } else if (isPullRequestReviewEvent(event)) {
    return _mergeFn({
      owner,
      repo,
      pullNumber: event.pull_request.number,
      token,
    });
  } else {
    assert(false, `unexpected event: ${event}`);
  }
}
