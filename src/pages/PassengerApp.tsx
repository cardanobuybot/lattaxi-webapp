import { useState, useEffect, useRef } from 'react';
import MapPicker from '../components/MapPicker';
import AddressSearch from '../components/AddressSearch';
import type { Category, QuoteResult, Ride, RideStatus, RideHistoryItem } from '../api';
import { getQuote, requestRide, getRideStatus, cancelRide, getCancelPolicy, rateRide, getPassengerHistory, getNearestDriverEta, fetchDriverPhoto } from '../api';
import { haptic } from '../telegram';

interface LatLng { lat: number; lng: number }

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`,
      { headers: { 'Accept-Language': 'lv' } }
    );
    const data = await res.json();
    const p = data.features?.[0]?.properties;
    if (!p) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const parts: string[] = [];
    if (p.street && p.housenumber) parts.push(`${p.street} ${p.housenumber}`);
    else if (p.street) parts.push(p.street);
    else if (p.name) parts.push(p.name);
    if (p.city) parts.push(p.city);
    return parts.join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}
function loadFav(kind: 'home' | 'work'): (LatLng & { address: string }) | null {
  try {
    const raw = localStorage.getItem(`lattaxi_fav_${kind}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

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
  const [freeSecsLeft, setFreeSecsLeft] = useState<number | null>(null);
  const [notice, setNotice]           = useState<string | null>(null);
  const [quoteError, setQuoteError]   = useState(false);
  const [quoteRetry, setQuoteRetry]   = useState(0);
  const [bookError, setBookError]     = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const rideStatusRef = useRef<RideStatus | null>(null);
  const [picking, setPicking]         = useState<'pickup' | 'dropoff' | null>('pickup');
  const [pinPos, setPinPos]           = useState<LatLng | null>(null);
  const [pinAddress, setPinAddress]   = useState<string | null>(null);
  const [pinMoving, setPinMoving]     = useState(false);
  const [mapFly, setMapFly]           = useState<LatLng | null>(null);
  const geoSeqRef = useRef(0);
  const [favHome, setFavHome] = useState<(LatLng & { address: string }) | null>(() => loadFav('home'));
  const [favWork, setFavWork] = useState<(LatLng & { address: string }) | null>(() => loadFav('work'));
  const [favAssign, setFavAssign] = useState<'home' | 'work' | null>(null);
  const [searchEta, setSearchEta] = useState<number | null>(null);
  const [driverPhoto, setDriverPhoto] = useState<string | null>(null);

  function saveFav(kind: 'home' | 'work', point: LatLng & { address: string }) {
    try { localStorage.setItem(`lattaxi_fav_${kind}`, JSON.stringify(point)); } catch { /* ignore */ }
    if (kind === 'home') setFavHome(point); else setFavWork(point);
  }

  function applyFav(fav: (LatLng & { address: string })) {
    haptic('light');
    setDropoff(fav);
    setMapFly({ lat: fav.lat, lng: fav.lng });
    setFavAssign(null);
    if (picking === 'dropoff') setPicking(null);
  }

  function startFavAssign(kind: 'home' | 'work') {
    haptic('light');
    setFavAssign(kind);
    setPicking('dropoff');
  }

  function applyDropoffPoint(point: LatLng & { address: string }) {
    setDropoff(point);
    if (favAssign) { saveFav(favAssign, point); setFavAssign(null); }
  }

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      p => setMapFly({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }, []);

  function handleCenterChange(pos: LatLng) {
    setPinMoving(false);
    setPinPos(pos);
    const seq = ++geoSeqRef.current;
    setPinAddress(null);
    reverseGeocode(pos.lat, pos.lng).then(addr => {
      if (geoSeqRef.current === seq) setPinAddress(addr);
    });
  }

  function confirmPin() {
    if (!pinPos || !pinAddress) return;
    haptic('medium');
    if (picking === 'pickup') {
      setPickup({ ...pinPos, address: pinAddress });
      setPicking(dropoff ? null : 'dropoff');
    } else if (picking === 'dropoff') {
      applyDropoffPoint({ ...pinPos, address: pinAddress });
      setPicking(null);
    }
  }

  useEffect(() => {
    if (!pickup || !dropoff) return;
    let stale = false;
    setLoadingQ(true);
    setQuote(null);
    setQuoteError(false);
    getQuote(pickup, dropoff)
      .then(r => {
        if (stale) return;
        if (r.ok) setQuote(r.quote);
        else setQuoteError(true);
      })
      .catch(() => { if (!stale) setQuoteError(true); })
      .finally(() => { if (!stale) setLoadingQ(false); });
    return () => { stale = true; };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, quoteRetry]);

  useEffect(() => {
    if (!ride || rideStatus?.status !== 'driver_assigned') { setFreeSecsLeft(null); return; }
    let stale = false;
    let iv: ReturnType<typeof setInterval> | undefined;
    getCancelPolicy(ride.id)
      .then(p => {
        if (stale) return;
        const initial = p.free_seconds_left ?? null;
        setFreeSecsLeft(initial);
        if (initial == null || initial <= 0) return;
        const deadline = Date.now() + initial * 1000;
        iv = setInterval(() => {
          const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
          setFreeSecsLeft(left);
          if (left <= 0 && iv) clearInterval(iv);
        }, 1000);
      })
      .catch(() => { if (!stale) setFreeSecsLeft(null); });
    return () => { stale = true; if (iv) clearInterval(iv); };
  }, [ride?.id, rideStatus?.status]);

  useEffect(() => {
    if (!ride || !['searching', 'active'].includes(step)) return;
    const iv = setInterval(async () => {
      try {
        const s = await getRideStatus(ride.id);
        if (!s.ok) return;
        setRS(s);
        rideStatusRef.current = s;
        if (['driver_assigned', 'driver_arrived', 'trip_started'].includes(s.status)) setStep('active');
        if (s.status === 'trip_completed') setStep('rating');
        if (s.status === 'cancelled') { setStep('home'); setRide(null); }
        if (s.status === 'expired') {
          setStep('home'); setRide(null);
          setNotice('Diemžēl neviens vadītājs nav pieejams. Mēģiniet vēlreiz.');
        }
      } catch { /* transient error — retry on next tick */ }
    }, 3000);
    return () => clearInterval(iv);
  }, [ride?.id, step]);

  // nearest available driver ETA while searching
  useEffect(() => {
    if (step !== 'searching' || !pickup) { setSearchEta(null); return; }
    let stale = false;
    const load = () => getNearestDriverEta(pickup.lat, pickup.lng)
      .then(r => { if (!stale && r.ok) setSearchEta(r.nearest_eta_minutes); })
      .catch(() => { /* ignore */ });
    load();
    const iv = setInterval(load, 10000);
    return () => { stale = true; clearInterval(iv); };
  }, [step, pickup]);

  // driver photo for the active ride card
  useEffect(() => {
    const driverId = rideStatus?.driver?.id;
    if (!driverId) { setDriverPhoto(null); return; }
    let stale = false;
    let url: string | null = null;
    fetchDriverPhoto(driverId).then(u => {
      if (stale) { if (u) URL.revokeObjectURL(u); return; }
      url = u;
      setDriverPhoto(u);
    });
    return () => { stale = true; if (url) URL.revokeObjectURL(url); setDriverPhoto(null); };
  }, [rideStatus?.driver?.id]);

  // give up on searching after 3 min if the ride is still unassigned
  useEffect(() => {
    if (!ride || step !== 'searching') return;
    const to = setTimeout(() => {
      const st = rideStatusRef.current?.status ?? 'requested';
      if (st !== 'requested') return;
      setStep('home'); setRide(null);
      setNotice('Diemžēl neviens vadītājs nav pieejams. Mēģiniet vēlreiz.');
    }, 3 * 60 * 1000);
    return () => clearTimeout(to);
  }, [ride?.id, step]);

  async function handleBook() {
    if (!pickup || !dropoff) return;
    setBooking(true);
    setBookError(null);
    haptic('medium');
    try {
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
      if (res.ok) {
        rideStatusRef.current = null;
        setCancelError(null);
        setRide(res.ride); setStep('searching');
      } else {
        setBookError(res.error || 'Neizdevās izveidot pasūtījumu. Mēģiniet vēlreiz.');
      }
    } catch (e) {
      setBookError(e instanceof Error ? e.message : 'Neizdevās izveidot pasūtījumu. Mēģiniet vēlreiz.');
    } finally { setBooking(false); }
  }

  async function handleCancel() {
    if (!ride) return;
    haptic('medium');
    setCancelling(true);
    setCancelError(null);
    try {
      const policy = await getCancelPolicy(ride.id);
      if (!policy.can_cancel) {
        setCancelError(policy.reason || 'Braucienu šobrīd nevar atcelt.');
        return;
      }
      if (policy.fee > 0) { setCancelModal({ fee: policy.fee, reason: policy.reason }); return; }
      const res = await cancelRide(ride.id, userId, false);
      if (res.ok) { setRide(null); setStep('home'); }
      else setCancelError(res.error || 'Neizdevās atcelt braucienu. Mēģiniet vēlreiz.');
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Neizdevās atcelt braucienu. Mēģiniet vēlreiz.');
    } finally { setCancelling(false); }
  }

  async function confirmCancelWithFee() {
    if (!ride || !cancelModal) return;
    haptic('heavy');
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await cancelRide(ride.id, userId, true);
      if (res.ok) { setCancelModal(null); setRide(null); setStep('home'); }
      else {
        setCancelModal(null);
        setCancelError(res.error || 'Neizdevās atcelt braucienu. Mēģiniet vēlreiz.');
      }
    } catch (e) {
      setCancelModal(null);
      setCancelError(e instanceof Error ? e.message : 'Neizdevās atcelt braucienu. Mēģiniet vēlreiz.');
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

  const durMin = quote ? Math.round(quote.durationSeconds / 60) : 0;
  const distKm = quote ? (quote.distanceMeters / 1000).toFixed(1) : '—';
  const showMap = step !== 'history';

  return (
    <div className="relative h-full bg-[#0f1117] overflow-hidden">

      {/* ─── MAP (full screen) ─── */}
      {showMap && (
        <div className="absolute inset-0">
          <MapPicker
            height="100%"
            center={mapFly ?? undefined}
            pickupMarker={picking === 'pickup' ? null : pickup}
            dropoffMarker={picking === 'dropoff' ? null : dropoff}
            driverMarker={rideStatus?.driver_location ?? null}
            routePolyline={step === 'confirm' ? quote?.encodedPolyline ?? null : null}
            panOnClick={step === 'home' && !!picking}
            onMoveStart={() => { if (step === 'home' && picking) setPinMoving(true); }}
            onCenterChange={(pos) => { if (step === 'home' && picking) handleCenterChange(pos); }}
            interactive={step === 'home'}
          />
        </div>
      )}

      {/* ─── CENTER PIN (Bolt-style point picking) ─── */}
      {showMap && step === 'home' && picking && (
        <div className="absolute left-1/2 top-1/2 z-[5] pointer-events-none" style={{ transform: 'translate(-50%, -100%)' }}>
          <div className={`flex flex-col items-center transition-transform duration-150 ${pinMoving ? '-translate-y-1.5' : ''}`}>
            <div className={`w-5 h-5 rounded-full border-[3px] border-white shadow-lg ${picking === 'pickup' ? 'bg-[#16a34a]' : 'bg-[#dc2626]'}`} />
            <div className="w-0.5 h-4 bg-[#0f1117]/80" />
          </div>
          <div className={`mx-auto mt-0.5 w-2 h-1 bg-black/30 rounded-full blur-[1px] transition-opacity ${pinMoving ? 'opacity-0' : 'opacity-100'}`} />
        </div>
      )}

      {/* ─── BOTTOM SHEET (overlays map) ─── */}
      <div className={`absolute bottom-0 left-0 right-0 z-10 bg-[#1a1d27] rounded-t-3xl overflow-y-auto ${step === 'history' ? 'top-0 rounded-t-none' : 'max-h-[72vh]'}`}>

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

            {/* notice (e.g. no driver found) */}
            {notice && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                <span className="text-yellow-400 text-sm">ℹ️</span>
                <p className="text-yellow-300 text-xs leading-relaxed flex-1">{notice}</p>
                <button onClick={() => setNotice(null)} className="text-slate-500 text-xs">✕</button>
              </div>
            )}

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
                  onChange={(address, lat, lng) => {
                    setPickup({ lat, lng, address });
                    setMapFly({ lat, lng });
                    if (picking === 'pickup') setPicking(dropoff ? null : 'dropoff');
                  }}
                />
                <button type="button"
                  onClick={() => { haptic('light'); setFavAssign(null); setPicking('pickup'); if (pickup) setMapFly({ lat: pickup.lat, lng: pickup.lng }); }}
                  className={`flex-shrink-0 text-sm px-2.5 py-1.5 rounded-lg ${picking === 'pickup' ? 'bg-[#FFCC00]/20' : 'bg-[#ffffff0a]'}`}>
                  🎯
                </button>
              </div>
              {/* dropoff */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-3 h-3 rounded-sm bg-[#f87171] border-2 border-[#1a1d27]" />
                <AddressSearch
                  placeholder="Galamērķis"
                  value={dropoff?.address ?? ''}
                  onChange={(address, lat, lng) => {
                    applyDropoffPoint({ lat, lng, address });
                    setMapFly({ lat, lng });
                    if (picking === 'dropoff') setPicking(null);
                  }}
                />
                <button type="button"
                  onClick={() => { haptic('light'); setFavAssign(null); setPicking('dropoff'); if (dropoff) setMapFly({ lat: dropoff.lat, lng: dropoff.lng }); }}
                  className={`flex-shrink-0 text-sm px-2.5 py-1.5 rounded-lg ${picking === 'dropoff' ? 'bg-[#FFCC00]/20' : 'bg-[#ffffff0a]'}`}>
                  🎯
                </button>
              </div>
            </div>

            {/* favorites: Home / Work */}
            <div className="flex gap-2">
              {([['home', '🏠', 'Mājas', favHome], ['work', '💼', 'Darbs', favWork]] as const).map(([kind, icon, label, fav]) => (
                <div key={kind}
                  className={`flex-1 flex items-center bg-[#252836] rounded-2xl overflow-hidden ${favAssign === kind ? 'ring-2 ring-[#FFCC00]/60' : ''}`}>
                  <button type="button"
                    onClick={() => fav ? applyFav(fav) : startFavAssign(kind)}
                    className="flex-1 flex items-center gap-2 px-3 py-2.5 min-w-0 active:bg-[#2f3347]">
                    <span className="text-base flex-shrink-0">{icon}</span>
                    <div className="text-left min-w-0">
                      <div className="text-white text-xs font-semibold">{fav ? label : `+ ${label}`}</div>
                      {fav && <div className="text-slate-500 text-[10px] truncate">{fav.address}</div>}
                    </div>
                  </button>
                  {fav && (
                    <button type="button"
                      onClick={() => startFavAssign(kind)}
                      className="flex-shrink-0 px-2.5 py-2.5 text-slate-500 text-xs active:bg-[#2f3347]">
                      ✎
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* CTA */}
            {picking ? (
              <div className="space-y-2">
                <div className="bg-[#252836] rounded-2xl px-4 py-3 flex items-center gap-3">
                  <div className={`w-3 h-3 flex-shrink-0 ${picking === 'pickup' ? 'rounded-full bg-[#4ade80]' : 'rounded-sm bg-[#f87171]'}`} />
                  <span className={`text-sm flex-1 truncate ${pinMoving || !pinAddress ? 'text-slate-500' : 'text-white'}`}>
                    {pinMoving || !pinAddress ? 'Meklē adresi...' : pinAddress}
                  </span>
                </div>
                <button
                  onClick={confirmPin}
                  disabled={pinMoving || !pinAddress}
                  className="w-full bg-[#FFCC00] active:brightness-90 disabled:opacity-50 text-[#0f1117] font-bold py-4 rounded-2xl text-base shadow-lg shadow-yellow-500/20"
                >
                  {picking === 'pickup'
                    ? 'Apstiprināt izejas punktu'
                    : favAssign
                      ? `Saglabāt kā ${favAssign === 'home' ? '🏠 Mājas' : '💼 Darbs'}`
                      : 'Apstiprināt galamērķi'}
                </button>
                <p className="text-center text-slate-500 text-xs">Pavelciet karti, lai precizētu punktu</p>
              </div>
            ) : pickup && dropoff ? (
              <button
                onClick={() => { setNotice(null); setStep('confirm'); }}
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

            {/* editable route */}
            <div className="bg-[#252836] rounded-2xl overflow-hidden">
              <button type="button"
                onClick={() => { haptic('light'); setStep('home'); setPicking('pickup'); if (pickup) setMapFly({ lat: pickup.lat, lng: pickup.lng }); }}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-[#ffffff0f] active:bg-[#2f3347] text-left">
                <div className="w-3 h-3 rounded-full bg-[#4ade80] border-2 border-[#1a1d27] flex-shrink-0" />
                <span className="text-white text-sm flex-1 truncate">{pickup?.address}</span>
                <span className="text-slate-500 text-xs flex-shrink-0">✎</span>
              </button>
              <button type="button"
                onClick={() => { haptic('light'); setStep('home'); setPicking('dropoff'); if (dropoff) setMapFly({ lat: dropoff.lat, lng: dropoff.lng }); }}
                className="w-full flex items-center gap-3 px-4 py-3 active:bg-[#2f3347] text-left">
                <div className="w-3 h-3 rounded-sm bg-[#f87171] border-2 border-[#1a1d27] flex-shrink-0" />
                <span className="text-white text-sm flex-1 truncate">{dropoff?.address}</span>
                <span className="text-slate-500 text-xs flex-shrink-0">✎</span>
              </button>
            </div>

            <p className="text-white font-bold text-lg">Izvēlies braucienu</p>

            {/* categories */}
            {loadingQuote && (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-20 bg-[#252836] rounded-2xl animate-pulse" />)}
              </div>
            )}

            {!loadingQuote && quoteError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 flex flex-col items-center gap-3 text-center">
                <span className="text-2xl">⚠️</span>
                <p className="text-red-300 text-sm">Neizdevās aprēķināt cenu. Pārbaudi savienojumu.</p>
                <button
                  type="button"
                  onClick={() => { haptic('light'); setQuoteRetry(n => n + 1); }}
                  className="bg-[#252836] active:bg-[#2f3347] text-white font-semibold px-5 py-2.5 rounded-xl text-sm">
                  Mēģināt vēlreiz
                </button>
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

            {bookError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                <span className="text-red-400 text-sm">⚠️</span>
                <p className="text-red-300 text-xs leading-relaxed">{bookError}</p>
              </div>
            )}

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
              <p className="text-slate-400 text-sm">
                {searchEta != null ? <>Tuvākais vadītājs ~<span className="text-[#FFCC00] font-semibold">{searchEta} min</span> attālumā</> : 'Parasti līdz 2 minūtēm'}
              </p>
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

            {cancelError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                <span className="text-red-400 text-sm">⚠️</span>
                <p className="text-red-300 text-xs leading-relaxed">{cancelError}</p>
              </div>
            )}

            <button onClick={handleCancel} disabled={cancelling}
              className="w-full bg-[#252836] active:bg-[#2f3347] disabled:opacity-50 text-red-400 font-semibold py-3.5 rounded-2xl text-sm border border-red-500/20">
              {cancelling ? '...' : 'Atcelt pasūtījumu'}
            </button>
          </div>
        )}

        {/* ════ ACTIVE (skeleton while status loads) ════ */}
        {step === 'active' && !rideStatus && (
          <div className="px-4 pb-8 space-y-4 animate-pulse">
            <div className="h-8 w-40 bg-[#252836] rounded-full mt-2" />
            <div className="h-[88px] bg-[#252836] rounded-2xl" />
            <div className="h-24 bg-[#252836] rounded-2xl" />
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
                <div className="w-14 h-14 rounded-2xl bg-[#FFCC00]/15 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {driverPhoto ? (
                    <img src={driverPhoto} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[#FFCC00] font-extrabold text-xl">
                      {rideStatus.driver.name?.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '🚕'}
                    </span>
                  )}
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

            {rideStatus.status === 'driver_arrived' && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-3 flex items-start gap-2">
                <span className="text-yellow-400 text-sm">⏱</span>
                <p className="text-yellow-300 text-xs leading-relaxed">
                  Vadītājs gaida. Pirmās 3 minūtes ir bezmaksas.<br/>
                  Pēc tam: €0.15/min gaidīšanas maksa.
                </p>
              </div>
            )}

            {rideStatus.status !== 'trip_started' && (
              <div className="space-y-2">
                {freeSecsLeft != null && freeSecsLeft > 0 && (
                  <div className="flex items-center justify-center gap-2 bg-green-500/10 rounded-xl px-4 py-2">
                    <span className="text-green-400 text-xs font-semibold">
                      ✓ Bezmaksas atcelšana vēl: {Math.floor(freeSecsLeft / 60)}:{String(freeSecsLeft % 60).padStart(2, '0')}
                    </span>
                  </div>
                )}
                {freeSecsLeft === 0 && (
                  <div className="flex items-center justify-center gap-2 bg-red-500/10 rounded-xl px-4 py-2">
                    <span className="text-red-400 text-xs font-semibold">⚠️ Atcelšana: €2.00 maksa</span>
                  </div>
                )}
                {cancelError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                    <span className="text-red-400 text-sm">⚠️</span>
                    <p className="text-red-300 text-xs leading-relaxed">{cancelError}</p>
                  </div>
                )}
                <button onClick={handleCancel} disabled={cancelling}
                  className="w-full bg-[#252836] text-red-400 border border-red-500/20 disabled:opacity-50 py-3.5 rounded-2xl text-sm font-semibold">
                  {cancelling ? '...' : 'Atcelt braucienu'}
                </button>
              </div>
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
                  onClick={() => { setStep('home'); setRide(null); setQuote(null); setPickup(null); setDropoff(null); setRated(false); setPicking('pickup'); }}
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
              <p className="text-slate-500 text-xs mt-1">maksa tiek iekasēta par vadītāja laiku</p>
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
