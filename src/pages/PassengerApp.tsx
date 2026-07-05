import { useState, useEffect } from 'react';
import MapPicker from '../components/MapPicker';
import CategoryCard from '../components/CategoryCard';
import AddressSearch from '../components/AddressSearch';
import type { Category, QuoteResult, Ride, RideStatus, RideHistoryItem } from '../api';
import { getQuote, requestRide, getRideStatus, cancelRide, rateRide, getPassengerHistory } from '../api';
import { haptic } from '../telegram';

interface LatLng { lat: number; lng: number }

type Step = 'pickup' | 'dropoff' | 'confirm' | 'searching' | 'active' | 'rating' | 'history';

interface Props { userId: number }

const CATEGORY_ORDER: Category[] = ['economy', 'comfort', 'xl'];

export default function PassengerApp({ userId }: Props) {
  const [step, setStep] = useState<Step>('pickup');
  const [pickup, setPickup] = useState<LatLng & { address: string } | null>(null);
  const [dropoff, setDropoff] = useState<LatLng & { address: string } | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [category, setCategory] = useState<Category>('economy');
  const [ride, setRide] = useState<Ride | null>(null);
  const [rideStatus, setRideStatus] = useState<RideStatus | null>(null);
  const [booking, setBooking] = useState(false);
  const [rating, setRating] = useState(5);
  const [tip, setTip] = useState(0);
  const [rated, setRated] = useState(false);
  const [mapClickMode, setMapClickMode] = useState<'pickup' | 'dropoff'>('pickup');
  const [history, setHistory] = useState<RideHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Fetch route quote when both points set
  useEffect(() => {
    if (!pickup || !dropoff) return;
    setLoadingQuote(true);
    setQuote(null);
    getQuote(pickup, dropoff)
      .then((r) => { if (r.ok) setQuote(r.quote); })
      .finally(() => setLoadingQuote(false));
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // Poll ride status when active
  useEffect(() => {
    if (!ride || !['searching', 'active'].includes(step)) return;
    const interval = setInterval(async () => {
      const s = await getRideStatus(ride.id);
      if (!s.ok) return;
      setRideStatus(s);
      if (s.status === 'requested' && step !== 'searching') setStep('searching');
      if (['driver_assigned', 'driver_arrived', 'trip_started'].includes(s.status)) setStep('active');
      if (s.status === 'trip_completed') setStep('rating');
      if (s.status === 'cancelled') { setStep('pickup'); setRide(null); }
    }, 5000);
    return () => clearInterval(interval);
  }, [ride?.id, step]);

  function handleMapClick(pos: LatLng) {
    if (step !== 'pickup' && step !== 'dropoff') return;
    haptic('light');
    if (mapClickMode === 'pickup') {
      setPickup({ ...pos, address: `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` });
      setMapClickMode('dropoff');
    } else {
      setDropoff({ ...pos, address: `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` });
    }
  }

  async function handleBook() {
    if (!pickup || !dropoff) return;
    setBooking(true);
    haptic('medium');
    const res = await requestRide({
      passenger_user_id: userId,
      pickup_address: pickup.address,
      dropoff_address: dropoff.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      category,
      estimated_price: quote?.prices[category],
      route_distance_meters: quote?.distanceMeters,
      route_duration_seconds: quote?.durationSeconds,
      route_polyline: quote?.encodedPolyline,
    });
    setBooking(false);
    if (res.ok) {
      setRide(res.ride);
      setStep('searching');
    }
  }

  async function openHistory() {
    setStep('history');
    setHistoryLoading(true);
    try {
      const r = await getPassengerHistory(userId);
      if (r.ok) setHistory(r.rides);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleCancel() {
    if (!ride) return;
    haptic('heavy');
    await cancelRide(ride.id, userId);
    setRide(null);
    setStep('pickup');
  }

  async function handleRate() {
    if (!ride) return;
    haptic('medium');
    await rateRide({ ride_id: ride.id, passenger_user_id: userId, rating, tip_amount: tip });
    setRated(true);
  }

  const durationMin = quote ? Math.round(quote.durationSeconds / 60) : 0;
  const distanceKm = quote ? (quote.distanceMeters / 1000).toFixed(1) : '—';

  return (
    <div className="flex flex-col h-full">
      {/* Map */}
      <div className="relative flex-shrink-0">
        <MapPicker
          height={step === 'confirm' || step === 'searching' || step === 'active' ? '45vh' : '55vh'}
          pickupMarker={pickup}
          dropoffMarker={dropoff}
          driverMarker={rideStatus?.driver_location ?? null}
          routePolyline={step === 'confirm' ? quote?.encodedPolyline : null}
          onMapClick={handleMapClick}
          interactive={step === 'pickup' || step === 'dropoff'}
        />
        {/* Map click hint */}
        {(step === 'pickup' || step === 'dropoff') && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
            {mapClickMode === 'pickup' ? '📍 Nospied karti — izvēlies punktu' : '🏁 Nospied karti — izvēlies galamērķi'}
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div className="flex-1 overflow-y-auto bg-slate-900 rounded-t-2xl -mt-4 relative z-10 px-4 pt-4 pb-safe safe-bottom">

        {/* ---- PICKUP / DROPOFF ---- */}
        {(step === 'pickup' || step === 'dropoff') && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Maršruts</h2>
            <AddressSearch
              icon="🟢"
              placeholder="Kur jūs atrodaties?"
              value={pickup?.address ?? ''}
              onChange={(address, lat, lng) => {
                setPickup({ lat, lng, address });
                setMapClickMode('dropoff');
              }}
            />
            <AddressSearch
              icon="🔴"
              placeholder="Galamērķis"
              value={dropoff?.address ?? ''}
              onChange={(address, lat, lng) => setDropoff({ lat, lng, address })}
            />
            {pickup && dropoff && (
              <button
                onClick={() => setStep('confirm')}
                className="w-full bg-brand text-slate-900 font-bold py-3.5 rounded-xl text-sm active:opacity-80"
              >
                {loadingQuote ? 'Aprēķina cenu...' : 'Turpināt →'}
              </button>
            )}
            {/* Tab switcher */}
            <div className="flex gap-2 pt-1">
              {(['pickup', 'dropoff'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMapClickMode(m)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border ${
                    mapClickMode === m ? 'border-brand text-brand bg-yellow-400/10' : 'border-slate-700 text-slate-400'
                  }`}
                >
                  {m === 'pickup' ? '📍 Izejas punkts' : '🏁 Galamērķis'}
                </button>
              ))}
            </div>
            <button
              onClick={openHistory}
              className="w-full border border-slate-700 text-slate-400 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-2"
            >
              🕐 Braucienu vēsture
            </button>
          </div>
        )}

        {/* ---- CONFIRM ---- */}
        {step === 'confirm' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Izvēlies kategoriju</h2>
              <span className="text-xs text-slate-500">{distanceKm} km · {durationMin} min</span>
            </div>
            {loadingQuote && (
              <div className="text-center text-slate-400 text-sm py-4">Aprēķina cenas...</div>
            )}
            {quote && CATEGORY_ORDER.map((cat) => (
              <CategoryCard
                key={cat}
                category={cat}
                price={quote.prices[cat]}
                durationMin={durationMin}
                selected={category === cat}
                onSelect={() => { setCategory(cat); haptic('light'); }}
              />
            ))}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStep('pickup')}
                className="flex-1 border border-slate-700 text-slate-300 py-3 rounded-xl text-sm"
              >
                ← Atpakaļ
              </button>
              <button
                onClick={handleBook}
                disabled={booking || !quote}
                className="flex-1 bg-brand text-slate-900 font-bold py-3 rounded-xl text-sm disabled:opacity-50 active:opacity-80"
              >
                {booking ? 'Rezervē...' : `Pasūtīt ${category === 'economy' ? 'Economy' : category === 'comfort' ? 'Comfort' : 'XL'}`}
              </button>
            </div>
          </div>
        )}

        {/* ---- SEARCHING ---- */}
        {step === 'searching' && (
          <div className="space-y-4 pt-2">
            <div className="text-center">
              <div className="text-3xl mb-2 animate-bounce">🔍</div>
              <div className="font-semibold text-white">Meklē braucēju...</div>
              <div className="text-xs text-slate-400 mt-1">Lūdzu, uzgaidiet</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">No:</span>
                <span className="text-white text-right max-w-48 truncate">{pickup?.address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Uz:</span>
                <span className="text-white text-right max-w-48 truncate">{dropoff?.address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cena:</span>
                <span className="text-brand font-semibold">€{ride?.estimated_price}</span>
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="w-full border border-red-500/50 text-red-400 py-3 rounded-xl text-sm"
            >
              Atcelt pasūtījumu
            </button>
          </div>
        )}

        {/* ---- ACTIVE RIDE ---- */}
        {step === 'active' && rideStatus && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusBadge status={rideStatus.status} />
              {rideStatus.driver_eta_minutes != null && (
                <span className="text-brand font-bold text-sm">{rideStatus.driver_eta_minutes} min</span>
              )}
            </div>
            {rideStatus.driver && (
              <div className="bg-slate-800 rounded-xl p-3 flex items-center gap-3">
                <div className="text-3xl">🧑‍✈️</div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">{rideStatus.driver.name}</div>
                  <div className="text-xs text-slate-400">{rideStatus.driver.car} · {rideStatus.driver.car_number}</div>
                </div>
                <div className="text-right">
                  <div className="text-yellow-400 text-sm">★ {rideStatus.driver.rating?.toFixed(1)}</div>
                  <div className="text-xs text-slate-400 capitalize">{rideStatus.driver.category}</div>
                </div>
              </div>
            )}
            <div className="bg-slate-800 rounded-xl p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Uz:</span>
                <span className="text-white truncate max-w-48">{dropoff?.address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cena:</span>
                <span className="text-brand font-semibold">���{ride?.estimated_price}</span>
              </div>
            </div>
            {rideStatus.status !== 'trip_started' && (
              <button onClick={handleCancel} className="w-full border border-red-500/50 text-red-400 py-2.5 rounded-xl text-sm">
                Atcelt
              </button>
            )}
          </div>
        )}

        {/* ---- RATING ---- */}
        {step === 'rating' && (
          <div className="space-y-4 pt-2">
            {!rated ? (
              <>
                <div className="text-center">
                  <div className="text-3xl mb-2">🏁</div>
                  <div className="font-semibold text-white">Brauciens pabeigts!</div>
                  <div className="text-xs text-slate-400 mt-1">Novērtē braucēju</div>
                </div>
                <div className="flex justify-center gap-2">
                  {[1,2,3,4,5].map(s => (
                    <button key={s} onClick={() => { setRating(s); haptic('light'); }}
                      className={`text-3xl transition-transform ${s <= rating ? 'scale-110' : 'opacity-30'}`}>
                      ⭐
                    </button>
                  ))}
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-2">Dzeramnauда (€)</div>
                  <div className="flex gap-2">
                    {[0, 1, 2, 5].map(t => (
                      <button key={t} onClick={() => { setTip(t); haptic('light'); }}
                        className={`flex-1 py-2 rounded-lg text-sm border font-medium ${
                          tip === t ? 'border-brand text-brand bg-yellow-400/10' : 'border-slate-700 text-slate-400'
                        }`}>
                        {t === 0 ? 'Nav' : `+€${t}`}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleRate} className="w-full bg-brand text-slate-900 font-bold py-3.5 rounded-xl text-sm">
                  Nosūtīt novērtējumu
                </button>
              </>
            ) : (
              <div className="text-center py-8 space-y-3">
                <div className="text-4xl">🙏</div>
                <div className="font-semibold text-white">Paldies!</div>
                <button onClick={() => { setStep('pickup'); setRide(null); setQuote(null); setPickup(null); setDropoff(null); setRated(false); }}
                  className="w-full bg-brand text-slate-900 font-bold py-3.5 rounded-xl text-sm mt-4">
                  Jauns brauciens
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---- HISTORY ---- */}
        {step === 'history' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Braucienu vēsture</h2>
              <button onClick={() => setStep('pickup')} className="text-slate-400 text-xs">✕ Aizvērt</button>
            </div>
            {historyLoading && (
              <div className="text-center py-8 text-slate-500 text-sm animate-pulse">Ielādē...</div>
            )}
            {!historyLoading && history.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm">Nav braucienu vēstures</div>
            )}
            {history.map(r => (
              <div key={r.id} className="bg-slate-800 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">#{r.id} · {new Date(r.created_at).toLocaleDateString('lv-LV')}</span>
                  <HistoryStatusBadge status={r.status} />
                </div>
                <div className="text-xs text-slate-300 truncate">🟢 {r.pickup_address || '—'}</div>
                <div className="text-xs text-slate-300 truncate">🔴 {r.dropoff_address || '—'}</div>
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-slate-500">
                    {r.driver_name ? `🚗 ${r.driver_name} · ${r.driver_car}` : ''}
                  </div>
                  <div className="text-sm font-bold text-brand">
                    €{Number(r.final_price ?? r.estimated_price ?? 0).toFixed(2)}
                  </div>
                </div>
                {r.passenger_rating != null && (
                  <div className="text-xs text-slate-500">{'⭐'.repeat(r.passenger_rating)} novērtēts</div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

function HistoryStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    trip_completed: { label: '✓ Pabeigts', color: 'text-green-400' },
    cancelled:      { label: '✕ Atcelts', color: 'text-red-400' },
    expired:        { label: '⏱ Beidzies', color: 'text-slate-500' },
  };
  const s = map[status] ?? { label: status, color: 'text-slate-400' };
  return <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    driver_assigned: { label: 'Braucējs dodas', color: 'bg-blue-500/20 text-blue-300' },
    driver_arrived:  { label: 'Braucējs ieradies', color: 'bg-green-500/20 text-green-300' },
    trip_started:    { label: 'Brauciens notiek', color: 'bg-brand/20 text-brand' },
  };
  const s = map[status] ?? { label: status, color: 'bg-slate-700 text-slate-300' };
  return <span className={`text-xs font-semibold px-3 py-1 rounded-full ${s.color}`}>{s.label}</span>;
}
