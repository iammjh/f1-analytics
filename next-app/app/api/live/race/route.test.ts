import { beforeEach, describe, expect, it, vi } from 'vitest';

const { f1ApiMock, fetchSeasonRacesMock, findNextUpcomingRaceMock } = vi.hoisted(() => ({
  f1ApiMock: {
    sessions: vi.fn(),
    drivers: vi.fn(),
    positions: vi.fn(),
    laps: vi.fn(),
  },
  fetchSeasonRacesMock: vi.fn(),
  findNextUpcomingRaceMock: vi.fn((races: any[]) => races[0] || null),
}));

vi.mock('@/lib/f1-api', () => ({
  f1Api: f1ApiMock,
}));

vi.mock('@/lib/jolpica-client', () => ({
  fetchSeasonRaces: fetchSeasonRacesMock,
  findNextUpcomingRace: findNextUpcomingRaceMock,
}));

import { GET } from '@/app/api/live/race/route';

describe('GET /api/live/race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns normalized recent-session data when timing exists', async () => {
    f1ApiMock.sessions.mockResolvedValue({
      data: [
        {
          session_key: 44,
          meeting_key: 12,
          session_name: 'Race',
          meeting_name: 'British Grand Prix',
          circuit_short_name: 'Silverstone',
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
    f1ApiMock.positions.mockResolvedValue({
      data: [{ driver_number: 1, position: 1, date: '2026-07-05T10:30:00Z' }],
    });
    f1ApiMock.laps.mockResolvedValue({
      data: [{ driver_number: 1, lap_number: 1, lap_duration: 91.2, date_start: '2026-07-05T09:05:00Z' }],
    });
    fetchSeasonRacesMock.mockResolvedValue([]);

    const response = await GET(new Request('http://localhost/api/live/race?season=2026'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe('recent');
    expect(json.session.meetingName).toBe('British Grand Prix');
    expect(json.leaderboard[0].code).toBe('VER');
  });

  it('falls back to the next scheduled race when no session timing exists', async () => {
    f1ApiMock.sessions.mockResolvedValue({ data: [] });
    fetchSeasonRacesMock.mockResolvedValue([
      {
        round: '12',
        raceName: 'British Grand Prix',
        date: '2026-07-12',
        time: '13:00:00Z',
        Circuit: {
          circuitName: 'Silverstone Circuit',
          Location: { country: 'United Kingdom', locality: 'Silverstone' },
        },
      },
    ]);

    const response = await GET(new Request('http://localhost/api/live/race'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe('upcoming');
    expect(json.nextRace.raceName).toBe('British Grand Prix');
    expect(json.leaderboard).toEqual([]);
  });

  it('uses the current year when season is omitted', async () => {
    f1ApiMock.sessions.mockResolvedValue({ data: [] });
    fetchSeasonRacesMock.mockResolvedValue([]);

    await GET(new Request('http://localhost/api/live/race'));

    expect(f1ApiMock.sessions).toHaveBeenCalledWith({ year: new Date().getFullYear() });
  });
});
