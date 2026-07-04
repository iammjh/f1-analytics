'use client';

import { useEffect, useState } from 'react';
import { 
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer, ComposedChart 
} from 'recharts';
import type { TelemetryPayload, TelemetrySample } from '@/lib/live-telemetry';

const POLL_MS = 45_000;

function formatSessionLabel(payload: TelemetryPayload | null) {
  if (!payload?.session) return 'Latest telemetry';
  const details = [payload.session.meetingName, payload.session.sessionName].filter(Boolean);
  return details.join(' • ');
}

export default function TelemetryPage() {
  const [telemetryData, setTelemetryData] = useState<TelemetrySample[]>([]);
  const [selectedDriver, setSelectedDriver] = useState('VER');
  const [drivers, setDrivers] = useState<TelemetryPayload['drivers']>([]);
  const [currentMetrics, setCurrentMetrics] = useState<TelemetrySample | null>(null);
  const [payload, setPayload] = useState<TelemetryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTelemetry() {
      try {
        const response = await fetch(`/api/telemetry?driver=${encodeURIComponent(selectedDriver)}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`Failed to load telemetry (${response.status})`);
        }

        const nextPayload = (await response.json()) as TelemetryPayload;
        if (cancelled) return;

        setPayload(nextPayload);
        setDrivers(nextPayload.drivers);
        setTelemetryData(nextPayload.samples || []);
        setCurrentMetrics(nextPayload.currentMetrics || null);
        setError(null);
        setLoading(false);

        if (
          nextPayload.selectedDriver?.code &&
          nextPayload.selectedDriver.code !== selectedDriver
        ) {
          setSelectedDriver(nextPayload.selectedDriver.code);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load telemetry data.'
          );
          setLoading(false);
        }
      }
    }

    loadTelemetry();
    const poller = window.setInterval(loadTelemetry, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poller);
    };
  }, [selectedDriver]);

  if (loading) {
    return <div className="p-8 bg-f1-black min-h-screen text-white">Loading telemetry...</div>;
  }

  if (error) {
    return (
      <div className="p-8 bg-f1-black min-h-screen text-white">
        <div className="rounded-lg border border-f1-red bg-f1-dark p-6 text-red-300">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-8 bg-f1-black min-h-screen">
      <h1 className="text-4xl font-bold text-white mb-8">📊 Telemetry Dashboard</h1>
      <p className="mb-6 text-sm text-gray-400">{formatSessionLabel(payload)}</p>
      {payload?.message && <p className="mb-3 text-sm text-gray-400">{payload.message}</p>}
      {payload?.derivedMetricsNotice && (
        <p className="mb-8 text-xs uppercase tracking-[0.18em] text-gray-500">
          {payload.derivedMetricsNotice}
        </p>
      )}

      {/* Driver Selector */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-3">Select Driver</label>
        <select 
          value={selectedDriver}
          onChange={(e) => setSelectedDriver(e.target.value)}
          className="bg-f1-dark border border-f1-red rounded px-4 py-2 text-white font-semibold hover:bg-f1-grid transition"
        >
          {drivers.map(d => (
            <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
          ))}
        </select>
      </div>

      {/* Current Metrics Cards */}
      {currentMetrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
          <MetricCard label="Speed" value={currentMetrics.speed.toFixed(0)} unit="km/h" color="text-f1-red" />
          <MetricCard label="Throttle" value={currentMetrics.throttle.toFixed(0)} unit="%" color="text-blue-400" />
          <MetricCard label="Brake" value={currentMetrics.braking.toFixed(0)} unit="%" color="text-red-500" />
          <MetricCard label="Gear" value={currentMetrics.gear} unit="" color="text-yellow-400" />
          <MetricCard label="RPM" value={Math.round(currentMetrics.rpm / 100)} unit="x100" color="text-green-400" />
          <MetricCard label="Fuel" value={currentMetrics.fuel.toFixed(1)} unit="L" color="text-orange-400" />
          <MetricCard label="Position" value={currentMetrics.position ?? '—'} unit="" color="text-f1-accent" />
          <MetricCard label="Lap" value={currentMetrics.lap ?? '—'} unit="" color="text-purple-400" />
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Speed Chart */}
        <div className="bg-f1-dark border border-f1-grid rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Speed Profile</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a" />
              <XAxis dataKey="distance" stroke="#666" tick={{ fontSize: 12 }} />
              <YAxis stroke="#666" tick={{ fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ background: '#0c0c0c', border: '1px solid #E10600' }}
                formatter={(v: number | string) => typeof v === 'number' ? v.toFixed(1) : v}
              />
              <Line type="monotone" dataKey="speed" stroke="#E10600" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Throttle & Brake */}
        <div className="bg-f1-dark border border-f1-grid rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Throttle & Brake Input</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a" />
              <XAxis dataKey="distance" stroke="#666" tick={{ fontSize: 12 }} />
              <YAxis stroke="#666" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#0c0c0c', border: '1px solid #E10600' }} />
              <Line type="monotone" dataKey="throttle" stroke="#27F4D2" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="braking" stroke="#FF6B6B" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Fuel Consumption */}
        <div className="bg-f1-dark border border-f1-grid rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Fuel Consumption</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a" />
              <XAxis dataKey="distance" stroke="#666" tick={{ fontSize: 12 }} />
              <YAxis stroke="#666" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#0c0c0c', border: '1px solid #E10600' }} />
              <Area type="monotone" dataKey="fuel" fill="#FF9500" stroke="#FF9500" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Tire Temperature */}
        <div className="bg-f1-dark border border-f1-grid rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Tire Temperature</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a" />
              <XAxis dataKey="distance" stroke="#666" tick={{ fontSize: 12 }} />
              <YAxis stroke="#666" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#0c0c0c', border: '1px solid #E10600' }} />
              <Line type="monotone" dataKey="tireTempF" stroke="#FF1493" dot={false} strokeWidth={2} name="Front" />
              <Line type="monotone" dataKey="tireTempR" stroke="#00FFFF" dot={false} strokeWidth={2} name="Rear" />
              <Legend />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Gear Usage */}
        <div className="bg-f1-dark border border-f1-grid rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Gear Selection</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a" />
              <XAxis dataKey="distance" stroke="#666" tick={{ fontSize: 12 }} />
              <YAxis stroke="#666" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#0c0c0c', border: '1px solid #E10600' }} />
              <Bar dataKey="gear" fill="#27F4D2" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* RPM Curve */}
        <div className="bg-f1-dark border border-f1-grid rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Engine RPM</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={telemetryData}>
              <CartesianGrid stroke="#1a1a1a" />
              <XAxis dataKey="distance" stroke="#666" tick={{ fontSize: 12 }} />
              <YAxis stroke="#666" tick={{ fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ background: '#0c0c0c', border: '1px solid #E10600' }}
                formatter={(v: number | string) =>
                  typeof v === 'number' ? (v / 100).toFixed(1) : v
                }
              />
              <Line type="monotone" dataKey="rpm" stroke="#7C3AED" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* DRS Status */}
      <div className="bg-f1-dark border border-f1-grid rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">DRS Status</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={telemetryData}>
            <CartesianGrid stroke="#1a1a1a" />
            <XAxis dataKey="distance" stroke="#666" tick={{ fontSize: 12 }} />
            <YAxis stroke="#666" tick={{ fontSize: 12 }} domain={[0, 100]} />
            <Tooltip 
              contentStyle={{ background: '#0c0c0c', border: '1px solid #E10600' }}
              formatter={(v: number | string) =>
                typeof v === 'number' ? (v > 0 ? 'OPEN' : 'CLOSED') : v
              }
            />
            <Bar dataKey="drs" fill="#4AFF00" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string | number;
  unit: string;
  color: string;
}) {
  return (
    <div className="bg-f1-dark border border-f1-grid rounded-lg p-4 text-center">
      <p className="text-xs text-gray-400 uppercase mb-2">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{unit}</p>
    </div>
  );
}
