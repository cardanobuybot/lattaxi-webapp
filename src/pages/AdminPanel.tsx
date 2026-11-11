import { useState, useEffect, useCallback, useRef } from 'react';

const API = 'https://api.lattaxi.lv';

function getTgInitData(): string | null {
  return window.Telegram?.WebApp?.initData || null;
}

function authHeaders(token: string, initData: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (initData) h['x-admin-init-data'] = initData;
  else if (token) h['x-admin-token'] = token;
  return h;
}

// --- Types ---
interface Stats {
  active_rides: number; completed_today: number; completed_7d: number;
  drivers_online: number; drivers_pending: number; drivers_total: number;
  revenue_today: string; revenue_7d: string;
  payment_errors: number; transfer_pending: number;
  blocked_users: number; blocked_drivers: number;
}
interface Driver {
  id: number; telegram_id: string; name: string; car: string;
  car_number: string; category: string; verification_status: string;
  license_number: string | null; rejection_reason: string | null;
  is_online: boolean; is_blocked: boolean; created_at: string;
}
interface Ride {
  id: number; status: string; payment_status: string | null;
  pickup_address: string; dropoff_address: string;
  estimated_price: string; final_price: string | null;
  category: string; created_at: string;
  driver_name: string | null; driver_car: string | null;
  driver_car_number: string | null; passenger_comment: string | null;
  payment_intent_id: string | null; stripe_charge_id: string | null;
}
interface AdminAction {
  id: number; admin_telegram_id: string; action: string;
  target_type: string | null; target_id: string | null;
  payload: Record<string, unknown>; created_at: string;
}

type Tab = 'overview' | 'drivers' | 'rides' | 'log';
type DriverFilter = 'pending' | 'all' | 'online' | 'rejected';
type RideStatusFilter = 'active' | 'today' | 'all';
type RidePaymentFilter = 'all' | 'error' | 'transfer_pending';

const STATUS_LABELS: Record<string, string> = {
  requested: 'Поиск', driver_assigned: 'Назначен', driver_arrived: 'Прибыл',
  trip_started: 'В пути', trip_completed: 'Завершён', cancelled: 'Отменён',
};
const STATUS_COLORS: Record<string, string> = {
  requested: 'text-yellow-400 bg-yellow-400/10',
  driver_assigned: 'text-blue-400 bg-blue-400/10',
  driver_arrived: 'text-green-400 bg-green-400/10',
  trip_started: 'text-[#FFCC00] bg-[#FFCC00]/10',
  trip_completed: 'text-green-400 bg-green-400/10',
  cancelled: 'text-red-400 bg-red-400/10',
};
const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Оплачен', error: 'Ошибка', transfer_pending: 'Перевод ожидает',
  refunded: 'Возврат', unpaid: 'Не оплачен',
};
const PAYMENT_COLORS: Record<string, string> = {
  paid: 'text-green-400 bg-green-400/10',
  error: 'text-red-400 bg-red-400/10',
  transfer_pending: 'text-orange-400 bg-orange-400/10',
  refunded: 'text-purple-400 bg-purple-400/10',
};
const VERIFY_COLORS: Record<string, string> = {
  pending: 'text-yellow-400 bg-yellow-400/10',
  approved: 'text-green-400 bg-green-400/10',
  rejected: 'text-red-400 bg-red-400/10',
};

function fmt(d: string) {
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Skeleton({ rows = 3, h = 'h-24' }: { rows?: number; h?: string }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className={`${h} bg-[#1a1d27] rounded-2xl animate-pulse`} />)}</div>;
}

