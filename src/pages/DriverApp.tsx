import { useState, useEffect, useRef } from 'react';
import MapPicker from '../components/MapPicker';
import type { Category, RideHistoryItem } from '../api';
import { registerDriver, setDriverStatus, getRideStatus, getDriverHistory } from '../api';
import { haptic } from '../telegram';

const API = import.meta.env.VITE_API_URL ?? 'https://api.lattaxi.lv';

interface Props { telegramId: number; userName: string }
type DriverStep = 'register' | 'dashboard' | 'offer' | 'active' | 'history';

interface OfferData {
  rideId: number; offerId: number;
  pickup: string; dropoff: string;
  price: string; distanceKm: string;
  pickupLat: number; pickupLng: number;
  dropoffLat: number; dropoffLng: number;
}

const CATS: { id: Category; icon: string; label: string }[] = [
  { id: 'economy', icon: '🚗', label: 'Economy' },
  { id: 'comfort', icon: '🚙', label: 'Comfort' },
  { id: 'xl',      icon: '🚐', label: 'XL'      },
];

async function updateDriverLocation(telegramId: number, lat: number, lng: number) {
  try {
    await fetch(`${API}/drivers/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, lat, lng }),
    });
  } catch { /* ignore */ }
}

async function updateRideStatus(rideId: number, status: string, telegramId: number) {
  await fetch(`${API}/rides/${rideId}/update-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, driver_telegram_id: telegramId }),
  });
}

