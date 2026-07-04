import { beforeEach, describe, expect, it, vi } from 'vitest';

const { f1ApiMock } = vi.hoisted(() => ({
  f1ApiMock: {
    sessions: vi.fn(),
    drivers: vi.fn(),
    laps: vi.fn(),
    positions: vi.fn(),
    carData: vi.fn(),
  },
}));

vi.mock('@/lib/f1-api', () => ({
  f1Api: f1ApiMock,
}));

import { GET } from '@/app/api/telemetry/route';

describe('GET /api/telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns lap-derived telemetry when car samples are missing', async () => {
    f1ApiMock.sessions.mockResolvedValue({
      data: [
        {
          session_key: 91,
          meeting_key: 3,
          session_name: 'Race',
          meeting_name: 'Hungarian Grand Prix',
          date_start: '2026-06-05T09:00:00Z',
          date_end: '2026-06-05T11:00:00Z',
        },
      ],
    });
    f1ApiMock.drivers.mockResolvedValue({
      data: [
        {
          driver_number: 1,
          full_name: 'Max Verstappen',
          name_acronym: 'VER',
          team_name: 'Red Bull Racing',
          team_colour: '3671C6',
        },
      ],
    });
    f1ApiMock.laps.mockResolvedValue({
      data: [
        { driver_number: 1, lap_number: 1, lap_duration: 92.5, st_speed: 301, date_start: '2026-07-05T09:02:00Z' },
        { driver_number: 1, lap_number: 2, lap_duration: 92.0, st_speed: 304, date_start: '2026-07-05T09:04:00Z' },
      ],
    });
    f1ApiMock.positions.mockResolvedValue({
      data: [{ driver_number: 1, position: 2, date: '2026-07-05T09:04:10Z' }],
    });
    f1ApiMock.carData.mockResolvedValue({ data: [] });

    const response = await GET(new Request('http://localhost/api/telemetry?driver=VER'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.source).toBe('lap-data');
    expect(json.selectedDriver.code).toBe('VER');
    expect(json.currentMetrics.position).toBe(2);
    expect(json.currentMetrics.lap).toBe(2);
  });

  it('returns an empty payload when no session can be selected', async () => {
    f1ApiMock.sessions.mockResolvedValue({ data: [] });

    const response = await GET(new Request('http://localhost/api/telemetry'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.source).toBe('none');
    expect(json.session).toBeNull();
    expect(json.samples).toEqual([]);
  });

  it('uses the current year when season is omitted', async () => {
    f1ApiMock.sessions.mockResolvedValue({ data: [] });

    await GET(new Request('http://localhost/api/telemetry?driver=VER'));

    expect(f1ApiMock.sessions).toHaveBeenCalledWith({ year: new Date().getFullYear() });
  });
});
