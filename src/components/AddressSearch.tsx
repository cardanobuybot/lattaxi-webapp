import { useState, useRef, useEffect } from 'react';

interface Suggestion {
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  placeholder: string;
  value: string;
  onChange: (address: string, lat: number, lng: number) => void;
  icon?: string;
}

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

async function searchNominatim(q: string): Promise<Suggestion[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Rīga')}&format=json&limit=5&countrycodes=lv`,
    { headers: { 'Accept-Language': 'lv' } }
  );
  return res.json();
}

async function searchGooglePlaces(q: string): Promise<Suggestion[]> {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&location=56.946,24.105&radius=30000&language=lv&components=country:lv&key=${GMAPS_KEY}`
  );
  const data = await res.json();
  if (!data.predictions) return [];

  const details = await Promise.all(
    data.predictions.slice(0, 5).map(async (p: { place_id: string; description: string }) => {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=geometry,formatted_address&key=${GMAPS_KEY}`
      );
      const d = await r.json();
      return {
        display_name: p.description,
        lat: String(d.result?.geometry?.location?.lat ?? ''),
        lon: String(d.result?.geometry?.location?.lng ?? ''),
      };
    })
  );
  return details.filter(s => s.lat);
}

export default function AddressSearch({ placeholder, value, onChange, icon = '📍' }: Props) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setQuery(value); }, [value]);

  function search(q: string) {
    setQuery(q);
    clearTimeout(timer.current);
    if (q.length < 3) { setSuggestions([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = GMAPS_KEY
          ? await searchGooglePlaces(q)
          : await searchNominatim(q);
        setSuggestions(results);
        setOpen(true);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }, 350);
  }

  function pick(s: Suggestion) {
    const short = GMAPS_KEY
      ? s.display_name.split(',').slice(0, 2).join(',').trim()
      : s.display_name.split(',').slice(0, 2).join(',').trim();
    setQuery(short);
    setSuggestions([]);
    setOpen(false);
    onChange(short, parseFloat(s.lat), parseFloat(s.lon));
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5">
        <span className="text-base">{icon}</span>
        <input
          className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 outline-none"
          placeholder={placeholder}
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
        />
        {loading && <span className="text-slate-500 text-xs animate-pulse">...</span>}
        {!loading && query && (
          <button onClick={() => { setQuery(''); setSuggestions([]); }} className="text-slate-500 text-xs">✕</button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-xl">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-700 border-b border-slate-700 last:border-0"
                onClick={() => pick(s)}
              >
                {s.display_name.split(',').slice(0, 3).join(', ')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
