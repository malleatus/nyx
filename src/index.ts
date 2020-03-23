import * as yargs from 'yargs';
import setupHardRejection from 'hard-rejection';
import reportFailure from './commands/report-failure';

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
      reportFailure({
        env: process.env,
      });
    }
  )
  .demandCommand(1, '')
  .help().argv;
