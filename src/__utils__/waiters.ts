import { Octokit } from '@octokit/rest';
import { polly, isRecording } from '../__utils__/polly';

const realSetInterval = setInterval;
const realClearInterval = clearInterval;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

export interface WaitForIssueCountArgs {
  github: Octokit;
  issueCount: number;
  searchQuery?: string;
  timeout?: number;
}
export async function waitForIssueCount({
  github,
  issueCount,
  searchQuery,
  timeout = 10_000,
}: WaitForIssueCountArgs) {
  if (!isRecording()) {
    return;
  }

  let poll: NodeJS.Timeout;
  let timeoutToken: NodeJS.Timeout;

  polly?.pause();
  polly?.passthrough();

  function pass(resolve: (_fulfillmentValue: unknown) => void, result: unknown) {
    polly?.record();
    polly?.play();
    realClearInterval(poll);
    realClearTimeout(timeoutToken);
    resolve(result);
  }

  function fail(reject: (rejectionReason: unknown) => void, error: unknown) {
    realClearInterval(poll);
    realClearTimeout(timeoutToken);
    reject(error);
  }

  return Promise.race([
    new Promise((resolve, reject) => {
      poll = realSetInterval(async () => {
        try {
          if (searchQuery !== undefined) {
            let issueSearch = await github.search.issuesAndPullRequests({
              q: searchQuery,
            });
            if (issueSearch.data.total_count === issueCount) {
              pass(resolve, issueSearch);
            }
          } else {
            let issues = await github.issues.listForRepo({
              owner: 'malleatus',
              repo: 'nyx-example',
              labels: 'CI',
              state: 'open',
            });
            if (issues.data.length === issueCount) {
              pass(resolve, issues);
            }
          }
        } catch (e) {
          fail(reject, e);
        }
      }, 500);
    }),
    new Promise((_resolve, reject) => {
      timeoutToken = realSetTimeout(() => {
        fail(reject, `Issue count did not reach ${issueCount} within ${timeout}ms`);
      }, timeout);
    }),
  ]);
}
