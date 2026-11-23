import { useState, useEffect, useRef } from 'react';
import { loadStripe, type Stripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { postPaymentClientLog } from '../api';

interface FormProps {
  rideId: number | null;
  amountCents: number;
  onBeforeConfirm: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

const CONFIRM_TIMEOUT_MS = 30_000;

function PayForm({ rideId, amountCents, onBeforeConfirm, onSuccess, onError }: FormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const activeRideRef = useRef<number | null>(rideId);
  activeRideRef.current = rideId;

  async function reportLog(payload: Parameters<typeof postPaymentClientLog>[1]) {
    const rid = activeRideRef.current;
    if (!rid) return;
    await postPaymentClientLog(rid, payload);
  }

  async function handlePay() {
    if (!stripe || !elements) {
      await reportLog({ stage: 'guard', error_type: 'sdk_not_ready' });
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    onBeforeConfirm();

    let stage: string = 'before_submit';
    try {
      stage = 'before_submit';
      const submitResult = await elements.submit();
      if (submitResult && submitResult.error) {
        const msg = submitResult.error.message ?? 'Pārbaudiet maksājuma datus.';
        await reportLog({
          stage,
          error_type: submitResult.error.type ?? null,
          error_code: submitResult.error.code ?? null,
        });
        setSubmitting(false);
        setLocalError(msg);
        onError(msg);
        return;
      }
      stage = 'before_confirm';
      const confirmPromise = stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      const timeoutPromise = new Promise<{ error: { type: string; message: string; code?: string } }>((resolve) => {
        setTimeout(() => {
          resolve({ error: { type: 'client_timeout', message: 'Maksājums neatbildēja 30 sekunžu laikā. Mēģiniet vēlreiz.' } });
        }, CONFIRM_TIMEOUT_MS);
      });
      const raceResult = (await Promise.race([confirmPromise, timeoutPromise])) as {
        error?: { type?: string | null; message?: string | null; code?: string | null; decline_code?: string | null };
        paymentIntent?: { status?: string | null } | null;
      };
      stage = 'after_confirm';
      if (raceResult && raceResult.error) {
        const err = raceResult.error;
        const msg = err.message ?? 'Maksājums neizdevās.';
        await reportLog({
          stage: err.type === 'client_timeout' ? 'client_timeout' : stage,
          error_type: err.type ?? null,
          error_code: err.code ?? null,
          decline_code: err.decline_code ?? null,
          pi_status: raceResult.paymentIntent?.status ?? null,
        });
        setSubmitting(false);
        setLocalError(msg);
        onError(msg);
        return;
      }
      await reportLog({
        stage: 'after_confirm',
        pi_status: raceResult.paymentIntent?.status ?? null,
      });
      setSubmitting(false);
      onSuccess();
    } catch (thrown: unknown) {
      const message = thrown instanceof Error ? thrown.message : 'Maksājums neizdevās.';
      await reportLog({
        stage,
        error_type: 'unhandled_exception',
        error_code: null,
      });
      setSubmitting(false);
      setLocalError(message);
      onError(message);
    }
  }

  const amountEur = (amountCents / 100).toFixed(2);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pb-4 space-y-4">
        <PaymentElement
          options={{
            layout: 'tabs',
            wallets: { applePay: 'never', googlePay: 'never' },
            fields: { billingDetails: { address: { country: 'never', postalCode: 'never' } } },
          }}
        />
        {localError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3">
            <p className="text-red-300 text-xs leading-relaxed">{localError}</p>
          </div>
        )}
      </div>
      <div className="sticky bottom-0 bg-[#1a1d27] pt-3 pb-1 -mx-4 px-4 border-t border-[#ffffff08]">
        <button
          onClick={handlePay}
          disabled={submitting || !stripe}
          className="w-full bg-[#FFCC00] active:brightness-90 disabled:opacity-50 text-[#0f1117] font-bold py-4 rounded-2xl text-base shadow-lg shadow-yellow-500/20"
        >
          {submitting ? 'Apstrādā...' : `Apstiprināt €${amountEur} depozītu`}
        </button>
      </div>
    </div>
  );
}

interface Props {
  rideId: number | null;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  onBeforeConfirm: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
  onRetry: () => void;
  payError: string | null;
}

export default function StripePaymentForm({ rideId, clientSecret, publishableKey, amountCents, onBeforeConfirm, onSuccess, onError, onRetry, payError }: Props) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    setStripePromise(loadStripe(publishableKey));
  }, [publishableKey]);

  if (!stripePromise) {
    return <div className="flex justify-center py-6"><div className="w-8 h-8 border-2 border-[#FFCC00] border-t-transparent rounded-full animate-spin" /></div>;
  }

  const options: StripeElementsOptions = {
    clientSecret,
    locale: 'lv',
    appearance: {
      theme: 'night',
      variables: { colorPrimary: '#FFCC00', colorBackground: '#252836', borderRadius: '12px' },
    },
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <PayForm
        rideId={rideId}
        amountCents={amountCents}
        onBeforeConfirm={onBeforeConfirm}
        onSuccess={onSuccess}
        onError={onError}
      />
      {payError && (
        <button
          onClick={onRetry}
          className="w-full mt-2 bg-[#252836] active:bg-[#2f3347] text-[#FFCC00] font-semibold py-3.5 rounded-2xl text-sm"
        >
          Mēģināt vēlreiz
        </button>
      )}
    </Elements>
  );
}
