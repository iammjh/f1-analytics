import { describe, expect, it } from 'vitest';
import { getLivePollIntervalMs } from '@/lib/live-poll-interval';

describe('getLivePollIntervalMs', () => {
  it('polls faster during live sessions', () => {
    expect(getLivePollIntervalMs('live')).toBe(15_000);
  });

  it('slows down when the tab is hidden', () => {
    expect(getLivePollIntervalMs('live', true)).toBe(300_000);
  });

  it('uses a moderate interval for upcoming races', () => {
    expect(getLivePollIntervalMs('upcoming')).toBe(60_000);
  });
});
