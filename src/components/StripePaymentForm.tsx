import { useState, useEffect } from 'react';
import { loadStripe, type Stripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

interface FormProps {
  amountCents: number;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

function PayForm({ amountCents, onSuccess, onError }: FormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handlePay() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setLocalError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    setSubmitting(false);
    if (error) {
      const msg = error.message ?? 'Maksājums neizdevās.';
      setLocalError(msg);
      onError(msg);
    } else {
      onSuccess();
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
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  onSuccess: () => void;
  onError: (msg: string) => void;
  onRetry: () => void;
  payError: string | null;
}

export default function StripePaymentForm({ clientSecret, publishableKey, amountCents, onSuccess, onError, onRetry, payError }: Props) {
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
      <PayForm amountCents={amountCents} onSuccess={onSuccess} onError={onError} />
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
