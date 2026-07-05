import { useState, useEffect } from 'react';
import MapPicker from '../components/MapPicker';
import AddressSearch from '../components/AddressSearch';
import type { Category, QuoteResult, Ride, RideStatus, RideHistoryItem } from '../api';
import { getQuote, requestRide, getRideStatus, cancelRide, getCancelPolicy, rateRide, getPassengerHistory } from '../api';
import { haptic } from '../telegram';

interface LatLng { lat: number; lng: number }
type Step = 'home' | 'confirm' | 'searching' | 'active' | 'rating' | 'history';
interface Props { userId: number }

const CATS: { id: Category; label: string; desc: string; icon: string }[] = [
  { id: 'economy', label: 'Economy',  desc: 'Standarta',    icon: '🚗' },
  { id: 'comfort', label: 'Comfort',  desc: 'Lielāka klase', icon: '🚙' },
  { id: 'xl',      label: 'XL',       desc: 'Līdz 6 viet.',  icon: '🚐' },
];

export default function PassengerApp({ userId }: Props) {
  const [step, setStep]           = useState<Step>('home');
  const [pickup,  setPickup]      = useState<(LatLng & { address: string }) | null>(null);
  const [dropoff, setDropoff]     = useState<(LatLng & { address: string }) | null>(null);
  const [quote,   setQuote]       = useState<QuoteResult | null>(null);
  const [loadingQuote, setLoadingQ] = useState(false);
  const [category, setCategory]   = useState<Category>('economy');
  const [ride,    setRide]        = useState<Ride | null>(null);
  const [rideStatus, setRS]       = useState<RideStatus | null>(null);
  const [booking, setBooking]     = useState(false);
  const [rating,  setRating]      = useState(5);
  const [tip,     setTip]         = useState(0);
  const [rated,   setRated]       = useState(false);
  const [history, setHistory]     = useState<RideHistoryItem[]>([]);
  const [histLoading, setHistLoad] = useState(false);
  const [cancelModal, setCancelModal] = useState<{ fee: number; reason: string } | null>(null);
  const [cancelling, setCancelling]   = useState(false);
  const [comment, setComment]         = useState('');

  useEffect(() => {
    if (!pickup || !dropoff) return;
    setLoadingQ(true);
    setQuote(null);
    getQuote(pickup, dropoff)
      .then(r => { if (r.ok) setQuote(r.quote); })
      .finally(() => setLoadingQ(false));
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  useEffect(() => {
    if (!ride || !['searching', 'active'].includes(step)) return;
    const iv = setInterval(async () => {
      const s = await getRideStatus(ride.id);
      if (!s.ok) return;
      setRS(s);
      if (['driver_assigned', 'driver_arrived', 'trip_started'].includes(s.status)) setStep('active');
      if (s.status === 'trip_completed') setStep('rating');
      if (s.status === 'cancelled') { setStep('home'); setRide(null); }
    }, 5000);
    return () => clearInterval(iv);
  }, [ride?.id, step]);

  async function handleBook() {
    if (!pickup || !dropoff) return;
    setBooking(true);
    haptic('medium');
    const res = await requestRide({
      passenger_user_id: userId,
      pickup_address:  pickup.address,
      dropoff_address: dropoff.address,
      pickup_lat:  pickup.lat,  pickup_lng:  pickup.lng,
      dropoff_lat: dropoff.lat, dropoff_lng: dropoff.lng,
      category,
      estimated_price:        quote?.prices[category],
      route_distance_meters:  quote?.distanceMeters,
      route_duration_seconds: quote?.durationSeconds,
      route_polyline:         quote?.encodedPolyline,
      passenger_comment:      comment || undefined,
    });
    setBooking(false);
    if (res.ok) { setRide(res.ride); setStep('searching'); }
  }

  async function handleCancel() {
    if (!ride) return;
    haptic('medium');
    setCancelling(true);
    try {
      const policy = await getCancelPolicy(ride.id);
      if (!policy.can_cancel) return;
      if (policy.fee > 0) { setCancelModal({ fee: policy.fee, reason: policy.reason }); return; }
      await cancelRide(ride.id, userId, false);
      setRide(null); setStep('home');
    } finally { setCancelling(false); }
  }

  async function confirmCancelWithFee() {
    if (!ride || !cancelModal) return;
    haptic('heavy');
    setCancelling(true);
    try {
      await cancelRide(ride.id, userId, true);
      setCancelModal(null); setRide(null); setStep('home');
    } finally { setCancelling(false); }
  }

  async function handleRate() {
    if (!ride) return;
    haptic('medium');
    await rateRide({ ride_id: ride.id, passenger_user_id: userId, rating, tip_amount: tip });
    setRated(true);
  }

  async function openHistory() {
    setStep('history');
    setHistLoad(true);
    try {
      const r = await getPassengerHistory(userId);
      if (r.ok) setHistory(r.rides);
    } finally { setHistLoad(false); }
  }

  const durMin  = quote ? Math.round(quote.durationSeconds / 60) : 0;
  const distKm  = quote ? (quote.distanceMeters / 1000).toFixed(1) : '—';
  const mapH    = ['confirm', 'searching', 'active'].includes(step) ? '42vh' : '50vh';
  const showMap = step !== 'history';

  return (
    <div className="flex flex-col h-full bg-[#0f1117] relative">

      {/* ─── MAP ─── */}
      {showMap && (
        <div className="relative flex-shrink-0">
          <MapPicker
            height={mapH}
            pickupMarker={pickup}
            dropoffMarker={dropoff}
            driverMarker={rideStatus?.driver_location ?? null}
            routePolyline={step === 'confirm' ? quote?.encodedPolyline ?? null : null}
            onMapClick={(pos) => {
              if (step !== 'home') return;
              haptic('light');
              if (!pickup) setPickup({ ...pos, address: `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` });
              else setDropoff({ ...pos, address: `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` });
            }}
            interactive={step === 'home'}
          />
        </div>
      )}

      {/* ─── BOTTOM SHEET ─── */}
      <div className="flex-1 overflow-y-auto bg-[#1a1d27] rounded-t-3xl -mt-5 relative z-10">

        {/* drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-[#ffffff20] rounded-full" />
        </div>

        {/* ════ HOME ════ */}
        {step === 'home' && (
          <div className="px-4 pb-6 space-y-4">

            {/* header row */}
            <div className="flex items-center justify-between py-1">
              <span className="text-white font-bold text-lg">Kur braucam?</span>
              <button onClick={openHistory}
                className="flex items-center gap-1.5 bg-[#ffffff10] px-3 py-1.5 rounded-full text-xs text-slate-300">
                <span>🕐</span> Vēsture
              </button>
            </div>

            {/* address card */}
            <div className="bg-[#252836] rounded-2xl overflow-hidden">
              {/* pickup */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[#ffffff0f]">
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-3 h-3 rounded-full bg-[#4ade80] border-2 border-[#1a1d27]" />
                  <div className="w-0.5 h-4 bg-[#ffffff20]" />
                </div>
                <AddressSearch
                  placeholder="Izejas punkts"
                  value={pickup?.address ?? ''}
                  onChange={(address, lat, lng) => setPickup({ lat, lng, address })}
                />
              </div>
              {/* dropoff */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-3 h-3 rounded-sm bg-[#f87171] border-2 border-[#1a1d27]" />
                <AddressSearch
                  placeholder="Galamērķis"
                  value={dropoff?.address ?? ''}
                  onChange={(address, lat, lng) => setDropoff({ lat, lng, address })}
                />
              </div>
            </div>

            {/* CTA */}
            {pickup && dropoff ? (
              <button
                onClick={() => setStep('confirm')}
                disabled={loadingQuote}
                className="w-full bg-[#FFCC00] active:brightness-90 disabled:opacity-60 text-[#0f1117] font-bold py-4 rounded-2xl text-base shadow-lg shadow-yellow-500/20"
              >
                {loadingQuote ? 'Aprēķina cenu...' : 'Atrast braucēju →'}
              </button>
            ) : (
              <div className="bg-[#252836] rounded-2xl px-4 py-3 text-center text-slate-400 text-sm">
                Ievadi izejas punktu un galamērķi
              </div>
            )}
          </div>
        )}

        {/* ════ CONFIRM / CATEGORY ════ */}
        {step === 'confirm' && (
          <div className="px-4 pb-6 space-y-4">

            {/* route summary */}
            <div className="flex items-center justify-between py-1">
              <button onClick={() => setStep('home')}
                className="flex items-center gap-1 text-slate-400 text-sm">
                ← Atpakaļ
              </button>
              <span className="text-slate-400 text-sm">{distKm} km · {durMin} min</span>
            </div>

            <p className="text-white font-bold text-lg">Izvēlies braucienu</p>

            {/* categories */}
            {loadingQuote && (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-20 bg-[#252836] rounded-2xl animate-pulse" />)}
              </div>
            )}

            {quote && (
              <div className="space-y-2">
                {CATS.map(cat => {
                  const sel = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => { setCategory(cat.id); haptic('light'); }}
                      className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 transition-all ${
                        sel
                          ? 'bg-[#FFCC00] border-[#FFCC00] text-[#0f1117]'
                          : 'bg-[#252836] border-transparent text-white active:bg-[#2f3347]'
                      }`}
                    >
                      <span className="text-3xl">{cat.icon}</span>
                      <div className="flex-1 text-left">
                        <div className={`font-bold text-base ${sel ? 'text-[#0f1117]' : 'text-white'}`}>{cat.label}</div>
                        <div className={`text-xs mt-0.5 ${sel ? 'text-[#0f1117]/70' : 'text-slate-400'}`}>{cat.desc}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-extrabold text-xl ${sel ? 'text-[#0f1117]' : 'text-[#FFCC00]'}`}>
                          €{quote.prices[cat.id].toFixed(2)}
                        </div>
                        <div className={`text-xs ${sel ? 'text-[#0f1117]/60' : 'text-slate-500'}`}>{durMin} min</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* comment */}
            <div className="bg-[#252836] rounded-2xl px-4 py-1 flex items-center gap-2">
              <span className="text-slate-500 text-base">💬</span>
              <input
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none py-3.5"
                placeholder="Komentārs braucējam (neobligāti)"
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={120}
              />
            </div>

            <button
              onClick={handleBook}
              disabled={booking || !quote}
              className="w-full bg-[#FFCC00] active:brightness-90 disabled:opacity-50 text-[#0f1117] font-bold py-4 rounded-2xl text-base shadow-lg shadow-yellow-500/20"
            >
              {booking ? 'Rezervē...' : `Pasūtīt ${CATS.find(c => c.id === category)?.label}`}
            </button>
          </div>
        )}

        {/* ════ SEARCHING ════ */}
        {step === 'searching' && (
          <div className="px-4 pb-8 space-y-5">
            <div className="flex flex-col items-center py-4 gap-2">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-[#FFCC00]/30 animate-ping" />
                <div className="absolute inset-0 rounded-full border-4 border-[#FFCC00]/60 animate-pulse" />
                <span className="text-3xl relative z-10">🚕</span>
              </div>
              <p className="text-white font-bold text-lg mt-2">Meklē braucēju...</p>
              <p className="text-slate-400 text-sm">Parasti līdz 2 minūtēm</p>
            </div>

            <div className="bg-[#252836] rounded-2xl p-4 space-y-3">
              <RouteRow label="No" value={pickup?.address} />
              <div className="h-px bg-[#ffffff0a]" />
              <RouteRow label="Uz" value={dropoff?.address} />
              <div className="h-px bg-[#ffffff0a]" />
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Cena</span>
                <span className="text-[#FFCC00] font-bold text-base">€{ride?.estimated_price}</span>
              </div>
            </div>

            <button onClick={handleCancel} disabled={cancelling}
              className="w-full bg-[#252836] active:bg-[#2f3347] disabled:opacity-50 text-red-400 font-semibold py-3.5 rounded-2xl text-sm border border-red-500/20">
              {cancelling ? '...' : 'Atcelt pasūtījumu'}
            </button>
          </div>
        )}

        {/* ════ ACTIVE ════ */}
        {step === 'active' && rideStatus && (
          <div className="px-4 pb-8 space-y-4">

            {/* status + ETA */}
            <div className="flex items-center justify-between py-2">
              <ActiveStatusBadge status={rideStatus.status} />
              {rideStatus.driver_eta_minutes != null && (
                <div className="flex items-center gap-1.5 bg-[#FFCC00]/10 px-3 py-1.5 rounded-full">
                  <span className="text-[#FFCC00] font-bold text-sm">{rideStatus.driver_eta_minutes} min</span>
                </div>
              )}
            </div>

            {/* driver card */}
            {rideStatus.driver && (
              <div className="bg-[#252836] rounded-2xl p-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-[#1a1d27] flex items-center justify-center text-3xl flex-shrink-0">
                  🧑‍✈️
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-base truncate">{rideStatus.driver.name}</p>
                  <p className="text-slate-400 text-sm truncate">{rideStatus.driver.car} · {rideStatus.driver.car_number}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <div className="flex items-center gap-1 bg-[#FFCC00]/10 px-2 py-1 rounded-lg">
                    <span className="text-yellow-400 text-xs">★</span>
                    <span className="text-white font-bold text-sm">{rideStatus.driver.rating?.toFixed(1)}</span>
                  </div>
                  <span className="text-xs text-slate-500 capitalize">{rideStatus.driver.category}</span>
                </div>
              </div>
            )}

            {/* destination */}
            <div className="bg-[#252836] rounded-2xl p-4 space-y-3">
              <RouteRow label="Uz" value={dropoff?.address} />
              <div className="h-px bg-[#ffffff0a]" />
              <div className="flex justify-between">
                <span className="text-slate-400 text-sm">Cena</span>
                <span className="text-[#FFCC00] font-bold">€{ride?.estimated_price}</span>
              </div>
            </div>

            {rideStatus.status !== 'trip_started' && (
              <button onClick={handleCancel} disabled={cancelling}
                className="w-full bg-[#252836] text-red-400 border border-red-500/20 disabled:opacity-50 py-3.5 rounded-2xl text-sm font-semibold">
                {cancelling ? '...' : 'Atcelt braucienu'}
              </button>
            )}
          </div>
        )}

        {/* ════ RATING ════ */}
        {step === 'rating' && (
          <div className="px-4 pb-8">
            {!rated ? (
              <div className="space-y-5">
                <div className="flex flex-col items-center py-4 gap-1">
                  <div className="text-5xl mb-2">🏁</div>
                  <p className="text-white font-bold text-xl">Brauciens pabeigts!</p>
                  <p className="text-slate-400 text-sm">Novērtē savu braucēju</p>
                </div>

                {/* stars */}
                <div className="flex justify-center gap-3">
                  {[1,2,3,4,5].map(s => (
                    <button key={s} type="button"
                      onClick={() => { setRating(s); haptic('light'); }}
                      className={`text-4xl transition-all ${s <= rating ? 'scale-110' : 'opacity-25 scale-90'}`}>
                      ⭐
                    </button>
                  ))}
                </div>

                {/* tip */}
                <div>
                  <p className="text-slate-400 text-sm mb-3 text-center">Dzeramnauда (neobligāti)</p>
                  <div className="flex gap-2">
                    {[0, 1, 2, 5].map(t => (
                      <button key={t} type="button"
                        onClick={() => { setTip(t); haptic('light'); }}
                        className={`flex-1 py-3 rounded-2xl text-sm font-bold border-2 transition-all ${
                          tip === t
                            ? 'bg-[#FFCC00] border-[#FFCC00] text-[#0f1117]'
                            : 'bg-[#252836] border-transparent text-slate-300 active:bg-[#2f3347]'
                        }`}>
                        {t === 0 ? 'Nav' : `+€${t}`}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={handleRate}
                  className="w-full bg-[#FFCC00] text-[#0f1117] font-bold py-4 rounded-2xl text-base shadow-lg shadow-yellow-500/20">
                  Nosūtīt novērtējumu
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center py-10 gap-4">
                <div className="text-6xl">🙏</div>
                <p className="text-white font-bold text-xl">Paldies!</p>
                <p className="text-slate-400 text-sm">Tiekamies nākamreiz</p>
                <button
                  onClick={() => { setStep('home'); setRide(null); setQuote(null); setPickup(null); setDropoff(null); setRated(false); }}
                  className="w-full bg-[#FFCC00] text-[#0f1117] font-bold py-4 rounded-2xl text-base mt-4 shadow-lg shadow-yellow-500/20">
                  Jauns brauciens
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════ HISTORY ════ */}
        {step === 'history' && (
          <div className="px-4 pb-8 space-y-4">
            <div className="flex items-center justify-between py-1">
              <p className="text-white font-bold text-lg">Vēsture</p>
              <button onClick={() => setStep('home')}
                className="bg-[#252836] px-3 py-1.5 rounded-full text-slate-400 text-xs">
                ✕ Aizvērt
              </button>
            </div>

            {histLoading && (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-24 bg-[#252836] rounded-2xl animate-pulse" />)}
              </div>
            )}

            {!histLoading && history.length === 0 && (
              <div className="flex flex-col items-center py-16 gap-3 text-slate-500">
                <span className="text-4xl">🗂</span>
                <span className="text-sm">Nav braucienu vēstures</span>
              </div>
            )}

            {history.map(r => (
              <div key={r.id} className="bg-[#252836] rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-xs">
                    {new Date(r.created_at).toLocaleDateString('lv-LV', { day:'numeric', month:'short', year:'numeric' })}
                  </span>
                  <HistBadge status={r.status} />
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
                  <span className="text-slate-500 text-xs">
                    {r.driver_name ? `🚗 ${r.driver_name}` : ''}
                    {r.passenger_rating != null ? ` · ${'★'.repeat(r.passenger_rating)}` : ''}
                  </span>
                  <span className="text-[#FFCC00] font-bold text-base">
                    €{Number(r.final_price ?? r.estimated_price ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* ─── CANCEL FEE MODAL ─── */}
      {cancelModal && (
        <div className="absolute inset-0 z-50 flex items-end bg-black/70">
          <div className="w-full bg-[#1a1d27] rounded-t-3xl px-5 pt-6 pb-10 space-y-5">
            <div className="flex justify-center">
              <div className="w-10 h-1 bg-[#ffffff20] rounded-full" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-4xl">⚠️</span>
              <p className="text-white font-bold text-lg">Atcelšanas maksa</p>
              <p className="text-slate-400 text-sm text-center">{cancelModal.reason}</p>
            </div>
            <div className="bg-[#252836] rounded-2xl p-5 text-center">
              <p className="text-4xl font-extrabold text-red-400">€{cancelModal.fee.toFixed(2)}</p>
              <p className="text-slate-500 text-xs mt-1">tiks iekļauts nākamajā rēķinā</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCancelModal(null)}
                className="flex-1 bg-[#252836] text-slate-300 font-semibold py-4 rounded-2xl text-sm">
                Atpakaļ
              </button>
              <button onClick={confirmCancelWithFee} disabled={cancelling}
                className="flex-1 bg-red-500 active:bg-red-600 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-sm">
                {cancelling ? '...' : 'Atcelt braucienu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RouteRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-slate-400 text-sm flex-shrink-0">{label}</span>
      <span className="text-white text-sm text-right truncate">{value || '—'}</span>
    </div>
  );
}

function ActiveStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; dot: string }> = {
    driver_assigned: { label: 'Braucējs dodas',    bg: 'bg-blue-500/15',  dot: 'bg-blue-400' },
    driver_arrived:  { label: 'Braucējs ieradies', bg: 'bg-green-500/15', dot: 'bg-green-400' },
    trip_started:    { label: 'Brauciens notiek',  bg: 'bg-[#FFCC00]/15', dot: 'bg-[#FFCC00]' },
  };
  const s = map[status] ?? { label: status, bg: 'bg-[#252836]', dot: 'bg-slate-400' };
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${s.bg}`}>
      <div className={`w-2 h-2 rounded-full animate-pulse ${s.dot}`} />
      <span className="text-white text-sm font-semibold">{s.label}</span>
    </div>
  );
}

function HistBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    trip_completed: { label: '✓ Pabeigts', cls: 'text-green-400 bg-green-500/10' },
    cancelled:      { label: '✕ Atcelts',  cls: 'text-red-400 bg-red-500/10' },
    expired:        { label: '⏱ Beidzies', cls: 'text-slate-500 bg-slate-500/10' },
  };
  const s = map[status] ?? { label: status, cls: 'text-slate-400 bg-slate-700/30' };
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.cls}`}>{s.label}</span>;
}
