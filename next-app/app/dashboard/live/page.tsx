'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LiveRacePayload } from '@/lib/live-telemetry';
import { getLivePollIntervalMs } from '@/lib/live-poll-interval';

function formatLapTime(value: number | null) {
  return value === null ? 'No lap yet' : `${value.toFixed(3)}s`;
}

function formatSessionTime(value: string | null) {
  if (!value) return 'TBA';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? 'TBA'
    : parsed.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function getCountdownParts(targetTime: string | null, nowMs: number) {
  if (!targetTime) return null;
  const diff = new Date(targetTime).valueOf() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return null;

  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    mins: Math.floor((diff % 3600000) / 60000),
    secs: Math.floor((diff % 60000) / 1000),
  };
}

function CountdownCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-f1-grid bg-f1-grid p-4 text-center">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
        {label}
      </div>
      <div className="font-mono text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

export default function LivePage() {
  const [liveData, setLiveData] = useState<LiveRacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [isDocumentHidden, setIsDocumentHidden] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsDocumentHidden(document.visibilityState === 'hidden');
    };

    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled) return;

      try {
        const response = await fetch('/api/live/race', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to load live data (${response.status})`);
        }

        const data = (await response.json()) as LiveRacePayload;
        if (cancelled) return;

        setLiveData(data);
        setError(null);
        setLoading(false);
        timer = setTimeout(poll, getLivePollIntervalMs(data.status, isDocumentHidden));
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load live race data.');
        setLoading(false);
        timer = setTimeout(poll, getLivePollIntervalMs('upcoming', isDocumentHidden));
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isDocumentHidden]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = useMemo(
    () => getCountdownParts(liveData?.nextRace?.startTime || null, nowMs),
    [liveData?.nextRace?.startTime, nowMs]
  );

  if (loading) {
    return <div className="min-h-screen bg-f1-black p-4 sm:p-6 lg:p-8 text-white">Loading live race data...</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-f1-black p-4 sm:p-6 lg:p-8 text-white">
        <div className="rounded-lg border border-f1-red bg-f1-dark p-6 text-red-300">{error}</div>
      </div>
    );
  }

  if (!liveData) {
    return <div className="min-h-screen bg-f1-black p-4 sm:p-6 lg:p-8 text-white">No live race data available.</div>;
  }

  const heading =
    liveData.session?.meetingName || liveData.nextRace?.raceName || 'Live and upcoming sessions';
  const subheading =
    liveData.status === 'upcoming'
      ? liveData.nextRace?.circuitName || 'Next race schedule'
      : [liveData.session?.sessionName, liveData.session?.circuit].filter(Boolean).join(' • ');

  return (
    <div className="min-h-screen bg-f1-black p-4 sm:p-6 lg:p-8 text-white">
      <div className="mb-6 sm:mb-8 rounded-xl border border-f1-grid bg-f1-dark p-4 sm:p-6">
        <div className="mb-3 inline-flex rounded-full border border-f1-red/40 bg-f1-red/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-f1-red">
          {liveData.status}
        </div>
        <h1 className="mb-2 text-2xl sm:text-3xl lg:text-4xl font-bold">{heading}</h1>
        <p className="mb-2 text-gray-300">{subheading || 'Latest timing summary'}</p>
        <p className="text-sm text-gray-400">{liveData.message}</p>
        {liveData.session && (
          <p className="mt-4 text-sm text-gray-500">
            Session window: {formatSessionTime(liveData.session.startTime)} to{' '}
            {formatSessionTime(liveData.session.endTime)}
          </p>
        )}
      </div>

      {liveData.nextRace && (
        <div className="mb-6 sm:mb-8 rounded-xl border border-f1-grid bg-f1-dark p-4 sm:p-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
            Next Scheduled Race
          </div>
          <div className="mb-3 text-xl sm:text-2xl font-bold text-f1-red">{liveData.nextRace.raceName}</div>
          <p className="mb-4 text-gray-400">
            {[liveData.nextRace.circuitName, liveData.nextRace.country].filter(Boolean).join(' • ')}
          </p>
          <p className="mb-6 text-sm text-gray-500">{formatSessionTime(liveData.nextRace.startTime)}</p>

          {countdown ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <CountdownCard label="Days" value={countdown.days} />
              <CountdownCard label="Hours" value={countdown.hours} />
              <CountdownCard label="Minutes" value={countdown.mins} />
              <CountdownCard label="Seconds" value={countdown.secs} />
            </div>
          ) : (
            <div className="rounded-lg border border-f1-grid bg-f1-grid p-4 text-sm text-gray-400">
              Countdown will appear once the next race start time is available.
            </div>
          )}
        </div>
      )}

      <div className="mb-6 sm:mb-8 rounded-xl border border-f1-grid bg-f1-dark p-4 sm:p-6">
        <h2 className="mb-4 text-xl font-bold">Session Order</h2>
        {liveData.leaderboard.length ? (
          <div className="space-y-3">
            {liveData.leaderboard.map((driver) => (
              <div
                key={`${driver.driverNumber}-${driver.code}`}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-f1-grid bg-f1-grid p-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 font-mono text-lg font-bold text-f1-gold">
                    {driver.position ?? '—'}
                  </div>
                  <div
                    className="h-8 w-1 rounded-full"
                    style={{ backgroundColor: driver.teamColor }}
                  />
                  <div>
                    <p className="font-semibold text-white">{driver.name}</p>
                    <p className="text-xs text-gray-400">
                      {driver.team} • {driver.code}
                    </p>
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <p className="font-mono text-sm font-semibold text-f1-accent">
                    {formatLapTime(driver.lastLap)}
                  </p>
                  <p className="text-xs text-gray-500">{driver.lapCount} completed laps</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-f1-grid bg-f1-grid p-4 text-sm text-gray-400">
            No live leaderboard entries are available for the selected session yet.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-f1-grid bg-f1-dark p-4 sm:p-6">
        <h2 className="mb-4 text-xl font-bold">Lap Time Progression</h2>
        {liveData.lapSeries.length && liveData.lapSeriesDrivers.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={liveData.lapSeries}>
              <CartesianGrid stroke="#1a1a1a" />
              <XAxis dataKey="lap" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip
                contentStyle={{ background: '#0c0c0c', border: '1px solid #1a1a1a' }}
                formatter={(value: number | string) =>
                  typeof value === 'number' ? `${value.toFixed(3)}s` : value
                }
              />
              {liveData.lapSeriesDrivers.map((driver) => (
                <Line
                  key={driver.key}
                  type="monotone"
                  dataKey={driver.key}
                  stroke={driver.color}
                  name={driver.name}
                  dot={false}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="rounded-lg border border-f1-grid bg-f1-grid p-4 text-sm text-gray-400">
            Lap time history is not available for this session yet.
          </div>
        )}
      </div>
    </div>
  );
}
