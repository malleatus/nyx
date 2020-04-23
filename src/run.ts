import * as yargs from 'yargs';
import setupHardRejection from 'hard-rejection';
import reportFailure from './commands/report-failure';
import merge, { mergeByContext } from './commands/merge';
import assert from './utils/assert';
import readContext from './utils/read-context';

export default async function main(): Promise<void> {
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
        const token = (argv.token as string) || process.env.GITHUB_TOKEN;
        const runId = argv.runId as string;
        const owner = argv.owner as string;
        const repo = argv.repo as string;
        // const context = readContext(process.env);

        assert(
          !!token,
          `nyx report-failure expects either the \`--token\` argument or for $GITHUB_AUTH to be set`
        );

        // TODO: if context === undefined assert required args

        // TODO: reportFailureByContext
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
            type: 'string',
          })
          .option('repo', {
            describe: 'The repository name',
            alias: 'r',
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
        const token = (argv.token as string) || process.env.GITHUB_TOKEN;
        const prInput = argv.pr as string;
        const owner = argv.owner as string;
        const repo = argv.repo as string;
        const context = readContext(process.env);

        assert(
          !!token,
          `nyx merge expects either the \`--token\` argument or for $GITHUB_AUTH to be set`
        );

        if (context === undefined) {
          assert(
            !!prInput && !!owner && !!repo,
            `nyx merge expects either the \`--owner\`, \`--repo\`, and \`--pr\` arguments, or for $GITHUB_CONTEXT to be for a status or pull request review`
          );

          let pullNumber = parseInt(prInput, 10);

          // TODO: return a message
          process.exitCode = await merge({
            owner,
            repo,
            token,
            pullNumber,
          });
        } else {
          process.exitCode = await mergeByContext({
            token,
            context,
          });
        }
        // TODO: return a message
      },
    })
    .demandCommand(1, '')
    .help().argv;
}
