import * as yargs from 'yargs';
import setupHardRejection from 'hard-rejection';
import reportFailure from './commands/report-failure';
import assert from './utils/assert';

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
    .demandCommand(1, '')
    .help().argv;
}
