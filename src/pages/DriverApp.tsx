import { useState, useEffect, useRef } from 'react';
import MapPicker from '../components/MapPicker';
import type { Category } from '../api';
import { registerDriver, setDriverStatus, getRideStatus } from '../api';
import { haptic } from '../telegram';

const API = import.meta.env.VITE_API_URL ?? 'https://api.lattaxi.lv';

interface Props { telegramId: number; userName: string }

type DriverStep = 'register' | 'dashboard' | 'offer' | 'active';

interface OfferData {
  rideId: number;
  offerId: number;
  pickup: string;
  dropoff: string;
  price: string;
  distanceKm: string;
  pickupLat: number;
  pickupLng: number;
}

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
  const [step, setStep] = useState<DriverStep>('register');
  const [online, setOnline] = useState(false);
  const [category, setCategory] = useState<Category>('economy');
  const [car, setCar] = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [offer, setOffer] = useState<OfferData | null>(null);
  const [activeRideId, setActiveRideId] = useState<number | null>(null);
  const [rideStatus, setRideStatus] = useState<string>('');
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const geoWatchRef = useRef<number | null>(null);

  // Start/stop GPS tracking when online
  useEffect(() => {
    if (online && navigator.geolocation) {
      geoWatchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          setDriverPos({ lat, lng });
          updateDriverLocation(telegramId, lat, lng);
        },
        () => { /* permission denied */ },
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    } else {
      if (geoWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
        geoWatchRef.current = null;
      }
    }
    return () => {
      if (geoWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
      }
    };
  }, [online, telegramId]);

  // Poll for pending offers when online
  useEffect(() => {
    if (!online || step !== 'dashboard') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/drivers/${telegramId}/offers/pending`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && data.offer) {
          setOffer(data.offer);
          setStep('offer');
          haptic('heavy');
        }
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(interval);
  }, [online, step, telegramId]);

  // Poll active ride status
  useEffect(() => {
    if (!activeRideId || step !== 'active') return;
    const interval = setInterval(async () => {
      const s = await getRideStatus(activeRideId);
      if (s.ok) setRideStatus(s.status);
      if (s.status === 'trip_completed' || s.status === 'cancelled') {
        setStep('dashboard');
        setActiveRideId(null);
        setRideStatus('');
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeRideId, step]);

  async function handleRegister() {
    if (!car || !carNumber) return;
    haptic('medium');
    const res = await registerDriver({ telegram_id: telegramId, name: userName, car, car_number: carNumber, category }) as { ok: boolean };
    if (res.ok) setStep('dashboard');
  }

  async function toggleOnline() {
    haptic('medium');
    const newStatus = online ? 'offline' : 'online';
    await setDriverStatus(telegramId, newStatus);
    setOnline(!online);
  }

  async function handleOfferResponse(accept: boolean) {
    if (!offer) return;
    haptic(accept ? 'medium' : 'light');
    await respondToOffer(offer.offerId, accept, telegramId);
    if (accept) {
      setActiveRideId(offer.rideId);
      setRideStatus('driver_assigned');
      setStep('active');
    } else {
      setStep('dashboard');
    }
    setOffer(null);
  }

  async function handleStatusUpdate(newStatus: string) {
    if (!activeRideId) return;
    haptic('medium');
    await updateRideStatus(activeRideId, newStatus, telegramId);
    setRideStatus(newStatus);
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">

      {/* Register */}
      {step === 'register' && (
        <div className="flex-1 flex flex-col justify-center px-6 space-y-4">
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">🚕</div>
            <h1 className="text-xl font-bold text-white">LatTaxi — Vadītājs</h1>
            <p className="text-xs text-slate-400 mt-1">Reģistrējies, lai sāktu</p>
          </div>
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-400"
            placeholder="Auto marka (piem. Toyota Camry)"
            value={car}
            onChange={e => setCar(e.target.value)}
          />
          <input
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-400 uppercase"
            placeholder="Reģistrācijas numurs (AA-1234)"
            value={carNumber}
            onChange={e => setCarNumber(e.target.value.toUpperCase())}
          />
          <div>
            <div className="text-xs text-slate-400 mb-2">Kategorija</div>
            <div className="flex gap-2">
              {(['economy', 'comfort', 'xl'] as Category[]).map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border ${
                    category === c ? 'border-brand text-brand bg-yellow-400/10' : 'border-slate-700 text-slate-400'
                  }`}>
                  {c === 'economy' ? '🚗' : c === 'comfort' ? '🚙' : '🚐'} {c}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleRegister}
            disabled={!car || !carNumber}
            className="w-full bg-brand text-slate-900 font-bold py-3.5 rounded-xl text-sm disabled:opacity-50"
          >
            Reģistrēties
          </button>
        </div>
      )}

      {/* Dashboard */}
      {step === 'dashboard' && (
        <div className="flex-1 flex flex-col">
          <MapPicker
            height="50vh"
            interactive={false}
            center={driverPos ?? undefined}
            pickupMarker={driverPos}
          />
          <div className="flex-1 px-4 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-white">{userName}</div>
                <div className="text-xs text-slate-400 capitalize">{category} · {car}</div>
              </div>
              <button
                onClick={toggleOnline}
                className={`px-5 py-2.5 rounded-full font-bold text-sm transition-all ${
                  online ? 'bg-green-500 text-white' : 'bg-slate-700 text-slate-300'
                }`}
              >
                {online ? '🟢 Online' : '⚫ Offline'}
              </button>
            </div>
            {online ? (
              <div className="bg-slate-800 rounded-xl p-4 text-center">
                <div className="text-2xl mb-1 animate-pulse">📡</div>
                <div className="text-sm text-slate-300">Gaida pasūtījumus...</div>
                {driverPos && (
                  <div className="text-xs text-slate-500 mt-1">
                    GPS aktīvs · {driverPos.lat.toFixed(4)}, {driverPos.lng.toFixed(4)}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-800 rounded-xl p-4 text-center">
                <div className="text-sm text-slate-400">Nospied Online, lai saņemtu pasūtījumus</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Offer */}
      {step === 'offer' && offer && (
        <div className="flex-1 flex flex-col">
          <MapPicker
            height="40vh"
            pickupMarker={{ lat: offer.pickupLat, lng: offer.pickupLng }}
            interactive={false}
          />
          <div className="flex-1 px-4 pt-4 space-y-4">
            <div className="text-center">
              <div className="text-3xl mb-1 animate-bounce">📨</div>
              <div className="font-bold text-white">Jauns pasūtījums!</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">No:</span>
                <span className="text-white text-right max-w-[180px] truncate">{offer.pickup}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Uz:</span>
                <span className="text-white text-right max-w-[180px] truncate">{offer.dropoff}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cena:</span>
                <span className="text-brand font-bold">€{offer.price}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Attālums:</span>
                <span className="text-white">{offer.distanceKm} km</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => handleOfferResponse(false)}
                className="flex-1 border border-red-500/50 text-red-400 py-3.5 rounded-xl font-semibold text-sm">
                ✕ Noraidīt
              </button>
              <button onClick={() => handleOfferResponse(true)}
                className="flex-1 bg-brand text-slate-900 py-3.5 rounded-xl font-bold text-sm">
                ✓ Pieņemt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active ride */}
      {step === 'active' && (
        <div className="flex-1 flex flex-col">
          <MapPicker
            height="45vh"
            interactive={false}
            center={driverPos ?? undefined}
            pickupMarker={driverPos}
          />
          <div className="flex-1 px-4 pt-4 space-y-3">
            <div className="bg-slate-800 rounded-xl p-3 text-sm">
              <div className="font-semibold text-white mb-1">Brauciens #{activeRideId}</div>
              <StatusRow status={rideStatus} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleStatusUpdate('driver_arrived')}
                disabled={rideStatus === 'driver_arrived' || rideStatus === 'trip_started'}
                className="bg-blue-600 disabled:opacity-40 text-white py-3 rounded-xl text-xs font-semibold"
              >
                📍 Ieradies
              </button>
              <button
                onClick={() => handleStatusUpdate('trip_started')}
                disabled={rideStatus === 'trip_started'}
                className="bg-green-600 disabled:opacity-40 text-white py-3 rounded-xl text-xs font-semibold"
              >
                ▶️ Sākt braucienu
              </button>
            </div>
            <button
              onClick={() => handleStatusUpdate('trip_completed')}
              disabled={rideStatus !== 'trip_started'}
              className="w-full bg-brand disabled:opacity-40 text-slate-900 py-3.5 rounded-xl text-sm font-bold"
            >
              🏁 Pabeigt braucienu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  driver_assigned: '🚗 Dodas pie pasažiera',
  driver_arrived:  '📍 Ieradies pie pasažiera',
  trip_started:    '▶️ Brauciens notiek',
  trip_completed:  '🏁 Pabeigts',
};

function StatusRow({ status }: { status: string }) {
  return (
    <div className="text-slate-400 text-xs">
      {STATUS_LABELS[status] ?? status}
    </div>
  );
}
