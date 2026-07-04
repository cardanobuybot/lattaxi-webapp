import type { Category } from '../api';

const META: Record<Category, { icon: string; label: string; desc: string; seats: number }> = {
  economy: { icon: '🚗', label: 'Economy', desc: 'Standarta brauciens', seats: 3 },
  comfort: { icon: '🚙', label: 'Comfort', desc: 'Lielāka auto klase', seats: 4 },
  xl:      { icon: '🚐', label: 'XL', desc: 'Minivens, līdz 6 cilvēkiem', seats: 6 },
};

interface Props {
  category: Category;
  price: number;
  durationMin: number;
  selected: boolean;
  onSelect: () => void;
}

export default function CategoryCard({ category, price, durationMin, selected, onSelect }: Props) {
  const m = META[category];
  return (
    <button
      onClick={onSelect}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border transition-all ${
        selected
          ? 'border-brand bg-yellow-400/10 text-white'
          : 'border-slate-700 bg-slate-800 text-slate-300 active:bg-slate-700'
      }`}
    >
      <span className="text-2xl">{m.icon}</span>
      <div className="flex-1 text-left">
        <div className="font-semibold text-sm">{m.label}</div>
        <div className="text-xs text-slate-400">{m.desc} · {m.seats} sēdvietas</div>
      </div>
      <div className="text-right">
        <div className="font-bold text-sm">€{price.toFixed(2)}</div>
        <div className="text-xs text-slate-400">{durationMin} min</div>
      </div>
    </button>
  );
}
