import { useEffect, useRef } from 'react';
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
  height?: string;
  interactive?: boolean;
}

// Riga default center
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

export default function MapPicker({
  center,
  pickupMarker,
  dropoffMarker,
  driverMarker,
  routePolyline,
  onMapClick,
  height = '55vh',
  interactive = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pickupRef = useRef<L.Marker | null>(null);
  const dropoffRef = useRef<L.Marker | null>(null);
  const driverRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const onMapClickRef = useRef(onMapClick);
  const interactiveRef = useRef(interactive);

  // Keep latest props available to the (once-registered) click handler
  useEffect(() => {
    onMapClickRef.current = onMapClick;
    interactiveRef.current = interactive;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [center?.lat ?? DEFAULT_CENTER.lat, center?.lng ?? DEFAULT_CENTER.lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);
    map.on('click', (e) => {
      if (!interactiveRef.current) return;
      onMapClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update pickup marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pickupRef.current) { pickupRef.current.remove(); pickupRef.current = null; }
    if (pickupMarker) {
      pickupRef.current = L.marker([pickupMarker.lat, pickupMarker.lng], { icon: pickupIcon }).addTo(map);
    }
  }, [pickupMarker]);

  // Update dropoff marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (dropoffRef.current) { dropoffRef.current.remove(); dropoffRef.current = null; }
    if (dropoffMarker) {
      dropoffRef.current = L.marker([dropoffMarker.lat, dropoffMarker.lng], { icon: dropoffIcon }).addTo(map);
    }
  }, [dropoffMarker]);

  // Update driver marker — smooth move with setLatLng
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!driverMarker) {
      driverRef.current?.remove();
      driverRef.current = null;
      return;
    }
    if (driverRef.current) {
      driverRef.current.setLatLng([driverMarker.lat, driverMarker.lng]);
    } else {
      driverRef.current = L.marker([driverMarker.lat, driverMarker.lng], { icon: driverIcon }).addTo(map);
    }
  }, [driverMarker]);

  // Draw route polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
    if (routePolyline) {
      const coords = decodePolyline(routePolyline);
      polylineRef.current = L.polyline(coords, { color: '#FFCC00', weight: 4, opacity: 0.8 }).addTo(map);
      map.fitBounds(polylineRef.current.getBounds(), { padding: [32, 32] });
    }
  }, [routePolyline]);

  // Fly to center when it changes
  useEffect(() => {
    if (center && mapRef.current) {
      mapRef.current.flyTo([center.lat, center.lng], 14, { duration: 1 });
    }
  }, [center?.lat, center?.lng]);

  return <div ref={containerRef} style={{ height, width: '100%' }} />;
}
