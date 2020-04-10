import { Octokit } from '@octokit/rest';

type PromiseFulfillmentValue<P extends Promise<unknown>> = P extends Promise<infer FV> ? FV : never;

export enum ExitCode {
  Ok = 0,
  NoStatuses = 80,
  StatusRed = 81,
  StatusPending = 82,
  NoApprovals = 90,
  Rejected = 91,
  Unknown = 99,
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

  if (statuses.length === 0) {
    return ExitCode.NoStatuses;
  }

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
