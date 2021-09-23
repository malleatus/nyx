type CleanupFunction = () => Promise<unknown>;
export let cleanupSteps: Array<CleanupFunction> = [];

export async function cleanup() {
  // TODO: always remove all refs matching refs/heads/tests/*
  for (let cleanupStep of cleanupSteps) {
    await cleanupStep();
  }
  cleanupSteps.splice(0, cleanupSteps.length);
}
