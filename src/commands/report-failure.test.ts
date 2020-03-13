import * as path from 'path';
import { Polly } from '@pollyjs/core';
import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import FSPersister from '@pollyjs/persister-fs';
import reportFailure from './report-failure';
import setupHardRejection from 'hard-rejection';

class SanitizingPersister extends FSPersister {
  static get id() {
    return 'sanitizing-fs';
  }

  get options() {
    return {
      recordingsDir: path.resolve(__dirname, '__recordings__'),
    };
  }

  // ensure that the authorization token is not written to disk
  saveRecording(recordingId: string, data: any) {
    data.log.entries.forEach((entry: any) => {
      entry.request.headers = entry.request.headers.filter((h: any) => h.name !== 'authorization');
    });
    // @ts-ignore
    return super.saveRecording(recordingId, data);
  }
}

setupHardRejection();

Polly.register(NodeHttpAdapter);

describe('src/commands/report-failure.ts', function() {
  let polly: Polly;

  function setupPolly(recordingName: string) {
    polly = new Polly(recordingName, {
      adapters: ['node-http'],
      persister: SanitizingPersister,
      matchRequestsBy: {
        headers(headers) {
          // ensure that the authorization token is not used to match
          // recordings
          return Object.assign({}, headers, { authorization: null });
        },
      },
    });
  }

  afterEach(async () => {
    if (polly) {
      await polly.stop();
    }
  });

  test('creates an issue', async function() {
    setupPolly('basic-test');

    await reportFailure({
      env: {
        OWNER: 'malleatus',
        REPO: 'nyx',
        RUN_ID: '123456',
        GITHUB_TOKEN: process.env.GITHUB_AUTH,
      },
    });
  });
});
