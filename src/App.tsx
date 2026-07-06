import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import PassengerApp from './pages/PassengerApp';
import DriverApp from './pages/DriverApp';
import AdminPanel from './pages/AdminPanel';
import { tg, getTelegramUser } from './telegram';
import { registerUser } from './api';

type Mode = 'loading' | 'ready' | 'error' | 'no-telegram';

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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    tg?.ready();
    tg?.expand();

    const tgUser = getTelegramUser();

    async function init() {
      if (!tgUser?.id) {
        setState(s => ({ ...s, mode: 'no-telegram' }));
        return;
      }
      const id = tgUser.id;
      const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'User';

      try {
        const res = await registerUser(id, name);
        if (res.ok) {
          setState({ mode: 'ready', userId: res.user.id, telegramId: id, userName: name });
        } else {
          setState(s => ({ ...s, mode: 'error' }));
        }
      } catch {
        setState(s => ({ ...s, mode: 'error' }));
      }
    }

    setState(s => ({ ...s, mode: 'loading' }));
    init();
  }, [attempt]);

  return { ...state, retry: () => setAttempt(a => a + 1) };
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

function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center h-full bg-slate-900">
      <div className="text-center space-y-4 px-8">
        <div className="text-slate-400 text-sm">
          Neizdevās pieslēgties. Mēģini vēlreiz.
        </div>
        <button onClick={onRetry}
          className="bg-[#FFCC00] text-[#0f1117] font-bold py-3 px-6 rounded-2xl text-sm">
          Mēģināt vēlreiz
        </button>
      </div>
    </div>
  );
}

function NoTelegramScreen() {
  return (
    <div className="flex items-center justify-center h-full bg-slate-900">
      <div className="text-center text-slate-400 text-sm px-8">
        Atveriet lietotni caur Telegram botu @LatTaxiBot
      </div>
    </div>
  );
}

function AdminApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<AdminPanel />} />
      </Routes>
    </BrowserRouter>
  );
}

function MainApp() {
  const { mode, userId, telegramId, userName, retry } = useAppInit();

  if (mode === 'loading') return <LoadingScreen />;
  if (mode === 'no-telegram') return <NoTelegramScreen />;
  if (mode === 'error') return <ErrorScreen onRetry={retry} />;
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

export default function App() {
  if (window.location.pathname.startsWith('/admin')) {
    return <AdminApp />;
  }
  return <MainApp />;
}
