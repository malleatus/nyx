import { Octokit } from '@octokit/rest';
import FakeTimers, { FakeClock } from '@sinonjs/fake-timers';
import setupHardRejection from 'hard-rejection';
import { GitHubContext } from '../utils/read-context';
import { polly, setupPolly } from '../__utils__/polly';
import { cleanup, cleanupSteps } from '../__utils__/cleanup';
import merge, { ExitCode, mergeByContext } from './merge';

type MergeArgs = Parameters<typeof merge>[0];

setupHardRejection();

describe('src/commands/merge.ts', function () {
  let github: Octokit;
  let githubReviewer: Octokit;
  let githubOtherReviewer: Octokit;
  let clock: FakeClock;
  const owner = 'malleatus';
  const repo = 'nyx-example';
  const token = process.env.GITHUB_AUTH_MALLEATUS_USER_A || 'fake-auth-token-alpha';
  const tokenB = process.env.GITHUB_AUTH_MALLEATUS_USER_B || 'fake-auth-token-bravo';
  const tokenC = process.env.GITHUB_AUTH_MALLEATUS_USER_C || 'fake-auth-token-charlie';
  let isRecording = process.env.RECORD_HAR !== undefined;

  let setTimeout = global.setTimeout;
  let realNow = global.Date.now;

  beforeEach(() => {
    github = new Octokit({
      auth: token,
      userAgent: '@malleatus/nyx automerger (committer)',
    });
    githubReviewer = new Octokit({
      auth: tokenB,
      userAgent: '@malleatus/nyx automerger (reviewer)',
    });
    githubOtherReviewer = new Octokit({
      auth: tokenC,
      userAgent: '@malleatus/nyx automerger (reviewer)',
    });
    clock = FakeTimers.install({
      now: new Date('3 April 1994 13:25 GMT'),
    });
  });

  afterEach(async () => {
    await cleanup();
    clock.uninstall();
  });

  const rootCommit = '0cd9174475323d277817fc6e2ff5a94aca089a12';
  const rootTree = 'a9ca945741d41287d8bb35c9423e660e931d3695';

  interface CreatePullRequestArgs {
    branch: string;
  }
  async function createPullRequest({ branch: branchName }: CreatePullRequestArgs) {
    // - first make tree
    //    - https://developer.github.com/v3/git/trees/
    // - commit
    //    - https://developer.github.com/v3/git/commits/
    // - branch
    //    - https://developer.github.com/v3/git/refs/#create-a-reference
    // - pr
    //    - https://developer.github.com/v3/pulls/#create-a-pull-request
    const author = {
      name: `testy mctester ${10_000 + Math.floor(Math.random() * 50_000)}`,
      email: 'test@example.com',
      date: '2008-08-09T16:13:31+12:00',
    };
    const { data: commit } = await github.git.createCommit({
      repo,
      owner,
      message: 'test commit',
      author,
      parents: [rootCommit],
      tree: rootTree,
    });

    await github.git.createRef({ sha: commit.sha, ref: `refs/heads/${branchName}`, owner, repo });

    const { data: pr } = await github.pulls.create({
      repo,
      owner,
      title: `test PR: ${branchName}`,
      base: 'master',
      head: branchName,
    });

    cleanupSteps.push(async () => {
      // close PR
      await github.pulls.update({
        owner,
        repo,
        pull_number: pr.number,
        state: 'closed',
      });

      // delete branch
      await github.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });
    });

    return pr;
  }

  interface WaitForChecksArgs {
    ref: string;
    status: 'queued' | 'in_progress' | 'completed';
    timeout: number;
  }
  // TODO: move to waiters.ts
  function waitForChecks({ ref, status, timeout }: WaitForChecksArgs) {
    if (!isRecording) {
      return;
    }

    let startTime = realNow();
    let timeoutAt = startTime + timeout * 1_000;

    polly?.pause();
    polly?.passthrough();

    return new Promise((resolve, reject) => {
      function scheduleCheck() {
        if (realNow() > timeoutAt) {
          polly?.record();
          polly?.play();
          reject('wait for checks timeout');
        }

        setTimeout(async () => {
          let { data: checks } = await github.checks.listForRef({
            repo,
            owner,
            ref,
          });

          if (checks.total_count > 0 && checks.check_runs.some((cr) => cr.status === status)) {
            polly?.record();
            polly?.play();
            resolve(true);
          } else {
            scheduleCheck();
          }
        }, 1_000);
      }

      scheduleCheck();
    });
  }

  describe('merge', function () {
    test(`doesn't merge red prs`, async function () {
      setupPolly('doesnt-merge-red-prs');

      let createdPr = await createPullRequest({
        branch: 'tests/doesnt-merge-red-prs',
      });

      await github.repos.createStatus({
        owner,
        repo,
        sha: createdPr.head.sha,
        state: 'failure',
      });

      await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
    });

    test('merges green prs (by status) when any collaborator approves and none reject', async function () {
      setupPolly('merge-green-prs-by-status-when-collaborator-approves');

      let createdPr = await createPullRequest({
        branch: 'tests/merge-green-prs-when-collaborator-approves',
      });

      await github.repos.createStatus({
        owner,
        repo,
        sha: createdPr.head.sha,
        state: 'success',
      });

      await githubReviewer.pulls.createReview({
        owner,
        repo,
        pull_number: createdPr.number,
        event: 'APPROVE',
      });

      await waitForChecks({
        ref: createdPr.head.ref,
        status: 'completed',
        timeout: 60,
      });

      let exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      expect(exitCode).toEqual(ExitCode.Ok);

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('closed');
      expect(reloadedPr.merged).toEqual(true);
    });

    test('merges green prs (by checks) when any collaborator approves and none reject', async function () {
      setupPolly('merge-green-prs-by-checks-when-collaborator-approves');

      // nyx-example has a CI that passes for all branches that don't contain the word "fail"
      let createdPr = await createPullRequest({
        branch: 'tests/merge-green-prs-when-collaborator-approves',
      });

      await githubReviewer.pulls.createReview({
        owner,
        repo,
        pull_number: createdPr.number,
        event: 'APPROVE',
      });

      await waitForChecks({
        ref: createdPr.head.ref,
        status: 'completed',
        timeout: 60,
      });

      let exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      expect(exitCode).toEqual(ExitCode.Ok);

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('closed');
      expect(reloadedPr.merged).toEqual(true);
    }, 60_000);

    test(`doesn't merge green prs when a collaborator approves but another collaborator rejects`, async function () {
      setupPolly('doesnt-merge-green-when-one-collab-approves-and-another-rejects');

      let createdPr = await createPullRequest({
        branch: 'tests/merge-green-prs-when-collaborator-approves',
      });

      await github.repos.createStatus({
        owner,
        repo,
        sha: createdPr.head.sha,
        state: 'success',
      });

      await githubReviewer.pulls.createReview({
        owner,
        repo,
        pull_number: createdPr.number,
        event: 'APPROVE',
      });

      await githubOtherReviewer.pulls.createReview({
        owner,
        repo,
        pull_number: createdPr.number,
        event: 'REQUEST_CHANGES',
        body: 'Please no',
      });

      await waitForChecks({
        ref: 'tests/merge-green-prs-when-collaborator-approves',
        status: 'completed',
        timeout: 60,
      });

      let exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      expect(exitCode).toEqual(ExitCode.Rejected);

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
      expect(reloadedPr.merged).toEqual(false);
    });

    test(`doesn't merge green prs with zero approvals`, async function () {
      setupPolly('doesnt-merge-green-with-zero-approvals');

      let createdPr = await createPullRequest({
        branch: 'tests/merge-green-prs-when-collaborator-approves',
      });

      await github.repos.createStatus({
        owner,
        repo,
        sha: createdPr.head.sha,
        state: 'success',
      });

      let exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      expect(exitCode).toEqual(ExitCode.NoApprovals);

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
      expect(reloadedPr.merged).toEqual(false);
    });

    test(`doesn't merge prs with no status or checks`, async function () {
      setupPolly('doesnt-merge-prs-with-no-status-or-checks');

      let createdPr = await createPullRequest({
        branch: 'tests/merge-green-prs-when-collaborator-approves',
      });

      await githubReviewer.pulls.createReview({
        owner,
        repo,
        pull_number: createdPr.number,
        event: 'APPROVE',
      });

      let exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      expect(exitCode).toEqual(ExitCode.NoStatuses);

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
      expect(reloadedPr.merged).toEqual(false);
    });

    test(`doesn't merge prs with some green status and some pending status`, async function () {
      setupPolly('doesnt-merge-prs-with-some-green-and-some-pending-status');

      let createdPr = await createPullRequest({
        branch: 'tests/merge-green-prs-when-collaborator-approves',
      });

      await github.repos.createStatus({
        owner,
        repo,
        sha: createdPr.head.sha,
        state: 'pending',
      });

      await github.repos.createStatus({
        owner,
        repo,
        sha: createdPr.head.sha,
        state: 'success',
      });

      await githubReviewer.pulls.createReview({
        owner,
        repo,
        pull_number: createdPr.number,
        event: 'APPROVE',
      });

      let exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      expect(exitCode).toEqual(ExitCode.StatusPending);

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
      expect(reloadedPr.merged).toEqual(false);
    });

    test(`doesn't merge prs with some green status and some red checks`, async function () {
      setupPolly('doesnt-merge-prs-with-some-green-status-and-some-red-checks');

      let createdPr = await createPullRequest({
        // nyx-example CI will fail the branch if it contains the substring 'fail'
        branch: 'tests/fail-branch-doesnt-merge-prs-with-some-green-status-some-red-checks',
      });

      await github.repos.createStatus({
        owner,
        repo,
        sha: createdPr.head.sha,
        state: 'success',
        description: "test commit status (david&rob don't get confused: you did this)",
      });

      await githubReviewer.pulls.createReview({
        owner,
        repo,
        pull_number: createdPr.number,
        event: 'APPROVE',
      });

      await waitForChecks({
        ref: createdPr.head.ref,
        status: 'completed',
        timeout: 60,
      });

      let exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      expect(exitCode).toEqual(ExitCode.ChecksRed);

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
      expect(reloadedPr.merged).toEqual(false);
    }, 60_000);

    test(`doesn't merge prs with pending checks (queued or in progress)`, async function () {
      setupPolly('doesnt-merge-prs-with-pending-checks');

      let createdPr = await createPullRequest({
        // nyx-example CI will fail the branch if it contains the substring 'fail'
        branch: 'tests/fail-branch-doesnt-merge-prs-with-some-green-status-some-red-checks',
      });

      await githubReviewer.pulls.createReview({
        owner,
        repo,
        pull_number: createdPr.number,
        event: 'APPROVE',
      });

      await waitForChecks({
        ref: createdPr.head.ref,
        status: 'queued',
        timeout: 60,
      });

      // TODO: strictly speaking there's a race here between the check going from queued → in_progress → completed
      let exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber: createdPr.number,
      });

      expect(exitCode).toEqual(ExitCode.ChecksPending);

      let { data: reloadedPr } = await github.pulls.get({
        owner,
        repo,
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
      expect(reloadedPr.merged).toEqual(false);
    }, 60_000);
  });

  describe('mergeByContext(reviewContext)', function () {
    it('calls merge', async function () {
      setupPolly('merge-by-context-review');

      let mergeCalled = false;

      let branchName = 'tests/merge-by-context-review';
      let createdPr = await createPullRequest({
        branch: branchName,
      });

      let context: GitHubContext = {
        repository: 'malleatus/nyx-example',
        run_number: '123',
        event: {
          action: 'submitted',
          pull_request: {
            number: createdPr.number,
          },
        },
      };

      function _mergeFn({ token: argtoken, owner, repo, pullNumber }: MergeArgs) {
        expect(argtoken).toEqual(token);
        expect(owner).toEqual('malleatus');
        expect(repo).toEqual('nyx-example');
        expect(pullNumber).toEqual(createdPr.number);
        mergeCalled = true;

        return Promise.resolve(ExitCode.Ok);
      }

      await mergeByContext({
        context,
        token,
        _mergeFn,
      });

      expect(mergeCalled).toBe(true);
    });
  });

  describe('mergeByContext(statusContext)', function () {
    it('calls merge when commit is on exactly one branch with same owner as the repo', async function () {
      setupPolly('merge-by-context-commit-in-one-pr-from-repo-owner');

      let mergeCalled = false;

      let branchName = 'tests/merge-by-context-status';
      let createdPr = await createPullRequest({
        branch: branchName,
      });

      let sha = createdPr.head.sha;
      let context: GitHubContext = {
        repository: 'malleatus/nyx-example',
        run_number: '123',
        event: {
          branches: [
            {
              name: branchName,
              commit: [
                {
                  sha,
                  url: '',
                },
              ],
              protected: false,
            },
          ],
        },
      };

      function _mergeFn({ token: argtoken, owner, repo, pullNumber }: MergeArgs) {
        expect(argtoken).toEqual(token);
        expect(owner).toEqual('malleatus');
        expect(repo).toEqual('nyx-example');
        expect(pullNumber).toEqual(createdPr.number);
        mergeCalled = true;

        return Promise.resolve(ExitCode.Ok);
      }

      await mergeByContext({
        context,
        token,
        _mergeFn,
      });

      expect(mergeCalled).toBe(true);
    });

    it('does not call merge when commit is in no pr', async function () {
      setupPolly('merge-by-context-commit-in-no-pr');

      let mergeCalled = false;

      const author = {
        name: `testy mctester ${10_000 + Math.floor(Math.random() * 50_000)}`,
        email: 'test@example.com',
        date: '2008-08-09T16:13:31+12:00',
      };
      const { data: commit } = await github.git.createCommit({
        repo,
        owner,
        message: 'test commit',
        author,
        parents: [rootCommit],
        tree: rootTree,
      });
      // assert we really made a commit
      expect(commit.sha.length).toBeGreaterThan(4);

      let context: GitHubContext = {
        repository: 'malleatus/nyx-example',
        run_number: '123',
        event: {
          branches: [],
        },
      };

      function _mergeFn(): Promise<ExitCode> {
        throw new Error('merge called in error');
      }

      await mergeByContext({
        context,
        token,
        _mergeFn,
      });

      expect(mergeCalled).toBe(false);
    });

    it.skip('does something when commit is in a branch for a pr from outside the repo', function () {
      expect('implemented').toEqual('true');
    });

    it.skip('does something when commit is in multiple branches', function () {
      expect('implemented').toEqual('true');
    });

    it.skip('does something when commit is in multiple prs', function () {
      expect('implemented').toEqual('true');
    });
  });
});
