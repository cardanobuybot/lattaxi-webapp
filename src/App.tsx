import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import PassengerApp from './pages/PassengerApp';
import DriverApp from './pages/DriverApp';
import { tg, getTelegramUser } from './telegram';
import { registerUser } from './api';

type Mode = 'loading' | 'ready' | 'error';

interface AppState {
  mode: Mode;
  userId: number | null;
  telegramId: number | null;
  userName: string;
}

function useAppInit() {
  const [state, setState] = useState<AppState>({
    mode: 'loading', userId: null, telegramId: null, userName: '',
  });

  useEffect(() => {
    tg?.ready();
    tg?.expand();

    const tgUser = getTelegramUser();

    async function init() {
      const mockTgId = 999001;
      const id = tgUser?.id ?? mockTgId;
      const name = tgUser
        ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'User'
        : 'Test User';

      const res = await registerUser(id, name);
      if (res.ok) {
        setState({ mode: 'ready', userId: res.user.id, telegramId: id, userName: name });
      } else {
        setState(s => ({ ...s, mode: 'error' }));
      }
    }

    init();
  }, []);

  return state;
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-full bg-slate-900">
      <div className="text-center space-y-3">
        <div className="text-4xl animate-spin">🚕</div>
        <div className="text-slate-400 text-sm">Ielādē...</div>
      </div>
    </div>
  );
}

function ErrorScreen() {
  return (
    <div className="flex items-center justify-center h-full bg-slate-900">
      <div className="text-center text-slate-400 text-sm px-8">
        Neizdevās pieslēgties. Mēģini vēlreiz.
      </div>
    </div>
  );
}

export default function App() {
  const { mode, userId, telegramId, userName } = useAppInit();

  if (mode === 'loading') return <LoadingScreen />;
  if (mode === 'error') return <ErrorScreen />;
  if (!userId || !telegramId) return null;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PassengerApp userId={userId} />} />
        <Route path="/driver" element={<DriverApp telegramId={telegramId} userName={userName} />} />
      </Routes>
    </BrowserRouter>
  );
}
