#!/usr/bin/env node

import * as yargs from 'yargs';
import setupHardRejection from 'hard-rejection';
import reportFailure from './commands/report-failure';
import merge from './commands/merge';
import assert from './utils/assert';

setupHardRejection();

yargs
  .scriptName('nyx')
  .usage('$0 <cmd> [args]')
  .command({
    command: 'report-failure',
    describe: 'opens an issue on the specified repo to report a failure',
    builder(yargs) {
      return yargs
        .option('owner', {
          describe: 'The organization or user for the repository',
          alias: 'o',
          demandOption: true,
          type: 'string',
        })
        .option('repo', {
          describe: 'The repository name',
          alias: 'r',
          demandOption: true,
          type: 'string',
        })
        .option('token', {
          describe:
            'The GitHub token to use to open the issue, will use $GITHUB_AUTH if this option is not specified',
          type: 'string',
        })
        .option('run-id', {
          describe: 'The GitHub actions run id to report failing',
          demandOption: true,
          type: 'string',
        });
    },
    async handler(argv) {
      const token = (argv.token as string) || process.env.GITHUB_AUTH;
      const runId = argv.runId as string;
      const owner = argv.owner as string;
      const repo = argv.repo as string;

      assert(
        !!token,
        `nyx report-failure expects either the \`--token\` argument or for $GITHUB_AUTH to be set`
      );

      await reportFailure({
        owner,
        repo,
        runId,
        token,
      });
    },
  })
  .command({
    command: 'merge',
    describe: 'merge a pr if requirements are met',
    builder(yargs) {
      return yargs
        .option('owner', {
          describe: 'The organization or user for the repository',
          alias: 'o',
          demandOption: true,
          type: 'string',
        })
        .option('repo', {
          describe: 'The repository name',
          alias: 'r',
          demandOption: true,
          type: 'string',
        })
        .option('token', {
          describe:
            'The GitHub token to use to open the issue, will use $GITHUB_AUTH if this option is not specified',
          type: 'string',
        })
        .option('pr', {
          describe: 'The pull request number to conditionally merge',
          type: 'string',
        });
    },
    async handler(argv) {
      const token = (argv.token as string) || process.env.GITHUB_AUTH;
      const prInput = argv.pr as string;
      const owner = argv.owner as string;
      const repo = argv.repo as string;

      assert(
        !!token,
        `nyx report-failure expects either the \`--token\` argument or for $GITHUB_AUTH to be set`
      );

      let pullNumber = parseInt(prInput, 10);

      // TODO: return a message
      process.exitCode = await merge({
        owner,
        repo,
        token,
        pullNumber,
      });
    },
  })
  .demandCommand(1, '')
  .help().argv;
