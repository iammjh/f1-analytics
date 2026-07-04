'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DASHBOARD_WATCHLIST_DESCRIPTION,
  DASHBOARD_WATCHLIST_NAME,
  countDashboardWatchlistItems,
  ensureDashboardWatchlist,
  saveDashboardWatchlist,
} from '@/lib/dashboard-watchlist';
import { getTeamColor } from '@/lib/f1-display';
import { fetchSeasonStandingsBundle } from '@/lib/jolpica-client';

const SEASONS = ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019'];

type WatchlistBucket = 'drivers' | 'teams' | 'races';

interface DashboardWatchlist {
  id: string;
  name: string;
  description?: string;
  drivers: string[];
  teams: string[];
  races: string[];
}

interface DriverStanding {
  position: string;
  points: string;
  Driver: {
    driverId: string;
    givenName: string;
    familyName: string;
    code?: string;
  };
  Constructors?: Array<{
    constructorId: string;
    name: string;
  }>;
}

interface ConstructorStanding {
  position: string;
  points: string;
  wins: string;
  Constructor: {
    constructorId: string;
    name: string;
    nationality?: string;
  };
}

function PosBadge({ pos }: { pos: string }) {
  const tone =
    pos === '1'
      ? 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30'
      : pos === '2'
        ? 'bg-zinc-300/10 text-zinc-200 border-zinc-300/20'
        : pos === '3'
          ? 'bg-amber-700/15 text-amber-300 border-amber-700/30'
          : 'bg-zinc-800 text-zinc-300 border-zinc-700';

  return (
    <span className={`inline-flex min-w-8 items-center justify-center rounded-md border px-2 py-1 text-xs font-bold ${tone}`}>
      {pos}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-red-600" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-8 text-center">
      <div className="mb-3 text-3xl">⭐</div>
      <p className="text-sm text-zinc-400">{message}</p>
    </div>
  );
}

function RemoveButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-yellow-500/30 px-3 py-1 text-sm font-semibold text-yellow-300 transition hover:bg-yellow-500/10 disabled:cursor-not-allowed disabled:opacity-50"
    >
      ★
    </button>
  );
}

