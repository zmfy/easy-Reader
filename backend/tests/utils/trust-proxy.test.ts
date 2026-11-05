import { parseTrustProxy } from '../../src/utils/trust-proxy';

describe('parseTrustProxy', () => {
  it.each([[undefined, false], ['', false], [' false ', false], ['0', 0], ['1', 1], ['2', 2], ['true', true]])(
    '%p → %p', (input, expected) => {
      expect(parseTrustProxy(input as string | undefined)).toBe(expected);
    });

  it('passes address lists through for Express to parse', () => {
    expect(parseTrustProxy(' loopback, 172.16.0.0/12 ')).toBe('loopback, 172.16.0.0/12');
  });
});
