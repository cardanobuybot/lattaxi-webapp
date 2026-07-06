import { useState, useEffect, useCallback } from 'react';

const API = 'https://api.lattaxi.lv';

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', 'x-admin-token': token };
}

// --- Types ---
interface Stats { active_rides: number; completed_today: number; drivers_online: number; drivers_pending: number; drivers_total: number; revenue_today: string; }
interface Driver { id: number; telegram_id: string; name: string; car: string; car_number: string; category: string; verification_status: string; license_number: string | null; rejection_reason: string | null; is_online: boolean; created_at: string; }
interface Ride { id: number; status: string; pickup_address: string; dropoff_address: string; estimated_price: string; category: string; created_at: string; driver_name: string | null; driver_car: string | null; driver_car_number: string | null; passenger_comment: string | null; }

export default function AdminPanel() {
  const [token, setToken] = useState(() => localStorage.getItem('lattaxi_admin_token') || '');
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tab, setTab] = useState<'stats' | 'drivers' | 'rides'>('stats');

  const [stats, setStats] = useState<Stats | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(false);
  const [driverFilter, setDriverFilter] = useState<'pending' | 'all'>('pending');
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchStats = useCallback(async (t: string) => {
    const r = await fetch(`${API}/admin/stats`, { headers: authHeaders(t) });
    const d = await r.json();
    if (d.ok) setStats(d);
    return d.ok;
  }, []);

  async function login() {
    setLoading(true);
    const ok = await fetchStats(tokenInput).catch(() => false);
    setLoading(false);
    if (ok) {
      localStorage.setItem('lattaxi_admin_token', tokenInput);
      setToken(tokenInput);
      setAuthed(true);
    } else {
      alert('Nepareizs tokens');
    }
  }

  useEffect(() => {
    if (token) fetchStats(token).then(ok => { if (ok) setAuthed(true); });
  }, [token, fetchStats]);

  const loadDrivers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const r = await fetch(`${API}/admin/drivers?status=${driverFilter}`, { headers: authHeaders(token) });
    const d = await r.json();
    if (d.ok) setDrivers(d.drivers);
    setLoading(false);
  }, [token, driverFilter]);

  const loadRides = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const r = await fetch(`${API}/admin/rides?status=active`, { headers: authHeaders(token) });
    const d = await r.json();
    if (d.ok) setRides(d.rides);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (!authed) return;
    if (tab === 'stats') fetchStats(token);
    if (tab === 'drivers') loadDrivers();
    if (tab === 'rides') loadRides();
  }, [tab, authed, driverFilter, fetchStats, loadDrivers, loadRides, token]);

  async function verifyDriver(id: number, action: 'approve' | 'reject') {
    await fetch(`${API}/admin/drivers/${id}/verify`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ action, reason: rejectReason || undefined }),
    });
    setRejectingId(null);
    setRejectReason('');
    loadDrivers();
  }

  const STATUS_LABELS: Record<string, string> = {
    requested: 'Meklē', driver_assigned: 'Piešķirts', driver_arrived: 'Ieradies',
    trip_started: 'Brauc', trip_completed: 'Pabeigts', cancelled: 'Atcelts',
  };
  const STATUS_COLORS: Record<string, string> = {
    requested: 'text-yellow-400 bg-yellow-400/10',
    driver_assigned: 'text-blue-400 bg-blue-400/10',
    driver_arrived: 'text-green-400 bg-green-400/10',
    trip_started: 'text-[#FFCC00] bg-[#FFCC00]/10',
    trip_completed: 'text-green-400 bg-green-400/10',
    cancelled: 'text-red-400 bg-red-400/10',
  };
  const VERIFY_COLORS: Record<string, string> = {
    pending: 'text-yellow-400 bg-yellow-400/10',
    approved: 'text-green-400 bg-green-400/10',
    rejected: 'text-red-400 bg-red-400/10',
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🚕</div>
            <h1 className="text-white font-bold text-2xl">LatTaxi Admin</h1>
          </div>
          <input
            type="password"
            className="w-full bg-[#1a1d27] text-white placeholder-slate-500 rounded-2xl px-4 py-3.5 text-sm outline-none border border-[#ffffff10] focus:border-[#FFCC00]/50"
            placeholder="Admin tokens"
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
          />
          <button onClick={login} disabled={loading || !tokenInput}
            className="w-full bg-[#FFCC00] disabled:opacity-40 text-[#0f1117] font-bold py-4 rounded-2xl">
            {loading ? 'Pārbauda...' : 'Ieiet'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      {/* header */}
      <div className="bg-[#1a1d27] border-b border-[#ffffff10] px-4 py-3 flex items-center justify-between">
        <h1 className="font-bold text-lg">🚕 LatTaxi Admin</h1>
        <button onClick={() => { localStorage.removeItem('lattaxi_admin_token'); setAuthed(false); setToken(''); }}
          className="text-slate-500 text-sm">Iziet</button>
      </div>

      {/* tabs */}
      <div className="flex border-b border-[#ffffff10]">
        {(['stats', 'drivers', 'rides'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold capitalize border-b-2 transition-colors ${tab === t ? 'border-[#FFCC00] text-[#FFCC00]' : 'border-transparent text-slate-500'}`}>
            {t === 'stats' ? 'Statistika' : t === 'drivers' ? 'Vadītāji' : 'Braucieni'}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">

        {/* STATS */}
        {tab === 'stats' && stats && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#1a1d27] rounded-2xl p-4">
                <p className="text-slate-400 text-xs mb-1">Aktīvie braucieni</p>
                <p className="text-[#FFCC00] font-extrabold text-3xl">{stats.active_rides}</p>
              </div>
              <div className="bg-[#1a1d27] rounded-2xl p-4">
                <p className="text-slate-400 text-xs mb-1">Pabeigti šodien</p>
                <p className="text-white font-extrabold text-3xl">{stats.completed_today}</p>
              </div>
              <div className="bg-[#1a1d27] rounded-2xl p-4">
                <p className="text-slate-400 text-xs mb-1">Vadītāji online</p>
                <p className="text-green-400 font-extrabold text-3xl">{stats.drivers_online}</p>
              </div>
              <div className="bg-[#1a1d27] rounded-2xl p-4">
                <p className="text-slate-400 text-xs mb-1">Gaida verifikāciju</p>
                <p className={`font-extrabold text-3xl ${stats.drivers_pending > 0 ? 'text-yellow-400' : 'text-slate-500'}`}>{stats.drivers_pending}</p>
              </div>
            </div>
            <div className="bg-[#1a1d27] rounded-2xl p-4 flex justify-between items-center">
              <span className="text-slate-400 text-sm">Ieņēmumi šodien</span>
              <span className="text-[#FFCC00] font-extrabold text-2xl">€{stats.revenue_today}</span>
            </div>
            <div className="bg-[#1a1d27] rounded-2xl p-4 flex justify-between items-center">
              <span className="text-slate-400 text-sm">Vadītāji kopā</span>
              <span className="text-white font-bold text-xl">{stats.drivers_total}</span>
            </div>
            <button onClick={() => fetchStats(token)}
              className="w-full bg-[#252836] text-slate-300 py-3 rounded-2xl text-sm">
              ↻ Atjaunot
            </button>
          </div>
        )}

        {/* DRIVERS */}
        {tab === 'drivers' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(['pending', 'all'] as const).map(f => (
                <button key={f} onClick={() => setDriverFilter(f)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold ${driverFilter === f ? 'bg-[#FFCC00] text-[#0f1117]' : 'bg-[#252836] text-slate-300'}`}>
                  {f === 'pending' ? 'Gaida verifikāciju' : 'Visi'}
                </button>
              ))}
            </div>

            {loading && <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-24 bg-[#1a1d27] rounded-2xl animate-pulse" />)}</div>}

            {!loading && drivers.length === 0 && (
              <div className="text-center py-12 text-slate-500">Nav vadītāju</div>
            )}

            {drivers.map(d => (
              <div key={d.id} className="bg-[#1a1d27] rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white font-bold">{d.name}</p>
                    <p className="text-slate-400 text-sm">{d.car} · {d.car_number}</p>
                    {d.license_number && <p className="text-slate-500 text-xs mt-0.5">Apl. nr: {d.license_number}</p>}
                    <p className="text-slate-600 text-xs mt-0.5">TG: {d.telegram_id} · {d.category}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${VERIFY_COLORS[d.verification_status] || 'text-slate-400 bg-slate-700/30'}`}>
                    {d.verification_status === 'pending' ? '⏳ Gaida' : d.verification_status === 'approved' ? '✓ Apstiprināts' : '✕ Noraidīts'}
                  </span>
                </div>

                {d.rejection_reason && (
                  <p className="text-red-400 text-xs bg-red-500/10 rounded-xl px-3 py-2">Iemesls: {d.rejection_reason}</p>
                )}

                {d.verification_status === 'pending' && (
                  rejectingId === d.id ? (
                    <div className="space-y-2">
                      <input
                        className="w-full bg-[#252836] text-white placeholder-slate-500 rounded-xl px-3 py-2 text-sm outline-none"
                        placeholder="Noraidīšanas iemesls..."
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button onClick={() => { setRejectingId(null); setRejectReason(''); }}
                          className="flex-1 bg-[#252836] text-slate-300 py-2.5 rounded-xl text-sm">Atcelt</button>
                        <button onClick={() => verifyDriver(d.id, 'reject')}
                          className="flex-1 bg-red-500 text-white font-bold py-2.5 rounded-xl text-sm">Noraidīt</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => { setRejectingId(d.id); }}
                        className="flex-1 bg-red-500/15 border border-red-500/30 text-red-400 font-semibold py-2.5 rounded-xl text-sm">
                        ✕ Noraidīt
                      </button>
                      <button onClick={() => verifyDriver(d.id, 'approve')}
                        className="flex-[2] bg-green-500 text-white font-bold py-2.5 rounded-xl text-sm">
                        ✓ Apstiprināt
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )}

        {/* RIDES */}
        {tab === 'rides' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-slate-400 text-sm">{rides.length} aktīvie braucieni</p>
              <button onClick={loadRides} className="bg-[#252836] text-slate-300 px-3 py-1.5 rounded-full text-xs">↻ Atjaunot</button>
            </div>

            {loading && <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-28 bg-[#1a1d27] rounded-2xl animate-pulse" />)}</div>}

            {!loading && rides.length === 0 && (
              <div className="text-center py-12 text-slate-500">Nav aktīvu braucienu</div>
            )}

            {rides.map(r => (
              <div key={r.id} className="bg-[#1a1d27] rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-xs">#{r.id} · {new Date(r.created_at).toLocaleTimeString('lv-LV', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[r.status] || 'text-slate-400 bg-slate-700/30'}`}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-start gap-2"><div className="w-2 h-2 rounded-full bg-green-400 mt-1.5 flex-shrink-0" /><span className="text-slate-300 text-sm">{r.pickup_address || '—'}</span></div>
                  <div className="flex items-start gap-2"><div className="w-2 h-2 rounded-sm bg-red-400 mt-1.5 flex-shrink-0" /><span className="text-slate-300 text-sm">{r.dropoff_address || '—'}</span></div>
                </div>
                {r.passenger_comment && <p className="text-slate-500 text-xs italic">💬 {r.passenger_comment}</p>}
                <div className="flex items-center justify-between pt-1 border-t border-[#ffffff08]">
                  <span className="text-slate-500 text-xs">{r.driver_name ? `🚗 ${r.driver_name} · ${r.driver_car_number}` : 'Bez vadītāja'}</span>
                  <span className="text-[#FFCC00] font-bold">€{Number(r.estimated_price || 0).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