export default function WatchlistPage() {
  const [season, setSeason] = useState('2026');
  const [watchlist, setWatchlist] = useState<DashboardWatchlist | null>(null);
  const [drivers, setDrivers] = useState<DriverStanding[]>([]);
  const [teams, setTeams] = useState<ConstructorStanding[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [seasonLoading, setSeasonLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSeasonData = useCallback(async (nextSeason: string) => {
    const { drivers: nextDrivers, constructors: nextTeams } = await fetchSeasonStandingsBundle(nextSeason);
    setDrivers(nextDrivers);
    setTeams(nextTeams);
  }, []);

  useEffect(() => {
    let active = true;
    setWatchlistLoading(true);
    setError(null);

    ensureDashboardWatchlist()
      .then((list) => {
        if (active) setWatchlist(list);
      })
      .catch((err) => {
        if (active) {
          console.error('Failed to load dashboard watchlist:', err);
          setError('Could not load your dashboard favorites right now.');
        }
      })
      .finally(() => {
        if (active) setWatchlistLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setSeasonLoading(true);
    setError(null);

    loadSeasonData(season)
      .catch((err) => {
        if (active) {
          console.error('Failed to load standings data:', err);
          setError('Could not load the latest standings data for this season.');
        }
      })
      .finally(() => {
        if (active) setSeasonLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadSeasonData, season]);

  const watchedDrivers = useMemo(() => {
    if (!watchlist) return [];
    return drivers.filter((driver) => watchlist.drivers.includes(driver.Driver.driverId));
  }, [drivers, watchlist]);

  const watchedTeams = useMemo(() => {
    if (!watchlist) return [];
    return teams.filter((team) => watchlist.teams.includes(team.Constructor.constructorId));
  }, [teams, watchlist]);

  const trackedCount = countDashboardWatchlistItems(watchlist);

  const toggleItem = useCallback(async (bucket: WatchlistBucket, id: string) => {
    if (!watchlist || syncing) return;

    const nextValues = watchlist[bucket].includes(id)
      ? watchlist[bucket].filter((value) => value !== id)
      : [...watchlist[bucket], id];

    const nextWatchlist: DashboardWatchlist = {
      ...watchlist,
      [bucket]: nextValues,
    };

    setWatchlist(nextWatchlist);
    setSyncing(true);

    try {
      const updated = await saveDashboardWatchlist({
        ...nextWatchlist,
        description: nextWatchlist.description || DASHBOARD_WATCHLIST_DESCRIPTION,
      });
      setWatchlist(updated);
    } catch (err) {
      console.error('Failed to sync watchlist change:', err);
      setWatchlist(watchlist);
      setError('Could not save that watchlist change. Please try again.');
    } finally {
      setSyncing(false);
    }
  }, [syncing, watchlist]);

  if (watchlistLoading || seasonLoading) {
    return <Spinner />;
  }

  return (
    <div className="min-h-screen bg-f1-black p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
              Server-backed Favorites
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">
              Dashboard Watchlist
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              This page reflects the same <span className="font-semibold text-zinc-200">{DASHBOARD_WATCHLIST_NAME}</span> list used by the main dashboard stars.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
              Season
            </span>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition focus:border-red-600"
            >
              {SEASONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Tracked Total</div>
            <div className="mt-3 text-3xl font-black text-white">{trackedCount}</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Drivers</div>
            <div className="mt-3 text-3xl font-black text-white">{watchlist?.drivers.length || 0}</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Constructors</div>
            <div className="mt-3 text-3xl font-black text-white">{watchlist?.teams.length || 0}</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">List Name</div>
            <div className="mt-3 text-lg font-bold text-white">{watchlist?.name || DASHBOARD_WATCHLIST_NAME}</div>
          </div>
        </div>

        {trackedCount === 0 ? (
          <EmptyState message="No favorites yet. Star drivers or constructors from the main dashboard to track them here." />
        ) : (
          <div className="space-y-8">
            {watchedDrivers.length > 0 && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-white">Tracked Drivers</h2>
                  <p className="mt-1 text-sm text-zinc-400">Driver favorites synced from the dashboard profile cards.</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-red-600/70 text-zinc-400">
                        <th className="px-3 py-3 text-left font-semibold">Pos</th>
                        <th className="px-3 py-3 text-left font-semibold">Driver</th>
                        <th className="px-3 py-3 text-left font-semibold">Code</th>
                        <th className="px-3 py-3 text-left font-semibold">Team</th>
                        <th className="px-3 py-3 text-right font-semibold">Points</th>
                        <th className="px-3 py-3 text-right font-semibold">Favorite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {watchedDrivers.map((entry) => {
                        const team = entry.Constructors?.[0];
                        return (
                          <tr key={entry.Driver.driverId} className="border-b border-zinc-900 last:border-b-0">
                            <td className="px-3 py-3">
                              <PosBadge pos={entry.position} />
                            </td>
                            <td className="px-3 py-3 font-semibold text-white">
                              {entry.Driver.givenName} {entry.Driver.familyName}
                            </td>
                            <td className="px-3 py-3 text-zinc-400">{entry.Driver.code || '—'}</td>
                            <td className="px-3 py-3" style={{ color: getTeamColor(team?.constructorId) }}>
                              {team?.name || '—'}
                            </td>
                            <td className="px-3 py-3 text-right font-mono font-semibold text-white">
                              {entry.points}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <RemoveButton
                                disabled={syncing}
                                onClick={() => toggleItem('drivers', entry.Driver.driverId)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {watchedTeams.length > 0 && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-white">Tracked Constructors</h2>
                  <p className="mt-1 text-sm text-zinc-400">Constructor favorites synced from the main dashboard standings cards.</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-red-600/70 text-zinc-400">
                        <th className="px-3 py-3 text-left font-semibold">Pos</th>
                        <th className="px-3 py-3 text-left font-semibold">Constructor</th>
                        <th className="px-3 py-3 text-left font-semibold">Nationality</th>
                        <th className="px-3 py-3 text-right font-semibold">Wins</th>
                        <th className="px-3 py-3 text-right font-semibold">Points</th>
                        <th className="px-3 py-3 text-right font-semibold">Favorite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {watchedTeams.map((entry) => (
                        <tr key={entry.Constructor.constructorId} className="border-b border-zinc-900 last:border-b-0">
                          <td className="px-3 py-3">
                            <PosBadge pos={entry.position} />
                          </td>
                          <td className="px-3 py-3 font-semibold" style={{ color: getTeamColor(entry.Constructor.constructorId) }}>
                            {entry.Constructor.name}
                          </td>
                          <td className="px-3 py-3 text-zinc-400">{entry.Constructor.nationality || '—'}</td>
                          <td className="px-3 py-3 text-right font-mono font-semibold text-white">
                            {entry.wins}
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-semibold text-white">
                            {entry.points}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <RemoveButton
                              disabled={syncing}
                              onClick={() => toggleItem('teams', entry.Constructor.constructorId)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {!!watchlist?.races.length && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-white">Tracked Races</h2>
                  <p className="mt-1 text-sm text-zinc-400">Race ids already saved in this list. The main dashboard does not manage these yet.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {watchlist.races.map((raceId) => (
                    <button
                      key={raceId}
                      onClick={() => toggleItem('races', raceId)}
                      disabled={syncing}
                      className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Race {raceId} ×
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