async function respondToOffer(offerId: number, accept: boolean, telegramId: number) {
  await fetch(`${API}/driver-offers/${offerId}/${accept ? 'accept' : 'reject'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driver_telegram_id: telegramId }),
  });
}

export default function DriverApp({ telegramId, userName }: Props) {
  const [step, setStep]           = useState<DriverStep>('register');
  const [online, setOnline]       = useState(false);
  const [category, setCategory]   = useState<Category>('economy');
  const [car, setCar]             = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [offer, setOffer]         = useState<OfferData | null>(null);
  const [activeRideId, setActiveRideId] = useState<number | null>(null);
  const [rideStatus, setRideStatus]     = useState<string>('');
  const [activePickup, setActivePickup] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [activeDropoff, setActiveDropoff] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [driverPos, setDriverPos]       = useState<{ lat: number; lng: number } | null>(null);
  const geoWatchRef = useRef<number | null>(null);
  const [history, setHistory]           = useState<RideHistoryItem[]>([]);
  const [histLoading, setHistLoad]      = useState(false);

  useEffect(() => {
    if (online && navigator.geolocation) {
      geoWatchRef.current = navigator.geolocation.watchPosition(
        pos => {
          const { latitude: lat, longitude: lng } = pos.coords;
          setDriverPos({ lat, lng });
          updateDriverLocation(telegramId, lat, lng);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    } else {
      if (geoWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
        geoWatchRef.current = null;
      }
    }
    return () => { if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current); };
  }, [online, telegramId]);

  useEffect(() => {
    if (!online || step !== 'dashboard') return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`${API}/drivers/${telegramId}/offers/pending`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && data.offer) { setOffer(data.offer); setStep('offer'); haptic('heavy'); }
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(iv);
  }, [online, step, telegramId]);

  useEffect(() => {
    if (!activeRideId || step !== 'active') return;
    const iv = setInterval(async () => {
      const s = await getRideStatus(activeRideId);
      if (s.ok) setRideStatus(s.status);
      if (s.status === 'trip_completed' || s.status === 'cancelled') {
        setStep('dashboard'); setActiveRideId(null); setRideStatus('');
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [activeRideId, step]);

  async function handleRegister() {
    if (!car || !carNumber) return;
    haptic('medium');
    const res = await registerDriver({ telegram_id: telegramId, name: userName, car, car_number: carNumber, category }) as { ok: boolean };
    if (res.ok) setStep('dashboard');
  }

  async function toggleOnline() {
    haptic('medium');
    await setDriverStatus(telegramId, online ? 'offline' : 'online');
    setOnline(!online);
  }

  async function handleOfferResponse(accept: boolean) {
    if (!offer) return;
    haptic(accept ? 'medium' : 'light');
    await respondToOffer(offer.offerId, accept, telegramId);
    if (accept) {
      setActiveRideId(offer.rideId);
      setRideStatus('driver_assigned');
      setActivePickup({ lat: offer.pickupLat, lng: offer.pickupLng, address: offer.pickup });
      setActiveDropoff({ lat: offer.dropoffLat, lng: offer.dropoffLng, address: offer.dropoff });
      setStep('active');
    }
    else setStep('dashboard');
    setOffer(null);
  }

  async function openHistory() {
    setStep('history');
    setHistLoad(true);
    try {
      const r = await getDriverHistory(telegramId);
      if (r.ok) setHistory(r.rides);
    } finally { setHistLoad(false); }
  }

  async function handleStatusUpdate(newStatus: string) {
    if (!activeRideId) return;
    haptic('medium');
    await updateRideStatus(activeRideId, newStatus, telegramId);
    setRideStatus(newStatus);
  }

  return (
    <div className="flex flex-col h-full bg-[#0f1117]">

      {/* ════ REGISTER ════ */}
      {step === 'register' && (
        <div className="flex-1 flex flex-col justify-center px-5 pb-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 rounded-3xl bg-[#FFCC00]/10 flex items-center justify-center text-4xl mb-4">🚕</div>
            <h1 className="text-2xl font-bold text-white">LatTaxi Vadītājs</h1>
            <p className="text-slate-400 text-sm mt-1">Reģistrējies, lai sāktu braukt</p>
          </div>

          <div className="space-y-3">
            <div className="bg-[#1a1d27] rounded-2xl px-4 py-1">
              <input
                className="w-full bg-transparent text-white placeholder-slate-500 py-3.5 text-sm outline-none"
                placeholder="Auto marka un modelis (Toyota Camry)"
                value={car}
                onChange={e => setCar(e.target.value)}
              />
            </div>
            <div className="bg-[#1a1d27] rounded-2xl px-4 py-1">
              <input
                className="w-full bg-transparent text-white placeholder-slate-500 py-3.5 text-sm outline-none uppercase tracking-widest"
                placeholder="Reģistrācijas numurs  AA·1234"
                value={carNumber}
                onChange={e => setCarNumber(e.target.value.toUpperCase())}
              />
            </div>

            <div>
              <p className="text-slate-500 text-xs mb-2 px-1">Kategorija</p>
              <div className="flex gap-2">
                {CATS.map(c => (
                  <button key={c.id} type="button" onClick={() => setCategory(c.id)}
                    className={`flex-1 py-3 rounded-2xl text-sm font-bold border-2 transition-all ${
                      category === c.id
                        ? 'bg-[#FFCC00] border-[#FFCC00] text-[#0f1117]'
                        : 'bg-[#1a1d27] border-transparent text-slate-400 active:bg-[#252836]'
                    }`}>
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleRegister} disabled={!car || !carNumber}
              className="w-full bg-[#FFCC00] disabled:opacity-40 text-[#0f1117] font-bold py-4 rounded-2xl text-base mt-2 shadow-lg shadow-yellow-500/20">
              Reģistrēties →
            </button>
          </div>
        </div>
      )}

      {/* ═���══ DASHBOARD ════ */}
      {step === 'dashboard' && (
        <div className="flex-1 flex flex-col">
          <div className="relative">
            <MapPicker height="48vh" interactive={false} center={driverPos ?? undefined} pickupMarker={driverPos} />
            {/* GPS badge */}
            {driverPos && online && (
              <div className="absolute top-3 right-3 bg-[#0f1117]/80 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-white text-xs font-medium">GPS</span>
              </div>
            )}
          </div>

          <div className="flex-1 bg-[#1a1d27] rounded-t-3xl -mt-5 relative z-10 px-4 pt-2 pb-6">
            <div className="flex justify-center pt-3 pb-4">
              <div className="w-10 h-1 bg-[#ffffff20] rounded-full" />
            </div>

            {/* driver info row */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-white font-bold text-base">{userName}</p>
                <p className="text-slate-500 text-xs capitalize mt-0.5">
                  {CATS.find(c => c.id === category)?.icon} {category} · {car || '—'}
                </p>
              </div>
              <button onClick={toggleOnline}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-sm transition-all ${
                  online
                    ? 'bg-green-500 text-white shadow-lg shadow-green-500/30'
                    : 'bg-[#252836] text-slate-300'
                }`}>
                <div className={`w-2 h-2 rounded-full ${online ? 'bg-white animate-pulse' : 'bg-slate-500'}`} />
                {online ? 'Online' : 'Offline'}
              </button>
            </div>

            {online ? (
              <div className="bg-[#252836] rounded-2xl p-5 flex flex-col items-center gap-3">
                <div className="relative w-12 h-12 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-[#FFCC00]/20 animate-ping" />
                  <div className="absolute inset-0 rounded-full border-4 border-[#FFCC00]/40 animate-pulse" />
                  <span className="text-2xl relative z-10">📡</span>
                </div>
                <p className="text-white font-semibold">Gaida pasūtījumus...</p>
                <p className="text-slate-500 text-xs">Pasūtījums tiks paziņots automātiski</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-[#252836] rounded-2xl p-5 flex flex-col items-center gap-2">
                  <span className="text-3xl">💤</span>
                  <p className="text-slate-400 text-sm text-center">Nospied <span className="text-white font-semibold">Online</span>, lai saņemtu pasūtījumus</p>
                </div>
                <button onClick={openHistory}
                  className="w-full bg-[#252836] active:bg-[#2f3347] text-slate-300 font-medium py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2">
                  🕐 Braucienu vēsture
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═���══ OFFER ════ */}
      {step === 'offer' && offer && (
        <div className="flex-1 flex flex-col">
          <MapPicker height="42vh" pickupMarker={{ lat: offer.pickupLat, lng: offer.pickupLng }} interactive={false} />

          <div className="flex-1 bg-[#1a1d27] rounded-t-3xl -mt-5 relative z-10 px-4 pt-2 pb-8">
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-[#ffffff20] rounded-full" />
            </div>

            {/* header */}
            <div className="flex flex-col items-center py-3 gap-1">
              <div className="relative w-14 h-14 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-[#FFCC00]/20 animate-ping" />
                <span className="text-3xl relative z-10">📨</span>
              </div>
              <p className="text-white font-bold text-xl mt-1">Jauns pasūtījums!</p>
            </div>

            {/* route card */}
            <div className="bg-[#252836] rounded-2xl p-4 space-y-3 mb-4">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 pt-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#4ade80]" />
                  <div className="w-0.5 h-5 bg-[#ffffff20]" />
                  <div className="w-2.5 h-2.5 rounded-sm bg-[#f87171]" />
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-slate-500 text-xs mb-0.5">Pacelšana</p>
                    <p className="text-white text-sm font-medium truncate">{offer.pickup}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs mb-0.5">Galamērķis</p>
                    <p className="text-white text-sm font-medium truncate">{offer.dropoff}</p>
                  </div>
                </div>
              </div>

              <div className="h-px bg-[#ffffff08]" />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-sm">📏</span>
                  <span className="text-slate-300 text-sm">{offer.distanceKm} km</span>
                </div>
                <div className="bg-[#FFCC00]/10 px-4 py-1.5 rounded-xl">
                  <span className="text-[#FFCC00] font-extrabold text-xl">€{offer.price}</span>
                </div>
              </div>
            </div>

            {/* nav button */}
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${offer.pickupLat},${offer.pickupLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-blue-500/15 border border-blue-500/30 text-blue-300 font-semibold py-3 rounded-2xl text-sm mb-3"
            >
              🗺 Navigēt uz pasažieri
            </a>

            {/* action buttons */}
            <div className="flex gap-3">
              <button onClick={() => handleOfferResponse(false)}
                className="flex-1 bg-[#252836] active:bg-[#2f3347] border border-red-500/30 text-red-400 font-bold py-4 rounded-2xl text-sm">
                ✕ Noraidīt
              </button>
              <button onClick={() => handleOfferResponse(true)}
                className="flex-[2] bg-[#FFCC00] active:brightness-90 text-[#0f1117] font-bold py-4 rounded-2xl text-base shadow-lg shadow-yellow-500/20">
                ✓ Pieņemt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ��═══ ACTIVE RIDE ════ */}
      {step === 'active' && (
        <div className="flex-1 flex flex-col">
          <MapPicker height="42vh" interactive={false} center={driverPos ?? undefined} pickupMarker={driverPos} />

          <div className="flex-1 bg-[#1a1d27] rounded-t-3xl -mt-5 relative z-10 px-4 pt-2 pb-8 overflow-y-auto">
            <div className="flex justify-center pt-3 pb-3">
              <div className="w-10 h-1 bg-[#ffffff20] rounded-full" />
            </div>

            {/* ride header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-slate-500 text-xs">Brauciens</p>
                <p className="text-white font-bold text-lg">#{activeRideId}</p>
              </div>
              <ActiveStatusChip status={rideStatus} />
            </div>

            {/* status steps */}
            <div className="bg-[#252836] rounded-2xl p-4 mb-4">
              <div className="flex items-center gap-3">
                {[
                  { key: 'driver_assigned', label: 'Dodas', icon: '🚗' },
                  { key: 'driver_arrived',  label: 'Ieradies', icon: '📍' },
                  { key: 'trip_started',    label: 'Brauciens', icon: '▶️' },
                ].map((s, i, arr) => {
                  const statuses = ['driver_assigned','driver_arrived','trip_started','trip_completed'];
                  const currentIdx = statuses.indexOf(rideStatus);
                  const stepIdx = statuses.indexOf(s.key);
                  const done    = currentIdx > stepIdx;
                  const active  = currentIdx === stepIdx;
                  return (
                    <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xl transition-all ${
                        active ? 'bg-[#FFCC00] scale-110' : done ? 'bg-green-500/20' : 'bg-[#1a1d27]'
                      }`}>
                        {done ? '✓' : s.icon}
                      </div>
                      <span className={`text-xs ${active ? 'text-[#FFCC00] font-bold' : done ? 'text-green-400' : 'text-slate-600'}`}>
                        {s.label}
                      </span>
                      {i < arr.length - 1 && (
                        <div className={`hidden`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* navigation */}
            {activePickup && rideStatus === 'driver_assigned' && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${activePickup.lat},${activePickup.lng}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-blue-500/15 border border-blue-500/30 text-blue-300 font-semibold py-3 rounded-2xl text-sm mb-2">
                🗺 Navigēt uz pasažieri
              </a>
            )}
            {activeDropoff && rideStatus === 'trip_started' && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${activeDropoff.lat},${activeDropoff.lng}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-blue-500/15 border border-blue-500/30 text-blue-300 font-semibold py-3 rounded-2xl text-sm mb-2">
                🗺 Navigēt uz galamērķi
              </a>
            )}

            {/* action buttons */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleStatusUpdate('driver_arrived')}
                  disabled={rideStatus === 'driver_arrived' || rideStatus === 'trip_started'}
                  className="bg-blue-500/15 active:bg-blue-500/25 border border-blue-500/30 disabled:opacity-30 text-blue-300 font-bold py-4 rounded-2xl text-sm"
                >
                  ��� Ieradies
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusUpdate('trip_started')}
                  disabled={rideStatus !== 'driver_arrived'}
                  className="bg-green-500/15 active:bg-green-500/25 border border-green-500/30 disabled:opacity-30 text-green-300 font-bold py-4 rounded-2xl text-sm"
                >
                  ▶�� Sākt
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleStatusUpdate('trip_completed')}
                disabled={rideStatus !== 'trip_started'}
                className="w-full bg-[#FFCC00] active:brightness-90 disabled:opacity-30 text-[#0f1117] font-bold py-4 rounded-2xl text-base shadow-lg shadow-yellow-500/20"
              >
                🏁 Pabeigt braucienu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ HISTORY ════ */}
      {step === 'history' && (
        <div className="flex-1 flex flex-col bg-[#1a1d27]">
          <div className="px-4 pt-6 pb-4 flex items-center justify-between">
            <p className="text-white font-bold text-lg">Vēsture</p>
            <button onClick={() => setStep('dashboard')}
              className="bg-[#252836] px-3 py-1.5 rounded-full text-slate-400 text-xs">
              ✕ Aizvērt
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">
            {histLoading && (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-28 bg-[#252836] rounded-2xl animate-pulse" />)}
              </div>
            )}
            {!histLoading && history.length === 0 && (
              <div className="flex flex-col items-center py-16 gap-3 text-slate-500">
                <span className="text-4xl">🗂</span>
                <span className="text-sm">Nav braucienu vēstures</span>
              </div>
            )}
            {history.map(r => {
              const price = Number(r.final_price ?? r.estimated_price ?? 0);
              const tip   = Number(r.tip_amount ?? 0);
              return (
                <div key={r.id} className="bg-[#252836] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 text-xs">
                      {new Date(r.created_at).toLocaleDateString('lv-LV', { day:'numeric', month:'short' })}
                    </span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      r.status === 'trip_completed'
                        ? 'text-green-400 bg-green-500/10'
                        : 'text-red-400 bg-red-500/10'
                    }`}>
                      {r.status === 'trip_completed' ? '✓ Pabeigts' : '✕ Atcelts'}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-[#4ade80] mt-1.5 flex-shrink-0" />
                      <span className="text-slate-300 text-sm truncate">{r.pickup_address || '—'}</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <div className="w-2 h-2 rounded-sm bg-[#f87171] mt-1.5 flex-shrink-0" />
                      <span className="text-slate-300 text-sm truncate">{r.dropoff_address || '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-[#ffffff08]">
                    <div>
                      {r.passenger_rating != null && (
                        <span className="text-xs text-slate-500">
                          {'★'.repeat(r.passenger_rating)} pasažieris
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[#FFCC00] font-bold text-base">€{price.toFixed(2)}</p>
                      {tip > 0 && <p className="text-green-400 text-xs">+€{tip.toFixed(2)} dzer.</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}

function ActiveStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    driver_assigned: { label: 'Dodas',    cls: 'bg-blue-500/15 text-blue-300',  dot: 'bg-blue-400' },
    driver_arrived:  { label: 'Ieradies', cls: 'bg-green-500/15 text-green-300', dot: 'bg-green-400' },
    trip_started:    { label: 'Brauciens', cls: 'bg-[#FFCC00]/15 text-[#FFCC00]', dot: 'bg-[#FFCC00]' },
    trip_completed:  { label: 'Pabeigts', cls: 'bg-slate-500/15 text-slate-300',  dot: 'bg-slate-400' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-[#252836] text-slate-300', dot: 'bg-slate-500' };
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${s.cls}`}>
      <div className={`w-2 h-2 rounded-full animate-pulse ${s.dot}`} />
      <span className="text-sm font-semibold">{s.label}</span>
    </div>
  );
}
