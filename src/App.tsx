import { useEffect, useState } from 'react';
import './index.css';
import PassengerApp from './pages/PassengerApp';
import DriverApp from './pages/DriverApp';
import { tg, getTelegramUser } from './telegram';
import { registerUser } from './api';

type Mode = 'loading' | 'passenger' | 'driver' | 'error';

export default function App() {
  const [mode, setMode] = useState<Mode>('loading');
  const [userId, setUserId] = useState<number | null>(null);
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    tg?.ready();
    tg?.expand();

    const isDriver = window.location.pathname.startsWith('/driver');
    const tgUser = getTelegramUser();

    async function init() {
      if (tgUser) {
        const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
        setUserName(name || tgUser.username || 'User');
        setTelegramId(tgUser.id);

        if (!isDriver) {
          const res = await registerUser(tgUser.id, name);
          if (res.ok) {
            setUserId(res.user.id);
            setMode('passenger');
          } else {
            setMode('error');
          }
        } else {
          setMode('driver');
        }
      } else {
        // Dev fallback — use mock user
        const mockTgId = 999001;
        setTelegramId(mockTgId);
        setUserName('Test User');
        if (!isDriver) {
          const res = await registerUser(mockTgId, 'Test User');
          if (res.ok) { setUserId(res.user.id); setMode('passenger'); }
          else setMode('error');
        } else {
          setMode('driver');
        }
      }
    }

    init();
  }, []);

  if (mode === 'loading') {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900">
        <div className="text-center space-y-3">
          <div className="text-4xl animate-spin">🚕</div>
          <div className="text-slate-400 text-sm">Ielādē...</div>
        </div>
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900">
        <div className="text-center text-slate-400 text-sm px-8">
          Neizdevās pieslēgties. Mēģini vēlreiz.
        </div>
      </div>
    );
  }

  if (mode === 'passenger' && userId) {
    return <PassengerApp userId={userId} />;
  }

  if (mode === 'driver' && telegramId) {
    return <DriverApp telegramId={telegramId} userName={userName} />;
  }

  return null;
}
