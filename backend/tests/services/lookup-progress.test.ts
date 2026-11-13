import {
  finishLookupProgress, getLookupProgress, setLookupProgress, startLookupProgress,
} from '../../src/services/lookup-progress';
import type { LookupStep } from '../../src/services/book-lookup-agent';

const step = (query: string): LookupStep => ({ kind: 'search_book', query, count: 1 });

describe('lookup progress', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('returns null for a book that never started', () => {
    expect(getLookupProgress('none')).toBeNull();
  });

  it('records steps between start and finish, then drops them 60 seconds after finishing', () => {
    jest.useFakeTimers();
    startLookupProgress('b1');
    expect(getLookupProgress('b1')).toEqual({ steps: [], done: false });
    setLookupProgress('b1', [step('魔戒')]);
    expect(getLookupProgress('b1')).toEqual({ steps: [step('魔戒')], done: false });
    finishLookupProgress('b1');
    expect(getLookupProgress('b1')).toEqual({ steps: [step('魔戒')], done: true });
    jest.advanceTimersByTime(59_000);
    expect(getLookupProgress('b1')).not.toBeNull();
    jest.advanceTimersByTime(1_000);
    expect(getLookupProgress('b1')).toBeNull();
  });

  it('starting the same book again clears old steps and is not removed by the earlier finish timer', () => {
    jest.useFakeTimers();
    startLookupProgress('b2');
    setLookupProgress('b2', [step('旧')]);
    finishLookupProgress('b2');
    jest.advanceTimersByTime(30_000);
    startLookupProgress('b2');
    expect(getLookupProgress('b2')).toEqual({ steps: [], done: false });
    jest.advanceTimersByTime(30_000);
    expect(getLookupProgress('b2')).toEqual({ steps: [], done: false });
  });
});
