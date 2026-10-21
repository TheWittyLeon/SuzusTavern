import { checkAuthPost } from '@/lib/auth/requestGuard';

const HOST = 'tavern.test:3000';
const h = (o: Record<string, string>) => new Headers(o);
const JSON_CT = { 'content-type': 'application/json' };

describe('checkAuthPost (HUNT1020-22/-23)', () => {
  it('Sec-Fetch-Site: only same-origin passes', () => {
    expect(checkAuthPost(h({ 'sec-fetch-site': 'same-origin', ...JSON_CT }), HOST, { json: true })).toBeNull();
    for (const v of ['cross-site', 'same-site', 'none', '', 'garbage']) {
      expect(checkAuthPost(h({ 'sec-fetch-site': v, ...JSON_CT }), HOST, { json: true })).toBe('cross_site');
    }
  });

  it('Sec-Fetch-Site wins over a matching-looking Origin', () => {
    expect(
      checkAuthPost(h({ 'sec-fetch-site': 'cross-site', origin: `http://${HOST}`, ...JSON_CT }), HOST, { json: true }),
    ).toBe('cross_site');
  });

  it('falls back to Origin when Sec-Fetch-Site is absent (older browsers)', () => {
    expect(checkAuthPost(h({ origin: `http://${HOST}`, ...JSON_CT }), HOST, { json: true })).toBeNull();
    expect(checkAuthPost(h({ origin: 'http://TAVERN.test:3000', ...JSON_CT }), HOST, { json: true })).toBeNull();
    for (const o of ['http://evil.example', 'http://tavern.test:4000', 'null', 'not a url', 'http://tavern.test.evil.example:3000']) {
      expect(checkAuthPost(h({ origin: o, ...JSON_CT }), HOST, { json: true })).toBe('bad_origin');
    }
  });

  it('no Sec-Fetch-Site and no Origin = not a browser: allowed', () => {
    expect(checkAuthPost(h(JSON_CT), HOST, { json: true })).toBeNull();
  });

  it('bodied routes demand JSON; bodiless routes do not', () => {
    for (const ct of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
      expect(checkAuthPost(h({ 'sec-fetch-site': 'same-origin', 'content-type': ct }), HOST, { json: true })).toBe('not_json');
    }
    expect(checkAuthPost(h({ 'sec-fetch-site': 'same-origin', 'content-type': 'Application/JSON; charset=utf-8' }), HOST, { json: true })).toBeNull();
    expect(checkAuthPost(h({ 'sec-fetch-site': 'same-origin' }), HOST, { json: false })).toBeNull();
  });
});
