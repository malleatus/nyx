import assert from './assert';

// TODO: rather than define these types partially we might want to read them from octokit similar to what is done in src/commands/merge
// we'll want the single types (eg review vs reviews)

// https://developer.github.com/v3/activity/events/types/#pullrequestreviewevent
interface PullRequestReviewEvent {
  action: 'submitted' | 'edited' | 'dismissed';
  pull_request: {
    number: number;
    // ...
  };
  // review: { ... }
}

// https://developer.github.com/v3/activity/events/types/#statusevent
interface StatusEvent {
  // we may need to parse the owner from target_url for PRs from outside the repo owner
  // target_url: string;
  // ... other properties
  branches: {
    name: string;
    commit: {
      sha: string;
      url: string;
    }[];
    protected: boolean;
  }[];
}

export interface GitHubContextWithReviewEvent {
  event: StatusEvent;
  run_number: string;
  repository: string;
}
export interface GitHubContextWithStatusEvent {
  event: PullRequestReviewEvent;
  run_number: string;
  repository: string;
}

export function isStatusEvent(event: StatusEvent | PullRequestReviewEvent): event is StatusEvent {
  return 'branches' in event;
}

export function isPullRequestReviewEvent(
  event: StatusEvent | PullRequestReviewEvent
): event is PullRequestReviewEvent {
  return 'action' in event && 'pull_request' in event;
}

// https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#github-context
export type GitHubContext = GitHubContextWithReviewEvent | GitHubContextWithStatusEvent;

export function readRepository(
  context: GitHubContext
): {
  owner: string;
  repo: string;
} {
  let repoParts = context.repository.split('/');
  assert(repoParts.length === 2, `repository malformed: '${context.repository}'`);

  let [owner, repo] = repoParts;

  return {
    owner,
    repo,
  };
}

export default function readContext(env = process.env): GitHubContext | undefined {
  const contextStr = env.GITHUB_CONTEXT;
  if (contextStr === undefined) {
    return undefined;
  }

  let context;
  try {
    context = JSON.parse(contextStr);
  } catch (e) {
    if (e instanceof SyntaxError && /JSON/.test(e.message)) {
      throw new Error(
        'process.env.GITHUB_CONTEXT found, but it is not a valid JSON-encoded string'
      );
    }

    throw e;
  }

  // type guard would be better here if there's a reasonable one
  return context as GitHubContext;
}
