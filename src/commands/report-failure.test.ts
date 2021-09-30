import { Octokit } from '@octokit/rest';
import FakeTimers, { FakeClock } from '@sinonjs/fake-timers';
import setupHardRejection from 'hard-rejection';
import { setupPolly } from '../__utils__/polly';
import { cleanup, cleanupSteps } from '../__utils__/cleanup';
import { waitForIssueCount } from '../__utils__/waiters';
import reportFailure, { IssuePrefix } from './report-failure';

const GITHUB_AUTH = process.env.GITHUB_AUTH_MALLEATUS_USER_A;

setupHardRejection();

describe('src/commands/report-failure.ts', function () {
  let github: Octokit;
  let clock: FakeClock;

  beforeEach(() => {
    github = new Octokit({
      auth: GITHUB_AUTH,
      userAgent: '@malleatus/nyx failure reporter',
    });
    clock = FakeTimers.install({
      now: new Date('3 April 1994 13:14 GMT'),
    });
  });

  afterEach(async () => {
    await cleanup();
    clock.uninstall();
  });

  test('creates an issue', async function () {
    setupPolly('basic-test');

    let issues = await github.issues.listForRepo({
      owner: 'malleatus',
      repo: 'nyx-example',
      labels: 'CI',
      state: 'open',
    });

    expect(issues.data.length).toEqual(0);

    await reportFailure({
      owner: 'malleatus',
      repo: 'nyx-example',
      runId: '123456',
      token: GITHUB_AUTH || 'fake-auth-token',
    });

    issues = await github.issues.listForRepo({
      owner: 'malleatus',
      repo: 'nyx-example',
      labels: 'CI',
      state: 'open',
    });

    for (let issue of issues.data) {
      cleanupSteps.push(
        async () =>
          await github.issues.update({
            owner: 'malleatus',
            repo: 'nyx-example',
            issue_number: issue.number,
            state: 'closed',
          })
      );
    }

    expect(issues.data.length).toEqual(1);
    expect(issues.data[0].body).toMatchInlineSnapshot(`
      "
      Nightly run failures since last success:
      <!-- Nightly RUN START -->
      |Date | Run|
      |----|---:|
      | 1994-04-03 | [123456](https://github.com/malleatus/nyx-example/actions/runs/123456)|<!-- Nightly RUN END -->"
    `);
  });

  test('updates existing issues', async function () {
    setupPolly('update-existing-issue-test');

    let issues = await github.issues.listForRepo({
      owner: 'malleatus',
      repo: 'nyx-example',
      labels: 'CI',
      state: 'open',
    });

    expect(issues.data.length).toEqual(0);

    await reportFailure({
      owner: 'malleatus',
      repo: 'nyx-example',
      runId: '123456',
      token: GITHUB_AUTH || 'fake-auth-token',
    });

    await waitForIssueCount({
      issueCount: 1,
      github,
      searchQuery: `repo:malleatus/nyx-example state:open is:issue label:CI in:title "${IssuePrefix}"`,
    });

    await reportFailure({
      owner: 'malleatus',
      repo: 'nyx-example',
      runId: '5678',
      token: GITHUB_AUTH || 'fake-auth-token',
    });

    issues = await github.issues.listForRepo({
      owner: 'malleatus',
      repo: 'nyx-example',
      labels: 'CI',
      state: 'open',
    });

    for (let issue of issues.data) {
      cleanupSteps.push(
        async () =>
          await github.issues.update({
            owner: 'malleatus',
            repo: 'nyx-example',
            issue_number: issue.number,
            state: 'closed',
          })
      );
    }

    expect(issues.data.length).toEqual(1);
    expect(issues.data[0].body).toMatchInlineSnapshot(`
      "
      Nightly run failures since last success:
      <!-- Nightly RUN START -->
      |Date | Run|
      |----|---:|
      |  1994-04-03  |  [123456](https://github.com/malleatus/nyx-example/actions/runs/123456)|
      | 1994-04-03 | [5678](https://github.com/malleatus/nyx-example/actions/runs/5678)|<!-- Nightly RUN END -->"
    `);
  });
});
// process.env.RECORD_HAR = '1';
