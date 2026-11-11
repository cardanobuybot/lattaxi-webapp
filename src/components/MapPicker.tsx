import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface LatLng { lat: number; lng: number }

interface Props {
  center?: LatLng;
  pickupMarker?: LatLng | null;
  dropoffMarker?: LatLng | null;
  driverMarker?: LatLng | null;
  routePolyline?: string | null;
  onMapClick?: (pos: LatLng) => void;
  onMoveStart?: () => void;
  onCenterChange?: (pos: LatLng) => void;
  panOnClick?: boolean;
  height?: string;
  interactive?: boolean;
}

const DEFAULT_CENTER: LatLng = { lat: 56.946, lng: 24.105 };

function decodePolyline(encoded: string): [number, number][] {
  let index = 0, lat = 0, lng = 0;
  const coords: [number, number][] = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

// ── Leaflet fallback icons ───────────────────────────────────────
const pickupIcon = L.divIcon({
  html: `<div style="width:18px;height:18px;background:#16a34a;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9], className: '',
});
const dropoffIcon = L.divIcon({
  html: `<div style="width:18px;height:18px;background:#dc2626;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9], className: '',
});
const driverIcon = L.divIcon({
  html: `<div style="font-size:24px;line-height:1">🚕</div>`,
  iconSize: [28, 28], iconAnchor: [14, 14], className: '',
});

// ── Google Maps script loader (singleton across all MapPicker instances) ──
type GmLoadState = 'idle' | 'loading' | 'ready' | 'failed';
let gmLoadState: GmLoadState = 'idle';
const gmCallbacks: Array<(ok: boolean) => void> = [];

function loadGoogleMaps(apiKey: string, onDone: (ok: boolean) => void): void {
  if (gmLoadState === 'ready') { onDone(true); return; }
  if (gmLoadState === 'failed') { onDone(false); return; }
  gmCallbacks.push(onDone);
  if (gmLoadState === 'loading') return;
  gmLoadState = 'loading';

  (window as unknown as Record<string, unknown>).gm_authFailure = () => {
    console.log('[LatTaxi] Google Maps autorizācija neizdevās, izmanto Leaflet.');
    gmLoadState = 'failed';
    gmCallbacks.splice(0).forEach(fn => fn(false));
  };

  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry&loading=async`;
  s.async = true;
  s.onerror = () => {
    console.log('[LatTaxi] Google Maps ielāde neizdevās, izmanto Leaflet.');
    gmLoadState = 'failed';
    gmCallbacks.splice(0).forEach(fn => fn(false));
  };
  s.onload = () => {
    gmLoadState = 'ready';
    gmCallbacks.splice(0).forEach(fn => fn(true));
  };
  document.head.appendChild(s);
}

// ── Google Maps component ────────────────────────────────────────
// Uses classic google.maps.Marker (deprecated as of v3.60 but functional).
// Upgrade path: replace with AdvancedMarkerElement once a mapId is provisioned
// in Google Cloud Console and added as VITE_GOOGLE_MAPS_MAP_ID.
function GoogleMapPicker({
  center, pickupMarker, dropoffMarker, driverMarker, routePolyline,
  onMapClick, onMoveStart, onCenterChange,
  panOnClick = false, height = '55vh', interactive = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const pickupRef = useRef<google.maps.Marker | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const dropoffRef = useRef<google.maps.Marker | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const driverRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const cbRef = useRef({ onMapClick, onMoveStart, onCenterChange, panOnClick, interactive });
  useEffect(() => { cbRef.current = { onMapClick, onMoveStart, onCenterChange, panOnClick, interactive }; });

  // Initialise map once on mount
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const G = google.maps;

    const map = new G.Map(containerRef.current, {
      center: { lat: center?.lat ?? DEFAULT_CENTER.lat, lng: center?.lng ?? DEFAULT_CENTER.lng },
      zoom: 13,
      disableDefaultUI: true,
      gestureHandling: interactive ? 'greedy' : 'none',
      clickableIcons: false,
    });

    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      const { interactive: ia, panOnClick: poc, onMapClick: omc } = cbRef.current;
      if (!ia) return;
      const ll = e.latLng;
      if (!ll) return;
      if (poc) { map.panTo(ll); return; }
      omc?.({ lat: ll.lat(), lng: ll.lng() });
    });
    map.addListener('dragstart', () => cbRef.current.onMoveStart?.());
    map.addListener('idle', () => {
      const c = map.getCenter();
      if (c) cbRef.current.onCenterChange?.({ lat: c.lat(), lng: c.lng() });
    });

    mapRef.current = map;
    const c = map.getCenter();
    if (c) cbRef.current.onCenterChange?.({ lat: c.lat(), lng: c.lng() });
    return () => { mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pickup marker (green circle)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pickupMarker) {
      pickupRef.current?.setMap(null);
      pickupRef.current = null;
      return;
    }
    const icon: google.maps.Symbol = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9, fillColor: '#16a34a', fillOpacity: 1,
      strokeColor: '#ffffff', strokeWeight: 3,
    };
    if (pickupRef.current) {
      pickupRef.current.setPosition(pickupMarker);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      pickupRef.current = new google.maps.Marker({ position: pickupMarker, map, icon });
    }
  }, [pickupMarker]);

  // Dropoff marker (red circle)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!dropoffMarker) {
      dropoffRef.current?.setMap(null);
      dropoffRef.current = null;
      return;
    }
    const icon: google.maps.Symbol = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9, fillColor: '#dc2626', fillOpacity: 1,
      strokeColor: '#ffffff', strokeWeight: 3,
    };
    if (dropoffRef.current) {
      dropoffRef.current.setPosition(dropoffMarker);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      dropoffRef.current = new google.maps.Marker({ position: dropoffMarker, map, icon });
    }
  }, [dropoffMarker]);

  // Driver marker (taxi emoji as SVG data URL)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!driverMarker) {
      driverRef.current?.setMap(null);
      driverRef.current = null;
      return;
    }
    const svgUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text y="26" font-size="26">🚕</text></svg>'
    )}`;
    const icon: google.maps.Icon = {
      url: svgUrl,
      scaledSize: new google.maps.Size(32, 32),
      anchor: new google.maps.Point(16, 16),
    };
    if (driverRef.current) {
      driverRef.current.setPosition(driverMarker);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      driverRef.current = new google.maps.Marker({ position: driverMarker, map, icon });
    }
  }, [driverMarker]);

  // Route polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    polylineRef.current?.setMap(null);
    polylineRef.current = null;
    if (!routePolyline) return;
    const path = decodePolyline(routePolyline).map(([lat, lng]) => ({ lat, lng }));
    polylineRef.current = new google.maps.Polyline({
      path, map,
      strokeColor: '#FFCC00', strokeWeight: 4, strokeOpacity: 0.8,
    });
    const bounds = new google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, 32);
  }, [routePolyline]);

  // Pan to updated center
  useEffect(() => {
    if (center && mapRef.current) {
      mapRef.current.panTo(center);
      mapRef.current.setZoom(14);
    }
  }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ height, width: '100%' }} />;
}

