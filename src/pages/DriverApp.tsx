import { useState, useEffect } from 'react';
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
  distanceKm: number;
  pickupLat: number;
  pickupLng: number;
}

export default function DriverApp({ telegramId, userName }: Props) {
  const [step, setStep] = useState<DriverStep>('register');
  const [online, setOnline] = useState(false);
  const [category, setCategory] = useState<Category>('economy');
  const [car, setCar] = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [offer, setOffer] = useState<OfferData | null>(null);
  const [activeRideId, setActiveRideId] = useState<number | null>(null);
  const [rideInfo, setRideInfo] = useState<any>(null);
  async function handleRegister() {
    if (!car || !carNumber) return;
    haptic('medium');
    const res = await registerDriver({ telegram_id: telegramId, name: userName, car, car_number: carNumber, category }) as { ok: boolean };
    if (res.ok) { setStep('dashboard'); }
  }

  async function toggleOnline() {
    haptic('medium');
    const newStatus = online ? 'offline' : 'online';
    await setDriverStatus(telegramId, newStatus);
    setOnline(!online);
  }

  // Poll for ride offers when online
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
      if (s.ok) setRideInfo(s);
      if (s.status === 'trip_completed' || s.status === 'cancelled') {
        setStep('dashboard');
        setActiveRideId(null);
        setRideInfo(null);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeRideId, step]);

  async function respondOffer(accept: boolean) {
    if (!offer) return;
    haptic(accept ? 'medium' : 'light');
    await fetch(`${API}/driver-offers/${offer.offerId}/${accept ? 'accept' : 'reject'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_telegram_id: telegramId }),
    });
    if (accept) {
      setActiveRideId(offer.rideId);
      setStep('active');
    } else {
      setStep('dashboard');
    }
    setOffer(null);
  }

  async function updateRideStatus(newStatus: string) {
    if (!activeRideId) return;
    haptic('medium');
    await fetch(`${API}/rides/${activeRideId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, driver_telegram_id: telegramId }),
    });
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Register */}
      {step === 'register' && (
        <div className="flex-1 flex flex-col justify-center px-6 space-y-4">
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">🚕</div>
            <h1 className="text-xl font-bold text-white">LatTaxi — Braucējs</h1>
            <p className="text-xs text-slate-400 mt-1">Reģistrējies, lai sāktu</p>
          </div>
          <div className="space-y-3">
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
          <MapPicker height="50vh" interactive={false} />
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
              <div className="text-3xl mb-1">📨</div>
              <div className="font-bold text-white">Jauns pasūtījums!</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">No:</span>
                <span className="text-white text-right max-w-48 truncate">{offer.pickup}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Uz:</span>
                <span className="text-white text-right max-w-48 truncate">{offer.dropoff}</span>
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
              <button onClick={() => respondOffer(false)}
                className="flex-1 border border-red-500/50 text-red-400 py-3.5 rounded-xl font-semibold text-sm">
                ✕ Noraidīt
              </button>
              <button onClick={() => respondOffer(true)}
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
          <MapPicker height="45vh" interactive={false} />
          <div className="flex-1 px-4 pt-4 space-y-3">
            {rideInfo && (
              <div className="bg-slate-800 rounded-xl p-3 space-y-2 text-sm">
                <div className="font-semibold text-white">Aktīvais brauciens #{activeRideId}</div>
                <div className="text-xs text-slate-400 capitalize">Statuss: {rideInfo.status}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => updateRideStatus('driver_arrived')}
                className="bg-blue-600 text-white py-3 rounded-xl text-xs font-semibold">
                Ieradies
              </button>
              <button onClick={() => updateRideStatus('trip_started')}
                className="bg-green-600 text-white py-3 rounded-xl text-xs font-semibold">
                Sākt braucienu
              </button>
              <button onClick={() => updateRideStatus('trip_completed')}
                className="col-span-2 bg-brand text-slate-900 py-3 rounded-xl text-sm font-bold">
                ✓ Pabeigt braucienu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
