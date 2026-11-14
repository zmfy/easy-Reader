import { throttled, _resetExternalThrottle } from '../../src/utils/external-throttle';

describe('throttled', () => {
  beforeEach(() => { jest.useFakeTimers(); _resetExternalThrottle(); });
  afterEach(() => { jest.useRealTimers(); });

  it('连续调用时后一次开始时间与前一次间隔不小于 intervalMs', async () => {
    const starts: number[] = [];
    const run = () => throttled(async () => { starts.push(Date.now()); }, 1000);
    const ps = [run(), run(), run()];
    await jest.advanceTimersByTimeAsync(5000);
    await Promise.all(ps);
    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
  });

  it('前一个抛错不阻塞后一个', async () => {
    const p1 = throttled(async () => { throw new Error('boom'); }, 1000);
    const p1Result = p1.catch(e => (e as Error).message);
    const p2 = throttled(async () => 'ok', 1000);
    await jest.advanceTimersByTimeAsync(3000);
    expect(await p1Result).toBe('boom');
    expect(await p2).toBe('ok');
  });
});
