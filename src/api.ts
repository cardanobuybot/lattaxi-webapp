const API = import.meta.env.VITE_API_URL ?? 'https://api.lattaxi.lv';

export type Category = 'economy' | 'comfort' | 'xl';

export interface QuoteResult {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  prices: Record<Category, number>;
}

export interface Ride {
  id: number;
  status: string;
  category: Category;
  pickup_address: string;
  dropoff_address: string;
  estimated_price: string;
  scheduled_at: string | null;
  share_token: string | null;
  driver_id: number | null;
  passenger_rating: number | null;
  tip_amount: string;
  route_distance_meters: number | null;
  route_duration_seconds: number | null;
}

export interface RideStatus {
  status: string;
  driver_location: { lat: number; lng: number } | null;
  driver_eta_minutes: number | null;
  driver?: {
    name: string;
    car: string;
    car_number: string;
    rating: number;
    category: string;
  };
}

export interface User {
  id: number;
  telegram_id: string;
  role: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  return res.json();
}

export async function registerUser(telegramId: number, name: string) {
  return post<{ ok: boolean; user: User }>('/users/register', {
    telegram_id: telegramId,
    name,
    phone: null,
  });
}

export async function getQuote(
  pickup: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<{ ok: boolean; quote: QuoteResult }> {
  return post('/routes/quote', { pickup, destination });
}

export async function requestRide(params: {
  passenger_user_id: number;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  category: Category;
  estimated_price?: number;
  route_distance_meters?: number;
  route_duration_seconds?: number;
  route_polyline?: string;
  scheduled_at?: string;
}): Promise<{ ok: boolean; ride: Ride; share_url?: string; error?: string }> {
  return post('/rides/request', params);
}

export async function getRideStatus(rideId: number): Promise<{ ok: boolean } & RideStatus> {
  return get(`/rides/${rideId}/status`);
}

export async function cancelRide(rideId: number, userId: number) {
  return post('/rides/cancel', { ride_id: rideId, user_id: userId });
}

export async function rateRide(params: {
  ride_id: number;
  passenger_user_id: number;
  rating: number;
  tip_amount?: number;
}) {
  return post('/rides/rate', params);
}

export async function registerDriver(params: {
  telegram_id: number;
  name: string;
  car: string;
  car_number: string;
  category?: Category;
}) {
  return post('/drivers/register', params);
}

export async function setDriverStatus(telegramId: number, status: 'online' | 'offline') {
  return post(`/drivers/${telegramId}/status`, { status });
}
