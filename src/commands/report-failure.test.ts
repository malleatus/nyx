import * as path from 'path';
import { Polly, PollyConfig, Headers } from '@pollyjs/core';
import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import FSPersister from '@pollyjs/persister-fs';
import reportFailure from './report-failure';
import setupHardRejection from 'hard-rejection';
import { Archive } from '@tracerbench/har';

declare module '@pollyjs/persister' {
  export default interface Persister {
    findRecording(recordingId: string): Archive;

    saveRecording(recordingId: string, data: Archive): void;

    deleteRecording(recordingId: string): void;
  }
}

class SanitizingPersister extends FSPersister {
  static get id(): string {
    return 'sanitizing-fs';
  }

  get options(): PollyConfig['persisterOptions'] {
    return {
      recordingsDir: path.resolve(__dirname, '__recordings__'),
    };
  }

  // ensure that the authorization token is not written to disk
  saveRecording(recordingId: string, data: Archive): void {
    data.log.entries.forEach(entry => {
      entry.request.headers = entry.request.headers.filter(h => h.name !== 'authorization');
    });

    return super.saveRecording(recordingId, data);
  }
}

setupHardRejection();

Polly.register(NodeHttpAdapter);

describe('src/commands/report-failure.ts', function() {
  let polly: Polly;

  function setupPolly(recordingName: string, config: PollyConfig = {}): Polly {
    polly = new Polly(recordingName, {
      adapters: ['node-http'],
      persister: SanitizingPersister,
      matchRequestsBy: {
        headers(headers: Headers): Headers {
          // ensure that the authorization token is not used to match
          // recordings
          const { authorization, ...rest } = headers;

          return rest;
        },
      },
      ...config,
    });

    return polly;
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