// ── Leaflet fallback component (original unchanged logic) ─────────
function LeafletMapPicker({
  center, pickupMarker, dropoffMarker, driverMarker, routePolyline,
  onMapClick, onMoveStart, onCenterChange,
  panOnClick = false, height = '55vh', interactive = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const pickupRef    = useRef<L.Marker | null>(null);
  const dropoffRef   = useRef<L.Marker | null>(null);
  const driverRef    = useRef<L.Marker | null>(null);
  const polylineRef  = useRef<L.Polyline | null>(null);
  const onMapClickRef     = useRef(onMapClick);
  const onMoveStartRef    = useRef(onMoveStart);
  const onCenterChangeRef = useRef(onCenterChange);
  const panOnClickRef     = useRef(panOnClick);
  const interactiveRef    = useRef(interactive);

  useEffect(() => {
    onMapClickRef.current     = onMapClick;
    onMoveStartRef.current    = onMoveStart;
    onCenterChangeRef.current = onCenterChange;
    panOnClickRef.current     = panOnClick;
    interactiveRef.current    = interactive;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [center?.lat ?? DEFAULT_CENTER.lat, center?.lng ?? DEFAULT_CENTER.lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });
    const cartoKey = import.meta.env.VITE_CARTO_API_KEY;
    const cartoUrl = cartoKey
      ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${cartoKey}`
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    L.tileLayer(cartoUrl, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    map.on('click', (e) => {
      if (!interactiveRef.current) return;
      if (panOnClickRef.current) { map.panTo(e.latlng, { animate: true }); return; }
      onMapClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    map.on('movestart', () => { onMoveStartRef.current?.(); });
    map.on('moveend', () => {
      const c = map.getCenter();
      onCenterChangeRef.current?.({ lat: c.lat, lng: c.lng });
    });
    mapRef.current = map;
    const c = map.getCenter();
    onCenterChangeRef.current?.({ lat: c.lat, lng: c.lng });
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (!pickupMarker) { pickupRef.current?.remove(); pickupRef.current = null; return; }
    if (pickupRef.current) { pickupRef.current.setLatLng([pickupMarker.lat, pickupMarker.lng]); }
    else { pickupRef.current = L.marker([pickupMarker.lat, pickupMarker.lng], { icon: pickupIcon }).addTo(map); }
  }, [pickupMarker]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (!dropoffMarker) { dropoffRef.current?.remove(); dropoffRef.current = null; return; }
    if (dropoffRef.current) { dropoffRef.current.setLatLng([dropoffMarker.lat, dropoffMarker.lng]); }
    else { dropoffRef.current = L.marker([dropoffMarker.lat, dropoffMarker.lng], { icon: dropoffIcon }).addTo(map); }
  }, [dropoffMarker]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (!driverMarker) { driverRef.current?.remove(); driverRef.current = null; return; }
    if (driverRef.current) { driverRef.current.setLatLng([driverMarker.lat, driverMarker.lng]); }
    else { driverRef.current = L.marker([driverMarker.lat, driverMarker.lng], { icon: driverIcon }).addTo(map); }
  }, [driverMarker]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
    if (routePolyline) {
      const coords = decodePolyline(routePolyline);
      polylineRef.current = L.polyline(coords, { color: '#FFCC00', weight: 4, opacity: 0.8 }).addTo(map);
      map.fitBounds(polylineRef.current.getBounds(), { padding: [32, 32] });
    }
  }, [routePolyline]);

  useEffect(() => {
    if (center && mapRef.current) {
      mapRef.current.flyTo([center.lat, center.lng], 14, { duration: 1 });
    }
  }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ height, width: '100%' }} />;
}

// ── Main export: selects provider based on key availability ────────
export default function MapPicker(props: Props) {
  const [provider, setProvider] = useState<'pending' | 'google' | 'leaflet'>('pending');

  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
    if (!key) { setProvider('leaflet'); return; }
    loadGoogleMaps(key, (ok) => setProvider(ok ? 'google' : 'leaflet'));
  }, []);

  if (provider === 'pending') {
    return <div style={{ height: props.height ?? '55vh', width: '100%', background: '#1e293b' }} />;
  }
  if (provider === 'google') return <GoogleMapPicker {...props} />;
  return <LeafletMapPicker {...props} />;
}
