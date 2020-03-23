declare module '@sinonjs/fake-timers' {
  export interface FakeClock {
    uninstall(): void;
  }
  // https://github.com/sinonjs/fake-timers#var-clock--faketimersinstallconfig
  export interface ClockConfig {
    now: number | Date;
  }
  export default class FakeTimers {
    static install(config?: ClockConfig): FakeClock;
  }
}
