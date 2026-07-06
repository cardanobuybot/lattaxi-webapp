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
  passenger_comment?: string;
}): Promise<{ ok: boolean; ride: Ride; share_url?: string; error?: string }> {
  return post('/rides/request', params);
}

export async function getRideStatus(rideId: number): Promise<{ ok: boolean } & RideStatus> {
  return get(`/rides/${rideId}/status`);
}

export async function getCancelPolicy(rideId: number): Promise<{
  ok: boolean; can_cancel: boolean; fee: number; reason: string; free_seconds_left?: number;
}> {
  return get(`/rides/cancel-policy?ride_id=${rideId}`);
}

export async function cancelRide(rideId: number, userId: number, acceptFee = false) {
  return post<{ ok: boolean; fee_charged?: number; error?: string }>(
    '/rides/cancel',
    { ride_id: rideId, user_id: userId, accept_fee: acceptFee }
  );
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
  license_number?: string;
}) {
  return post('/drivers/register', params);
}

export async function setDriverStatus(telegramId: number, status: 'online' | 'offline') {
  return post(`/drivers/${telegramId}/status`, { status });
}

export interface RideHistoryItem {
  id: number;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_price: string;
  final_price: string | null;
  created_at: string;
  passenger_rating: number | null;
  tip_amount: string;
  route_distance_meters: number | null;
  driver_name?: string;
  driver_car?: string;
  driver_car_number?: string;
  driver_rating?: number;
}

export async function getPassengerHistory(passengerUserId: number, offset = 0) {
  return get<{ ok: boolean; rides: RideHistoryItem[]; total: number }>(
    `/rides/history/passenger?passenger_user_id=${passengerUserId}&offset=${offset}`
  );
}

export async function getDriverEarnings(telegramId: number) {
  return get<{
    ok: boolean;
    today: string; week: string; month: string;
    rides_today: number; rides_week: number; tips_today: string;
  }>(`/drivers/earnings?telegram_id=${telegramId}`);
}

export async function getDriverHistory(telegramId: number, offset = 0) {
  return get<{ ok: boolean; rides: RideHistoryItem[]; total: number }>(
    `/rides/history/driver?telegram_id=${telegramId}&offset=${offset}`
  );
}

export async function reportNoShow(rideId: number, driverTelegramId: number) {
  return post<{ ok: boolean; fee_charged?: number; driver_payout?: number; error?: string; seconds_left?: number }>(
    `/rides/${rideId}/no-show`,
    { driver_telegram_id: driverTelegramId }
  );
}

export async function getWaitFeeStatus(rideId: number): Promise<{ wait_minutes: number; wait_fee: number; free_minutes_left: number }> {
  return get(`/rides/${rideId}/wait-status`);
}
