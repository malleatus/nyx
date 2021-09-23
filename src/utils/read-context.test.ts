import readContext from './read-context';

describe('readContext', function () {
  it('returns undefined if env has no GITHUB_CONTEXT', function () {
    expect(readContext()).toBe(undefined);
  });

  it('throws an error if GITHUB_CONTEXT is not JSON', function () {
    expect(() => {
      readContext({
        GITHUB_CONTEXT: '{ duz dis look like json 2 u?',
      });
    }).toThrow('process.env.GITHUB_CONTEXT found, but it is not a valid JSON-encoded string');
  });

  it('returns GITHUB_CONTEXT as a parsed GitHubContext', function () {
    let rawContext = {
      event: {
        sha: 'abc123',
        state: 'success',
        description: '',
        target_url: 'https://example.com/something-or-other',
        branches: [],
      },
      run_number: 20,
      repository: 'malleatus/nyx-example',
    };

    let parsedContext = readContext({
      GITHUB_CONTEXT: JSON.stringify(rawContext),
    });
    expect(parsedContext).toEqual(rawContext);
  });
});
