/**
 * @jest-environment node
 *
 * Tests for the container liveness probe at src/app/api/health/route.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../../app/api/health/route') as {
  GET: () => import('next/server').NextResponse;
};

describe('GET /api/health', () => {
  it('returns 200 with an ok status payload', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('suzus-tavern');
  });
});
