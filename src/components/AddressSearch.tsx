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
}

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

async function searchPhoton(q: string): Promise<Suggestion[]> {
  const res = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lang=lv&lat=56.946&lon=24.105&zoom=14&bbox=23.7,56.8,24.4,57.1`,
    { headers: { 'Accept-Language': 'lv' } }
  );
  const data = await res.json();
  if (!data.features) return [];
  return data.features
    .map((f: { geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; city?: string; postcode?: string } }) => {
      const p = f.properties;
      const parts: string[] = [];
      if (p.street && p.housenumber) parts.push(`${p.street} ${p.housenumber}`);
      else if (p.street) parts.push(p.street);
      else if (p.name) parts.push(p.name);
      if (p.city && p.city !== parts[0]) parts.push(p.city);
      if (p.postcode) parts.push(p.postcode);
      return {
        display_name: parts.join(', ') || p.name || '',
        lat: String(f.geometry.coordinates[1]),
        lon: String(f.geometry.coordinates[0]),
      };
    })
    .filter((s: Suggestion) => s.display_name);
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

const RECENTS_KEY = 'lattaxi_recent_addresses';

function loadRecents(): Suggestion[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
}

function saveRecent(s: Suggestion) {
  const list = [s, ...loadRecents().filter(r => r.display_name !== s.display_name)].slice(0, 5);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export default function AddressSearch({ placeholder, value, onChange }: Props) {
  const [query, setQuery]           = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [recents, setRecents]       = useState<Suggestion[]>(loadRecents);
  const [open, setOpen]             = useState(false);
  const [loading, setLoading]       = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setQuery(value); }, [value]);

  function search(q: string) {
    setQuery(q);
    clearTimeout(timer.current);
    if (q.length < 2) { setSuggestions([]); setOpen(recents.length > 0); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = GMAPS_KEY ? await searchGooglePlaces(q) : await searchPhoton(q);
        setSuggestions(results);
        setOpen(true);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }, 350);
  }

  function pick(s: Suggestion) {
    const short = s.display_name.split(',').slice(0, 2).join(',').trim();
    setQuery(short);
    setSuggestions([]);
    setOpen(false);
    saveRecent({ display_name: short, lat: s.lat, lon: s.lon });
    setRecents(loadRecents());
    onChange(short, parseFloat(s.lat), parseFloat(s.lon));
  }

  const showingRecents = query.trim().length < 2;
  const list = showingRecents ? recents : suggestions;

  return (
    <div className="flex-1 relative">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none py-0.5"
          placeholder={placeholder}
          value={query}
          onChange={e => search(e.target.value)}
          onFocus={() => list.length > 0 && setOpen(true)}
        />
        {loading && <span className="text-slate-600 text-xs animate-pulse">●●●</span>}
        {!loading && query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setSuggestions([]); setOpen(false); }}
            className="text-slate-600 text-sm w-5 h-5 flex items-center justify-center rounded-full hover:bg-[#ffffff10]"
          >
            ✕
          </button>
        )}
      </div>
      {open && list.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#1e2130] border border-[#ffffff12] rounded-2xl overflow-hidden shadow-2xl">
          {showingRecents && (
            <li className="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Nesenās adreses
            </li>
          )}
          {list.map((s, i) => (
            <li key={i} className="border-b border-[#ffffff08] last:border-0">
              <button
                type="button"
                className="w-full text-left px-4 py-3 text-sm text-slate-200 active:bg-[#252836] flex items-start gap-3"
                onClick={() => pick(s)}
              >
                <span className="text-slate-500 mt-0.5 flex-shrink-0">{showingRecents ? '🕐' : '📍'}</span>
                <span className="truncate">{s.display_name.split(',').slice(0, 3).join(', ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
