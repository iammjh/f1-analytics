'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import Image from 'next/image';
import { getTeamColor } from '@/lib/f1-display';
import {
  fetchDriverStandings,
  fetchSeasonRaces,
  getCompletedRaces,
  getUpcomingRaces,
} from '@/lib/jolpica-client';
import { 
  Activity, 
  Trophy, 
  Target, 
  Swords, 
  TrendingUp, 
  Star, 
  MapPin, 
  Calendar, 
  Clock,
  Wrench,
  Users,
  History
} from 'lucide-react';
const CURRENT_SEASON = new Date().getFullYear();
const SEASON_CANDIDATES = [CURRENT_SEASON, CURRENT_SEASON - 1, CURRENT_SEASON - 2].map(String);

interface Driver {
  position: string;
  Driver: { driverId: string; givenName: string; familyName: string; permanentNumber: string };
  Constructors?: Array<{ name: string; constructorId: string }>;
  points: string;
  wins: string;
}

interface Race {
  round: string;
  raceName: string;
  date: string;
  time?: string;
  Circuit: { circuitName: string; Location: { country: string; locality: string } };
}

const FEATURES = [
  { icon: Activity, title: 'Live Telemetry',     desc: 'Real-time sensor data streamed from every car on track' },
  { icon: Trophy, title: 'Driver Rankings',    desc: 'Full championship standings with gap-to-leader tracking' },
  { icon: Target, title: 'Race Strategy',      desc: 'Pit stop windows, tire strategies, and compound choices' },
  { icon: Swords,  title: 'Head-to-Head',      desc: 'Compare any two drivers across every metric this season' },
  { icon: TrendingUp, title: 'Points Progression', desc: 'Interactive championship evolution chart, race by race' },
  { icon: Star, title: 'Watchlist',          desc: 'Pin your favorite drivers and constructors for fast access' },
];

const STATS = [
  { label: 'Teams', value: '11', accent: '#E10600' },
  { label: 'Cars',  value: '22', accent: '#FFD700' },
  { label: 'Rounds', value: '24', accent: '#27F4D2' },
];