export default function AdminPanel() {
  const initData = useRef(getTgInitData());
  const [token, setToken] = useState(() => localStorage.getItem('lattaxi_admin_token') || '');
  const [tokenInput, setTokenInput] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState<Tab>('overview');

  // Overview
  const [stats, setStats] = useState<Stats | null>(null);

  // Drivers
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversTotal, setDriversTotal] = useState(0);
  const [driverFilter, setDriverFilter] = useState<DriverFilter>('pending');
  const [driverOffset, setDriverOffset] = useState(0);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [blockingDriverId, setBlockingDriverId] = useState<number | null>(null);
  const [blockReason, setBlockReason] = useState('');

  // Rides
  const [rides, setRides] = useState<Ride[]>([]);
  const [ridesTotal, setRidesTotal] = useState(0);
  const [rideStatusFilter, setRideStatusFilter] = useState<RideStatusFilter>('active');
  const [ridePaymentFilter, setRidePaymentFilter] = useState<RidePaymentFilter>('all');
  const [rideOffset, setRideOffset] = useState(0);
  const [refundingId, setRefundingId] = useState<number | null>(null);
  const [refundReason, setRefundReason] = useState('requested_by_customer');
  const [refundLoading, setRefundLoading] = useState(false);

  // Log
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [actionsTotal, setActionsTotal] = useState(0);
  const [actionsOffset, setActionsOffset] = useState(0);

  const headers = useCallback(() => authHeaders(token, initData.current), [token]);

  // Try Telegram Mini App auth on mount
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready?.();
      window.Telegram.WebApp.expand?.();
    }
    if (initData.current) {
      fetch(`${API}/admin/stats`, { headers: authHeaders('', initData.current) })
        .then(r => r.json())
        .then(d => { if (d.ok) { setStats(d); setAuthed(true); } })
        .catch(() => {});
    } else if (token) {
      fetch(`${API}/admin/stats`, { headers: authHeaders(token, null) })
        .then(r => r.json())
        .then(d => { if (d.ok) { setStats(d); setAuthed(true); } })
        .catch(() => {});
    }
  }, [token]);

  async function login() {
    setLoading(true);
    setAuthError('');
    try {
      const r = await fetch(`${API}/admin/stats`, { headers: authHeaders(tokenInput, null) });
      const d = await r.json();
      if (d.ok) {
        localStorage.setItem('lattaxi_admin_token', tokenInput);
        setToken(tokenInput);
        setStats(d);
        setAuthed(true);
      } else {
        setAuthError('Неверный токен');
      }
    } catch {
      setAuthError('Ошибка подключения');
    }
    setLoading(false);
  }

  function logout() {
    localStorage.removeItem('lattaxi_admin_token');
    setToken('');
    setAuthed(false);
    setStats(null);
  }

  const fetchStats = useCallback(async () => {
    const r = await fetch(`${API}/admin/stats`, { headers: headers() });
    const d = await r.json();
    if (d.ok) setStats(d);
  }, [headers]);

  const loadDrivers = useCallback(async (offset = 0) => {
    setLoading(true);
    const params = new URLSearchParams({ status: driverFilter, limit: '20', offset: String(offset) });
    const r = await fetch(`${API}/admin/drivers?${params}`, { headers: headers() });
    const d = await r.json();
    if (d.ok) { setDrivers(d.drivers); setDriversTotal(d.total); setDriverOffset(offset); }
    setLoading(false);
  }, [driverFilter, headers]);

  const loadRides = useCallback(async (offset = 0) => {
    setLoading(true);
    const params = new URLSearchParams({ status: rideStatusFilter, limit: '20', offset: String(offset) });
    if (ridePaymentFilter !== 'all') params.set('payment_status', ridePaymentFilter);
    const r = await fetch(`${API}/admin/rides?${params}`, { headers: headers() });
    const d = await r.json();
    if (d.ok) { setRides(d.rides); setRidesTotal(d.total); setRideOffset(offset); }
    setLoading(false);
  }, [rideStatusFilter, ridePaymentFilter, headers]);

  const loadActions = useCallback(async (offset = 0) => {
    setLoading(true);
    const r = await fetch(`${API}/admin/actions?limit=20&offset=${offset}`, { headers: headers() });
    const d = await r.json();
    if (d.ok) { setActions(d.actions); setActionsTotal(d.total); setActionsOffset(offset); }
    setLoading(false);
  }, [headers]);

  useEffect(() => {
    if (!authed) return;
    if (tab === 'overview') fetchStats();
    if (tab === 'drivers') loadDrivers(0);
    if (tab === 'rides') loadRides(0);
    if (tab === 'log') loadActions(0);
  }, [tab, authed, driverFilter, rideStatusFilter, ridePaymentFilter, fetchStats, loadDrivers, loadRides, loadActions]);

  async function verifyDriver(id: number, action: 'approve' | 'reject') {
    await fetch(`${API}/admin/drivers/${id}/verify`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ action, reason: rejectReason || undefined }),
    });
    setRejectingId(null); setRejectReason('');
    loadDrivers(driverOffset);
  }

  async function blockDriver(id: number, block: boolean) {
    await fetch(`${API}/admin/drivers/${id}/block`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ block, reason: blockReason || undefined }),
    });
    setBlockingDriverId(null); setBlockReason('');
    loadDrivers(driverOffset);
  }

  async function retryTransfer(rideId: number) {
    const r = await fetch(`${API}/admin/rides/${rideId}/retry-transfer`, { method: 'POST', headers: headers() });
    const d = await r.json();
    alert(d.ok ? '✓ Перевод запущен' : `Ошибка: ${d.error}`);
    loadRides(rideOffset);
  }

  async function doRefund(rideId: number) {
    setRefundLoading(true);
    const r = await fetch(`${API}/admin/rides/${rideId}/refund`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ reason: refundReason }),
    });
    const d = await r.json();
    setRefundLoading(false);
    if (d.ok) { setRefundingId(null); alert(`✓ Возврат ${d.refund_id} создан`); loadRides(rideOffset); }
    else alert(`Ошибка: ${d.error}`);
  }

  // ---- LOGIN SCREEN ----
  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🛡</div>
            <h1 className="text-white font-bold text-2xl">LatTaxi Admin</h1>
            <p className="text-slate-500 text-sm mt-1">Введите токен доступа</p>
          </div>
          <input
            type="password"
            className="w-full bg-[#1a1d27] text-white placeholder-slate-500 rounded-2xl px-4 py-3.5 text-sm outline-none border border-[#ffffff10] focus:border-[#FFCC00]/50"
            placeholder="Admin токен"
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
          />
          {authError && <p className="text-red-400 text-sm text-center">{authError}</p>}
          <button onClick={login} disabled={loading || !tokenInput}
            className="w-full bg-[#FFCC00] disabled:opacity-40 text-[#0f1117] font-bold py-4 rounded-2xl">
            {loading ? 'Проверка...' : 'Войти'}
          </button>
        </div>
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Обзор' },
    { key: 'drivers', label: 'Водители' },
    { key: 'rides', label: 'Поездки' },
    { key: 'log', label: 'Журнал' },
  ];

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      {/* Header */}
      <div className="bg-[#1a1d27] border-b border-[#ffffff10] px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <h1 className="font-bold text-base">🛡 LatTaxi Admin</h1>
        {!initData.current && (
          <button onClick={logout} className="text-slate-500 text-sm">Выйти</button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#ffffff10] overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 min-w-[70px] py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? 'border-[#FFCC00] text-[#FFCC00]' : 'border-transparent text-slate-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 pb-8">

        {/* ======== ОБЗОР ======== */}
        {tab === 'overview' && (
          <div className="space-y-3">
            {!stats ? <Skeleton rows={4} /> : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Активные поездки" value={stats.active_rides} color="text-[#FFCC00]" />
                  <Stat label="Завершено сегодня" value={stats.completed_today} />
                  <Stat label="За 7 дней" value={stats.completed_7d} />
                  <Stat label="Водителей онлайн" value={stats.drivers_online} color="text-green-400" />
                  <Stat label="Ждут верификации" value={stats.drivers_pending}
                    color={stats.drivers_pending > 0 ? 'text-yellow-400' : undefined} />
                  <Stat label="Ошибки оплаты" value={stats.payment_errors}
                    color={stats.payment_errors > 0 ? 'text-red-400' : undefined} />
                </div>
                <div className="bg-[#1a1d27] rounded-2xl p-4 flex justify-between items-center">
                  <span className="text-slate-400 text-sm">Выручка сегодня</span>
                  <span className="text-[#FFCC00] font-extrabold text-2xl">€{stats.revenue_today}</span>
                </div>
                <div className="bg-[#1a1d27] rounded-2xl p-4 flex justify-between items-center">
                  <span className="text-slate-400 text-sm">Выручка за 7 дней</span>
                  <span className="text-white font-bold text-xl">€{stats.revenue_7d}</span>
                </div>
                {stats.transfer_pending > 0 && (
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-3 text-orange-400 text-sm">
                    ⚠ Ожидают перевода: {stats.transfer_pending} поездок
                  </div>
                )}
                {(stats.blocked_users > 0 || stats.blocked_drivers > 0) && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3 text-red-400 text-sm">
                    🚫 Заблокировано: {stats.blocked_users} пасс. / {stats.blocked_drivers} вод.
                  </div>
                )}
                <button onClick={fetchStats} className="w-full bg-[#252836] text-slate-300 py-3 rounded-2xl text-sm">↻ Обновить</button>
              </>
            )}
          </div>
        )}

        {/* ======== ВОДИТЕЛИ ======== */}
        {tab === 'drivers' && (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(['pending', 'all', 'online', 'rejected'] as DriverFilter[]).map(f => (
                <button key={f} onClick={() => setDriverFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 ${driverFilter === f ? 'bg-[#FFCC00] text-[#0f1117]' : 'bg-[#252836] text-slate-300'}`}>
                  {{ pending: 'Ожидают', all: 'Все', online: 'Онлайн', rejected: 'Отклонены' }[f]}
                </button>
              ))}
            </div>

            {loading && <Skeleton rows={3} />}

            {!loading && drivers.length === 0 && (
              <div className="text-center py-12 text-slate-500">Нет водителей</div>
            )}

            {!loading && drivers.map(d => (
              <div key={d.id} className="bg-[#1a1d27] rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white font-bold truncate">{d.name}</p>
                    <p className="text-slate-400 text-sm">{d.car} · {d.car_number}</p>
                    {d.license_number && <p className="text-slate-500 text-xs mt-0.5">Удост.: {d.license_number}</p>}
                    <p className="text-slate-600 text-xs mt-0.5">TG: {d.telegram_id} · {d.category}</p>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0 items-end">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${VERIFY_COLORS[d.verification_status] || 'text-slate-400 bg-slate-700/30'}`}>
                      {d.verification_status === 'pending' ? '⏳' : d.verification_status === 'approved' ? '✓' : '✕'}
                    </span>
                    {d.is_blocked && <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-red-400 bg-red-400/10">🚫</span>}
                    {d.is_online && <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-green-400 bg-green-400/10">●</span>}
                  </div>
                </div>

                {d.rejection_reason && (
                  <p className="text-red-400 text-xs bg-red-500/10 rounded-xl px-3 py-2">Причина: {d.rejection_reason}</p>
                )}

                {/* Verify buttons */}
                {d.verification_status === 'pending' && rejectingId !== d.id && blockingDriverId !== d.id && (
                  <div className="flex gap-2">
                    <button onClick={() => setRejectingId(d.id)}
                      className="flex-1 bg-red-500/15 border border-red-500/30 text-red-400 font-semibold py-2 rounded-xl text-sm">
                      ✕ Отклонить
                    </button>
                    <button onClick={() => verifyDriver(d.id, 'approve')}
                      className="flex-[2] bg-green-500 text-white font-bold py-2 rounded-xl text-sm">
                      ✓ Одобрить
                    </button>
                  </div>
                )}
                {rejectingId === d.id && (
                  <div className="space-y-2">
                    <input className="w-full bg-[#252836] text-white placeholder-slate-500 rounded-xl px-3 py-2 text-sm outline-none"
                      placeholder="Причина отклонения..." value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)} />
                    <div className="flex gap-2">
                      <button onClick={() => { setRejectingId(null); setRejectReason(''); }}
                        className="flex-1 bg-[#252836] text-slate-300 py-2 rounded-xl text-sm">Отмена</button>
                      <button onClick={() => verifyDriver(d.id, 'reject')}
                        className="flex-1 bg-red-500 text-white font-bold py-2 rounded-xl text-sm">Отклонить</button>
                    </div>
                  </div>
                )}

                {/* Block button */}
                {d.verification_status === 'approved' && rejectingId !== d.id && blockingDriverId !== d.id && (
                  <button onClick={() => { setBlockingDriverId(d.id); setBlockReason(''); }}
                    className={`w-full py-2 rounded-xl text-sm font-semibold ${d.is_blocked ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                    {d.is_blocked ? '✓ Разблокировать' : '🚫 Заблокировать'}
                  </button>
                )}
                {blockingDriverId === d.id && (
                  <div className="space-y-2">
                    <input className="w-full bg-[#252836] text-white placeholder-slate-500 rounded-xl px-3 py-2 text-sm outline-none"
                      placeholder="Причина..." value={blockReason}
                      onChange={e => setBlockReason(e.target.value)} />
                    <div className="flex gap-2">
                      <button onClick={() => setBlockingDriverId(null)}
                        className="flex-1 bg-[#252836] text-slate-300 py-2 rounded-xl text-sm">Отмена</button>
                      <button onClick={() => blockDriver(d.id, !d.is_blocked)}
                        className="flex-1 bg-red-500 text-white font-bold py-2 rounded-xl text-sm">
                        {d.is_blocked ? 'Разблокировать' : 'Заблокировать'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <Pagination total={driversTotal} offset={driverOffset} limit={20} onPage={loadDrivers} />
          </div>
        )}

        {/* ======== ПОЕЗДКИ ======== */}
        {tab === 'rides' && (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(['active', 'today', 'all'] as RideStatusFilter[]).map(f => (
                <button key={f} onClick={() => setRideStatusFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 ${rideStatusFilter === f ? 'bg-[#FFCC00] text-[#0f1117]' : 'bg-[#252836] text-slate-300'}`}>
                  {{ active: 'Активные', today: 'Сегодня', all: 'Все' }[f]}
                </button>
              ))}
              <div className="w-px bg-[#ffffff10] flex-shrink-0" />
              {(['all', 'error', 'transfer_pending'] as RidePaymentFilter[]).map(f => (
                <button key={f} onClick={() => setRidePaymentFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 ${ridePaymentFilter === f ? 'bg-[#FFCC00] text-[#0f1117]' : 'bg-[#252836] text-slate-300'}`}>
                  {{ all: 'Любой платёж', error: 'Ошибки', transfer_pending: 'Перевод ожидает' }[f]}
                </button>
              ))}
            </div>

            {loading && <Skeleton rows={3} h="h-32" />}

            {!loading && rides.length === 0 && (
              <div className="text-center py-12 text-slate-500">Нет поездок</div>
            )}

            {!loading && rides.map(ride => (
              <div key={ride.id} className="bg-[#1a1d27] rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 text-xs">#{ride.id} · {fmt(ride.created_at)}</span>
                  <div className="flex gap-1.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[ride.status] || 'text-slate-400 bg-slate-700/30'}`}>
                      {STATUS_LABELS[ride.status] || ride.status}
                    </span>
                    {ride.payment_status && ride.payment_status !== 'unpaid' && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PAYMENT_COLORS[ride.payment_status] || 'text-slate-400 bg-slate-700/30'}`}>
                        {PAYMENT_LABELS[ride.payment_status] || ride.payment_status}
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-start gap-2"><div className="w-2 h-2 rounded-full bg-green-400 mt-1.5 flex-shrink-0" /><span className="text-slate-300 text-sm leading-snug">{ride.pickup_address || '—'}</span></div>
                  <div className="flex items-start gap-2"><div className="w-2 h-2 rounded-sm bg-red-400 mt-1.5 flex-shrink-0" /><span className="text-slate-300 text-sm leading-snug">{ride.dropoff_address || '—'}</span></div>
                </div>
                {ride.passenger_comment && <p className="text-slate-500 text-xs italic">💬 {ride.passenger_comment}</p>}
                <div className="flex items-center justify-between pt-1 border-t border-[#ffffff08]">
                  <span className="text-slate-500 text-xs">{ride.driver_name ? `🚗 ${ride.driver_name} · ${ride.driver_car_number}` : 'Без водителя'}</span>
                  <span className="text-[#FFCC00] font-bold">€{Number(ride.final_price ?? ride.estimated_price ?? 0).toFixed(2)}</span>
                </div>
                {(ride.payment_intent_id || ride.stripe_charge_id) && (
                  <p className="text-slate-600 text-xs">
                    Stripe: ...{(ride.payment_intent_id || ride.stripe_charge_id || '').slice(-6)}
                  </p>
                )}

                {/* Actions */}
                {ride.payment_status === 'transfer_pending' && (
                  <button onClick={() => retryTransfer(ride.id)}
                    className="w-full bg-orange-500/15 border border-orange-500/30 text-orange-400 font-semibold py-2 rounded-xl text-sm">
                    ↻ Повторить перевод
                  </button>
                )}
                {ride.payment_status && ['paid', 'error'].includes(ride.payment_status) && ride.payment_intent_id && refundingId !== ride.id && (
                  <button onClick={() => { setRefundingId(ride.id); setRefundReason('requested_by_customer'); }}
                    className="w-full bg-red-500/10 border border-red-500/20 text-red-400 font-semibold py-2 rounded-xl text-sm">
                    ↩ Возврат
                  </button>
                )}
                {refundingId === ride.id && (
                  <div className="space-y-2">
                    <select value={refundReason} onChange={e => setRefundReason(e.target.value)}
                      className="w-full bg-[#252836] text-white rounded-xl px-3 py-2 text-sm outline-none">
                      <option value="requested_by_customer">По просьбе клиента</option>
                      <option value="fraudulent">Мошенничество</option>
                      <option value="duplicate">Дубликат</option>
                    </select>
                    <div className="flex gap-2">
                      <button onClick={() => setRefundingId(null)} className="flex-1 bg-[#252836] text-slate-300 py-2 rounded-xl text-sm">Отмена</button>
                      <button onClick={() => doRefund(ride.id)} disabled={refundLoading}
                        className="flex-1 bg-red-500 disabled:opacity-50 text-white font-bold py-2 rounded-xl text-sm">
                        {refundLoading ? '...' : 'Вернуть'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <Pagination total={ridesTotal} offset={rideOffset} limit={20} onPage={loadRides} />
          </div>
        )}

        {/* ======== ЖУРНАЛ ======== */}
        {tab === 'log' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-slate-500 text-sm">Всего: {actionsTotal}</p>
              <button onClick={() => loadActions(0)} className="bg-[#252836] text-slate-300 px-3 py-1.5 rounded-full text-xs">↻</button>
            </div>

            {loading && <Skeleton rows={4} h="h-16" />}

            {!loading && actions.length === 0 && (
              <div className="text-center py-12 text-slate-500">Журнал пуст</div>
            )}

            {!loading && actions.map(a => (
              <div key={a.id} className="bg-[#1a1d27] rounded-2xl px-4 py-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white text-sm font-semibold">{a.action}</span>
                  <span className="text-slate-500 text-xs">{fmt(a.created_at)}</span>
                </div>
                <div className="text-slate-500 text-xs">
                  Admin: {a.admin_telegram_id}
                  {a.target_type && <> · {a.target_type} #{a.target_id}</>}
                </div>
                {Object.keys(a.payload || {}).length > 0 && (
                  <p className="text-slate-600 text-xs font-mono truncate">{JSON.stringify(a.payload)}</p>
                )}
              </div>
            ))}

            <Pagination total={actionsTotal} offset={actionsOffset} limit={20} onPage={loadActions} />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-[#1a1d27] rounded-2xl p-4">
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      <p className={`${color} font-extrabold text-3xl`}>{value}</p>
    </div>
  );
}

function Pagination({ total, offset, limit, onPage }: { total: number; offset: number; limit: number; onPage: (o: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit);
  const pages = Math.ceil(total / limit);
  return (
    <div className="flex items-center justify-between pt-2">
      <button onClick={() => onPage(Math.max(0, offset - limit))} disabled={offset === 0}
        className="bg-[#252836] disabled:opacity-30 text-slate-300 px-4 py-2 rounded-xl text-sm">← Назад</button>
      <span className="text-slate-500 text-xs">{page + 1} / {pages}</span>
      <button onClick={() => onPage(offset + limit)} disabled={offset + limit >= total}
        className="bg-[#252836] disabled:opacity-30 text-slate-300 px-4 py-2 rounded-xl text-sm">Вперёд →</button>
    </div>
  );
}
