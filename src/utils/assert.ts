// TODO: https://github.com/DefinitelyTyped/DefinitelyTyped/pull/42786
// import * as assert from 'assert';
export default function assert(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}
