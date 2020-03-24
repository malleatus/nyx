#!/usr/bin/env node

import * as yargs from 'yargs';
import setupHardRejection from 'hard-rejection';
import reportFailure from './commands/report-failure';
import assert from './utils/assert';

setupHardRejection();

yargs
  .scriptName('nyx')
  .usage('$0 <cmd> [args]')
  .command(
    'report-failure',
    'report failures',
    () => {
      // setup command options
    },
    async function () {
      const { GITHUB_TOKEN: token, RUN_ID: runId, OWNER: owner, REPO: repo } = process.env;

      assert(!!token, `env GITHUB_TOKEN must be set`);
      assert(!!runId, `env RUN_ID must be set`);
      assert(!!owner, `env OWNER must be set`);
      assert(!!repo, `env REPO must be set`);

      reportFailure({
        owner,
        repo,
        runId,
        token,
      });
    }
  )
  .demandCommand(1, '')
  .help().argv;
