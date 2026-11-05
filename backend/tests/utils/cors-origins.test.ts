import { parseCorsOrigins } from '../../src/utils/cors-origins';

describe('parseCorsOrigins', () => {
  it('returns nothing when neither variable is set', () => {
    expect(parseCorsOrigins(undefined, undefined)).toEqual([]);
    expect(parseCorsOrigins('', ' , ')).toEqual([]);
  });

  it('merges FRONTEND_URL with the comma separated CORS_ORIGINS', () => {
    expect(parseCorsOrigins('http://nas:8080', 'https://a.example.com, http://localhost:5173')).toEqual([
      'http://nas:8080', 'https://a.example.com', 'http://localhost:5173',
    ]);
  });

  it('drops trailing slashes and duplicates', () => {
    expect(parseCorsOrigins('http://nas:8080/', 'http://nas:8080,https://b.example.com/')).toEqual([
      'http://nas:8080', 'https://b.example.com',
    ]);
  });
});