// ─── Skeleton components ───────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-f1-grid">
      {[40, 120, 100, 50].map((w, i) => (
        <td key={i} className="p-4">
          <div className="h-3 rounded animate-pulse bg-f1-grid" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

function SkeletonRaceCard() {
  return (
    <div className="bg-f1-dark border border-f1-grid rounded-xl p-6 space-y-3">
      {[80, 140, 100, 60].map((w, i) => (
        <div key={i} className="h-3 rounded animate-pulse bg-f1-grid" style={{ width: w }} />
      ))}
    </div>
  );
}

export default function Home() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);
  const [standings, setStandings] = useState<Driver[]>([]);
  const [upcomingRaces, setUpcomingRaces] = useState<Race[]>([]);
  const [pastRaces, setPastRaces] = useState<Race[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeSeason, setActiveSeason] = useState(SEASON_CANDIDATES[0]);
  const heroRef = useRef<HTMLDivElement>(null);
  const userLabel = session?.user?.name || session?.user?.email?.split('@')[0] || 'Account';
  const userInitial = userLabel.trim().charAt(0).toUpperCase();
  const featuredRaces = useMemo(
    () => (pastRaces.length > 0 ? pastRaces : upcomingRaces),
    [pastRaces, upcomingRaces]
  );
  const showingRecentRaces = featuredRaces === pastRaces && pastRaces.length > 0;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;

    async function fetchData() {
      setDataError(null);
      try {
        for (const season of SEASON_CANDIDATES) {
          const [driverList, raceList] = await Promise.all([
            fetchDriverStandings(season, { limit: 5 }),
            fetchSeasonRaces(season, { limit: 30 }),
          ]);

          if (!driverList.length && !raceList.length) {
            continue;
          }

          setActiveSeason(season);
          setStandings(driverList);

          const now = new Date();
          const upcoming = getUpcomingRaces(raceList, now).slice(0, 3);
          const past = getCompletedRaces(raceList, now).slice(-3).reverse();
          setUpcomingRaces(upcoming);
          setPastRaces(past);
          return;
        }
      } catch {
        setDataError('Could not load standings or race data. Check your connection and try again.');
      } finally {
        setDataLoading(false);
      }
    }

    fetchData();
  }, [mounted]);

  // Parallax scroll effect (JS-based — avoids iOS backgroundAttachment:fixed bug)
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const img = hero.querySelector<HTMLElement>('.hero-bg-img');
    if (!img) return;
    const onScroll = () => {
      const scrolled = window.scrollY;
      img.style.transform = `translateY(${scrolled * 0.35}px)`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [mounted]);

  if (!mounted || status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-f1-black">
        <div className="text-center space-y-4">
          <img src="/F1-Logo.png" alt="F1" className="w-24 mx-auto" style={{objectFit:"contain"}}/>
          <h1 className="text-3xl font-black text-white font-f1-display">Pitwall Analytics Hub</h1>
          <div className="flex gap-1 justify-center">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 bg-f1-red rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-f1-black overflow-x-hidden">

      {/* ── Fixed Nav ──────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-f1-black/85 backdrop-blur-md border-b border-f1-grid">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 h-14 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <img src="/F1-Logo.png" alt="F1" className="w-10 sm:w-14" style={{objectFit:"contain"}}/>
            <span className="text-white font-black text-base sm:text-xl tracking-tight font-f1-display">Pitwall Analytics</span>
            <span className="hidden sm:block text-xs text-f1-red font-bold bg-f1-red/10 px-2 py-0.5 rounded-full border border-f1-red/30 font-f1-display">
              {activeSeason}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {status === 'authenticated' ? (
              <div className="relative group">
                <button className="px-3 sm:px-4 py-2 bg-f1-red hover:bg-red-700 text-white font-semibold rounded-lg transition text-xs sm:text-sm inline-flex items-center gap-2 max-w-[170px] sm:max-w-[240px] border border-red-500/40">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-white text-[12px] font-extrabold text-f1-red">
                    {userInitial}
                  </span>
                  <span className="truncate">{userLabel}</span>
                  <span className="transition group-hover:rotate-180 group-focus-within:rotate-180">▾</span>
                </button>
                <div className="absolute right-0 mt-2 w-56 bg-f1-dark border border-f1-grid rounded-lg shadow-xl overflow-hidden opacity-0 invisible translate-y-1 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 transition">
                  <Link
                    href="/dashboard"
                    className="block px-4 py-2.5 text-sm text-white/90 hover:bg-white/5"
                  >
                    Go to Dashboard
                  </Link>
                  <button
                    onClick={() => signOut({ callbackUrl: '/home' })}
                    className="w-full text-left px-4 py-2.5 text-sm text-white/90 hover:bg-white/5"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Link
                  href="/auth/signin"
                  className="px-3 sm:px-5 py-2 text-white/70 hover:text-white text-xs sm:text-sm font-medium transition"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/signin"
                  className="px-3 sm:px-5 py-2 bg-f1-red hover:bg-red-700 text-white font-bold rounded-lg transition text-xs sm:text-sm whitespace-nowrap"
                >
                  Get Started →
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      {/* BUG FIX: removed backgroundAttachment:'fixed' (breaks iOS/Safari)
          Using JS parallax instead. Also removed -mx-4/-mx-8 that caused horizontal overflow. */}
      <div ref={heroRef} className="relative w-full min-h-screen flex flex-col items-center justify-center overflow-hidden pt-14 sm:pt-16">

        {/* Background image — JS parallax, no iOS issues */}
        <div className="hero-bg-img absolute inset-0 will-change-transform" style={{ top: '-15%', bottom: '-15%' }}>
          <Image
            src="/hero-f1-car.jpg"
            alt="F1 race car"
            fill
            priority
            className="object-cover object-center"
            sizes="100vw"
          />
        </div>

        {/* Gradient layers — darker for better text legibility */}
        <div className="absolute inset-0 bg-gradient-to-b from-f1-black/70 via-f1-black/55 to-f1-black pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-f1-black/40 via-transparent to-f1-black/40 pointer-events-none" />

        {/* Animated scan line accent */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-f1-red to-transparent opacity-60" />

        {/* Hero content */}
        <div className="relative z-10 max-w-5xl mx-auto px-4 text-center py-16 sm:py-24">
          <div className="inline-flex items-center gap-2 bg-f1-red/15 border border-f1-red/30 rounded-full px-3 sm:px-4 py-1.5 mb-6 sm:mb-8 font-f1-display">
            <span className="w-2 h-2 rounded-full bg-f1-red animate-pulse" />
            <span className="text-f1-red text-xs sm:text-sm font-bold tracking-wider uppercase">Live {activeSeason} Season</span>
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-8xl font-black text-white mb-5 sm:mb-6 leading-none tracking-tighter" style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
            F1 Data<br />
            <span className="text-f1-red">Reimagined</span>
          </h1>

          <p className="text-base sm:text-xl md:text-2xl text-white/70 mb-8 sm:mb-12 max-w-2xl mx-auto leading-relaxed">
            Real-time telemetry, race strategy analysis, and deep championship insights — all in one place.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-10 sm:mb-16">
            <Link
              href="/auth/signin"
              className="w-full sm:w-auto px-6 sm:px-10 py-3 sm:py-4 bg-f1-red hover:bg-red-700 text-white font-black rounded-xl transition-all hover:scale-105 text-base sm:text-lg shadow-lg shadow-f1-red/25"
            >
              Enter Dashboard →
            </Link>
            <a
              href="#features"
              className="w-full sm:w-auto px-6 sm:px-10 py-3 sm:py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition border border-white/20 text-base sm:text-lg backdrop-blur-sm"
            >
              Explore Features
            </a>
          </div>

          {/* Live stat pills */}
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { icon: Wrench, label: '11 Teams', color: '#FF8000' },
              { icon: Users, label: '22 Cars', color: '#27F4D2' },
              { icon: Activity, label: 'Live Telemetry', color: '#E10600' },
              { icon: History, label: 'Historical Data', color: '#a855f7' },
            ].map((pill) => {
              const Icon = pill.icon;
              return (
                <div key={pill.label} className="flex items-center gap-2 bg-black/40 backdrop-blur border border-white/10 rounded-full px-3.5 sm:px-4.5 py-2 text-xs sm:text-sm text-white/80 transition-all duration-200 hover:border-white/20 hover:bg-black/60">
                  <Icon className="w-4 h-4 flex-shrink-0" style={{ color: pill.color }} />
                  <span className="font-medium">{pill.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="hidden sm:flex absolute bottom-8 left-1/2 -translate-x-1/2 flex-col items-center gap-1 opacity-50">
          <span className="text-white/60 text-xs uppercase tracking-widest">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-white/60 to-transparent" />
        </div>
      </div>

      {/* ── Main content ───────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8">

        {/* Stats bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 -mt-6 sm:-mt-8 mb-14 sm:mb-20 relative z-10 font-f1-display">
          {STATS.map(s => (
            <div key={s.label} className="bg-f1-dark border border-f1-grid rounded-xl p-4 md:p-6 text-center backdrop-blur">
              <p className="text-3xl md:text-5xl font-black mb-1" style={{ color: s.accent }}>{s.value}</p>
              <p className="text-white/50 text-xs md:text-sm uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Driver Standings Preview */}
        <section className="mb-16 sm:mb-20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
            <div>
              <h2 className="text-2xl font-black text-white font-f1-display">{activeSeason} Driver Standings</h2>
              <p className="text-white/40 text-sm mt-1">Top 5 · Championship points</p>
            </div>
            <Link href="/auth/signin" className="text-f1-red text-sm font-bold hover:underline">
              Full standings →
            </Link>
          </div>

          {dataError && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
              <span className="text-red-400">⚠</span>
              <span>{dataError}</span>
            </div>
          )}

          <div className="bg-f1-dark border border-f1-grid rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b-2 border-f1-red">
                  <tr className="font-f1-display">
                    <th className="text-left p-3 sm:p-4 text-f1-red font-bold text-xs uppercase tracking-wider w-12">Pos</th>
                    <th className="text-left p-3 sm:p-4 text-f1-red font-bold text-xs uppercase tracking-wider">Driver</th>
                    <th className="text-left p-3 sm:p-4 text-f1-red font-bold text-xs uppercase tracking-wider hidden sm:table-cell">Team</th>
                    <th className="text-center p-3 sm:p-4 text-f1-red font-bold text-xs uppercase tracking-wider hidden md:table-cell w-16">Wins</th>
                    <th className="text-right p-3 sm:p-4 text-f1-red font-bold text-xs uppercase tracking-wider w-20">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {dataLoading
                    ? Array(5).fill(0).map((_, i) => <SkeletonRow key={i} />)
                    : dataError
                    ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-red-300/80 text-sm">
                          Standings unavailable — see message above.
                        </td>
                      </tr>
                    )
                    : standings.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-white/30 text-sm">
                          No standings data available for {activeSeason}
                        </td>
                      </tr>
                    )
                    : standings.slice(0, 5).map((d) => {
                        const tc = getTeamColor(d.Constructors?.[0]?.constructorId);
                        const medal = ['1','2','3'].includes(d.position);
                        return (
                          <tr key={d.Driver.driverId} className="border-b border-f1-grid hover:bg-white/[0.02] transition">
                            <td className="p-3 sm:p-4">
                              <span className={`w-7 h-7 inline-flex items-center justify-center rounded-full text-xs font-black font-f1-display ${medal ? '' : 'text-white/40'}`}
                                style={medal ? { background: d.position==='1'?'#FFD700':d.position==='2'?'#C0C0C0':'#CD7F32', color:'#000' } : {}}>
                                {d.position}
                              </span>
                            </td>
                            <td className="p-3 sm:p-4">
                              <div className="flex items-center gap-3">
                                <div className="w-1 h-8 rounded-full" style={{ background: tc }} />
                                <div>
                                  <p className="font-bold text-white">{d.Driver.givenName} {d.Driver.familyName}</p>
                                  <p className="text-white/30 text-xs font-mono">#{d.Driver.permanentNumber}</p>
                                </div>
                              </div>
                            </td>
                            <td className="p-3 sm:p-4 hidden sm:table-cell" style={{ color: tc }}>
                              <span className="font-medium text-sm">{d.Constructors?.[0]?.name ?? '—'}</span>
                            </td>
                            <td className="p-3 sm:p-4 text-center font-mono text-white/60 hidden md:table-cell font-f1-display">{d.wins}</td>
                            <td className="p-3 sm:p-4 text-right font-black text-f1-red font-mono font-f1-display">{d.points}</td>
                          </tr>
                        );
                      })
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Upcoming Races */}
        <section className="mb-16 sm:mb-20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
            <div>
              <h2 className="text-2xl font-black text-white font-f1-display">
                {showingRecentRaces ? 'Recent Races' : 'Upcoming Races'}
              </h2>
              <p className="text-white/40 text-sm mt-1">
                {showingRecentRaces ? `Latest completed rounds · ${activeSeason}` : `${activeSeason} calendar`}
              </p>
            </div>
            <Link href="/auth/signin" className="text-f1-red text-sm font-bold hover:underline">
              {showingRecentRaces ? 'Full results →' : 'Full calendar →'}
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {dataLoading
              ? Array(3).fill(0).map((_, i) => <SkeletonRaceCard key={i} />)
              : featuredRaces.map((race) => {
                  const raceDate = new Date(race.date);
                  const isUpcoming = raceDate > new Date();
                  return (
                    <div key={race.round} className="bg-f1-dark border border-f1-grid hover:border-f1-red rounded-xl p-6 transition group">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-f1-red font-mono text-sm font-bold bg-f1-red/10 px-2 py-0.5 rounded font-f1-display">
                          R{race.round}
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isUpcoming ? 'bg-f1-accent/15 text-f1-accent' : 'bg-white/10 text-white/40'}`}>
                          {isUpcoming ? 'Upcoming' : 'Completed'}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white mb-2 group-hover:text-f1-red transition leading-tight">
                        {race.raceName}
                      </h3>
                      <p className="text-white/50 text-sm mb-1 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-f1-red flex-shrink-0" />
                        <span>{race.Circuit?.Location?.locality}, {race.Circuit?.Location?.country}</span>
                      </p>
                      <p className="text-white/40 text-xs mb-4 truncate pl-5">{race.Circuit?.circuitName}</p>
                      <div className="pt-3 border-t border-f1-grid space-y-1.5">
                        <p className="text-f1-red font-bold text-sm flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{raceDate.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' })}</span>
                        </p>
                        {race.time && (
                          <p className="text-white/30 text-xs font-mono flex items-center gap-1.5 pl-5">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            <span>{race.time.replace('Z', ' UTC')}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mb-16 sm:mb-20 scroll-mt-20">
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl font-black text-white mb-3 font-f1-display">Everything You Need</h2>
            <p className="text-white/40 max-w-xl mx-auto">A complete analytics suite built for F1 fans and data enthusiasts</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="group bg-f1-dark border border-f1-grid hover:border-f1-red rounded-xl p-6 transition-all hover:-translate-y-0.5 cursor-default">
                  <div className="w-12 h-12 bg-f1-grid group-hover:bg-f1-red/15 rounded-xl flex items-center justify-center mb-4 transition text-f1-red">
                    <Icon className="w-6 h-6 stroke-[1.75]" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2 group-hover:text-f1-red transition">{f.title}</h3>
                  <p className="text-white/45 text-sm leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* CTA Banner */}
        {!session && (
          <section className="mb-16 sm:mb-20">
            <div className="relative overflow-hidden bg-gradient-to-br from-f1-red/20 via-f1-red/10 to-transparent border border-f1-red/40 rounded-2xl p-6 sm:p-10 md:p-16 text-center">
              {/* Decorative glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-px bg-gradient-to-r from-transparent via-f1-red to-transparent" />
              <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-f1-red/5 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10">
                <img src="/F1-Logo.png" alt="F1" style={{width:80,margin:"0 auto 12px",objectFit:"contain"}}/>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-4">Ready to Dive In?</h2>
                <p className="text-white/60 mb-8 text-base sm:text-lg max-w-md mx-auto">
                  Access advanced analytics, live telemetry, and real-time race data.
                </p>
                <Link
                  href="/auth/signin"
                  className="inline-block w-full sm:w-auto px-6 sm:px-10 py-3 sm:py-4 bg-f1-red hover:bg-red-700 text-white font-bold rounded-xl transition-all hover:scale-105 text-base sm:text-lg shadow-xl shadow-f1-red/30"
                >
                  Get Started — It&apos;s Free →
                </Link>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-f1-grid py-10 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
          <div className="flex items-center gap-3">
            <img src="/F1-Logo.png" alt="F1" style={{width:48,objectFit:"contain"}}/>
            <span className="text-white/60 text-sm font-bold font-f1-display">Pitwall Analytics Hub</span>
          </div>
          <p className="text-white/30 text-sm">
            © {new Date().getFullYear()} · Data via Jolpica / Ergast API · OpenF1
          </p>
          <div className="flex items-center gap-4 sm:gap-6">
            {!session && (
              <Link href="/auth/signin" className="text-white/40 hover:text-white text-sm transition">Sign In</Link>
            )}
            <a href="https://iammjh.github.io" target="_blank" rel="noreferrer" className="text-white/45 hover:text-f1-red text-sm transition font-medium">Developed by iammjh</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
