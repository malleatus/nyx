import { Archive } from '@tracerbench/har';

declare module '@pollyjs/persister' {
  export default class Persister {
    findRecording(recordingId: string): Archive;

    saveRecording(recordingId: string, data: Archive): void;

    deleteRecording(recordingId: string): void;
  }
}
