import * as path from 'path';
import { Polly, PollyConfig, Headers } from '@pollyjs/core';
import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import FSPersister from '@pollyjs/persister-fs';
import merge, { mergeByContext, ExitCode } from './merge';
import setupHardRejection from 'hard-rejection';
import { Archive } from '@tracerbench/har';
import { Octokit } from '@octokit/rest';
import FakeTimers, { FakeClock } from '@sinonjs/fake-timers';
import { GitHubContext } from '../utils/read-context';

type MergeArgs = Parameters<typeof merge>[0];

class SanitizingPersister extends FSPersister {
  static get id(): string {
    return 'sanitizing-fs';
  }

  get options(): PollyConfig['persisterOptions'] {
    return {
      recordingsDir: path.resolve(__dirname, '..', '..', '.recordings'),
    };
  }

  // ensure that the authorization token is not written to disk
  saveRecording(recordingId: string, data: Archive): void {
    data.log.entries.forEach((entry) => {
      entry.request.headers = entry.request.headers.filter((h) => h.name !== 'authorization');
    });

    return super.saveRecording(recordingId, data);
  }
}

setupHardRejection();

Polly.register(NodeHttpAdapter);

describe('src/commands/merge.ts', function () {
  let polly: Polly;
  let github: Octokit;
  let githubReviewer: Octokit;
  let githubOtherReviewer: Octokit;
  let clock: FakeClock;
  const owner = 'malleatus';
  const repo = 'nyx-example';
  const token = process.env.GITHUB_AUTH_MALLEATUS_USER_A || 'fake-auth-token-alpha';
  const tokenB = process.env.GITHUB_AUTH_MALLEATUS_USER_B || 'fake-auth-token-bravo';
  const tokenC = process.env.GITHUB_AUTH_MALLEATUS_USER_C || 'fake-auth-token-charlie';
  let cleanupSteps: Array<Function> = [];

  function setupPolly(recordingName: string, config: PollyConfig = {}): Polly {
    polly = new Polly(recordingName, {
      adapters: ['node-http'],
      persister: SanitizingPersister,
      mode: process.env.RECORD_HAR !== undefined ? 'record' : 'replay',
      recordIfMissing: process.env.RECORD_HAR !== undefined,
      matchRequestsBy: {
        body(body, request) {
          if (
            request.method === 'POST' &&
            request.url === 'https://api.github.com/repos/malleatus/nyx-example/git/commits'
          ) {
            const requestBody = JSON.parse(body);
            requestBody.author.name = 'testy mctester';

            return JSON.stringify(requestBody);
          }

          return body;
        },

        // TODO: simplify this using @rwjblue magic
        headers(headers: Headers): Headers {
          /*
            remove certain headers from being used to match recordings:

            * authorization -- Avoid saving any authorization codes into
              `.har` files, and avoid differences when two different users run
              the tests
            * user-agent -- @octokit/rest **always** appends Node version and
              platform information into the userAgent (even when the Octokit
              instance has a custom userAgent). See
              https://github.com/octokit/rest.js/issues/907#issuecomment-422217573
              for a quick summary.
          */
          const { authorization, 'user-agent': userAgent, ...rest } = headers;

          return rest;
        },
      },
      ...config,
    });

    return polly;
  }

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
    // TODO: always remove all refs matching refs/heads/tests/*
    for (let cleanupStep of cleanupSteps) {
      await cleanupStep();
    }
    cleanupSteps = [];

    if (polly) {
      await polly.stop();
    }
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
        // eslint-disable-next-line @typescript-eslint/camelcase
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
        // eslint-disable-next-line @typescript-eslint/camelcase
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
    });

    test('merges green prs when any collaborator approves and none reject', async function () {
      setupPolly('merge-green-prs-when-collaborator-approves');

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
        // eslint-disable-next-line @typescript-eslint/camelcase
        pull_number: createdPr.number,
        event: 'APPROVE',
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
        // eslint-disable-next-line @typescript-eslint/camelcase
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('closed');
      expect(reloadedPr.merged).toEqual(true);
    });

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
        // eslint-disable-next-line @typescript-eslint/camelcase
        pull_number: createdPr.number,
        event: 'APPROVE',
      });

      await githubOtherReviewer.pulls.createReview({
        owner,
        repo,
        // eslint-disable-next-line @typescript-eslint/camelcase
        pull_number: createdPr.number,
        event: 'REQUEST_CHANGES',
        body: 'Please no',
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
        // eslint-disable-next-line @typescript-eslint/camelcase
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
        // eslint-disable-next-line @typescript-eslint/camelcase
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
      expect(reloadedPr.merged).toEqual(false);
    });

    test(`doesn't merge prs with no status`, async function () {
      setupPolly('doesnt-merge-prs-with-no-status');

      let createdPr = await createPullRequest({
        branch: 'tests/merge-green-prs-when-collaborator-approves',
      });

      await githubReviewer.pulls.createReview({
        owner,
        repo,
        // eslint-disable-next-line @typescript-eslint/camelcase
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
        // eslint-disable-next-line @typescript-eslint/camelcase
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
        // eslint-disable-next-line @typescript-eslint/camelcase
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
        // eslint-disable-next-line @typescript-eslint/camelcase
        pull_number: createdPr.number,
      });

      expect(reloadedPr.state).toEqual('open');
      expect(reloadedPr.merged).toEqual(false);
    });

    // branch protection stuff:
    // TODO: doesn't do shit if mergeable false or null (null means merge commit not made; false means conflict or maybe other stuff)
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
        // eslint-disable-next-line @typescript-eslint/camelcase
        run_number: '123',
        event: {
          action: 'submitted',
          // eslint-disable-next-line @typescript-eslint/camelcase
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
        // eslint-disable-next-line @typescript-eslint/camelcase
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
        // eslint-disable-next-line @typescript-eslint/camelcase
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
