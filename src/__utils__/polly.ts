import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import { Headers, Polly, PollyConfig } from '@pollyjs/core';
import FSPersister from '@pollyjs/persister-fs';
import { Archive } from '@tracerbench/har';
import * as path from 'path';

Polly.register(NodeHttpAdapter);

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

export let polly: Polly | null;
export function isRecording() {
  return process.env.RECORD_HAR !== undefined;
}

afterEach(async () => {
  if (polly) {
    await polly.stop();
  }
  polly = null;
});

export function setupPolly(recordingName: string, config: PollyConfig = {}): Polly {
  const owner = 'malleatus';
  const repo = 'nyx-example';
  let isRecording = process.env.RECORD_HAR !== undefined;
  if (polly !== null && polly !== undefined) {
    throw new Error('There can be only one polly');
  }
  polly = new Polly(recordingName, {
    adapters: ['node-http'],
    persister: SanitizingPersister,
    mode: isRecording ? 'record' : 'replay',
    recordIfMissing: isRecording,
    matchRequestsBy: {
      body(body, request): string | null | undefined {
        if (
          request.method === 'POST' &&
          request.url === `https://api.github.com/repos/${owner}/${repo}/git/commits`
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
