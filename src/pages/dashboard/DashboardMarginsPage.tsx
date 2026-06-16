import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardPricingPage } from './DashboardPricingPage';
import { MlPricingRulesSection } from '../../components/dashboard/MlPricingRulesSection';
import { getPricingConfig } from '../../actions/pricing';
import { getMlPricingConfig } from '../../actions/ml-pricing';
import {
	salePrice,
	formatPrice,
	mlMarginFor,
	DEFAULT_PRICING,
	DEFAULT_ML_PRICING,
} from '../../helpers';

export const DashboardMarginsPage = () => {
	const [tab, setTab] = useState<'rf' | 'ml'>('rf');
	const [cost, setCost] = useState('100');

	const { data: rfCfg } = useQuery({ queryKey: ['pricing_config'], queryFn: getPricingConfig });
	const { data: mlCfg } = useQuery({ queryKey: ['ml_pricing_config'], queryFn: getMlPricingConfig });

	const c = Number(cost) || 0;
	const rf = salePrice(c, rfCfg ?? DEFAULT_PRICING);
	// Precio ML en USD (para comparar contra RF en la misma moneda), aunque el
	// listing real vaya en pesos: costo × (1 + margen) × (1 + IVA).
	const mlCfgEff = mlCfg ?? DEFAULT_ML_PRICING;
	const mlMarginPct = mlMarginFor(c, null, null, mlCfgEff);
	const mlUsd = c > 0 ? c * (1 + mlMarginPct / 100) * (1 + mlCfgEff.iva_percent / 100) : 0;

	const tabCls = (active: boolean) =>
		`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
			active ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'
		}`;

	return (
		<div className='space-y-6'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Márgenes</h1>
				<p className='text-sm text-ink-500'>
					Configurá los márgenes de la web (RF) y de Mercado Libre por separado. Cada canal tiene sus propias reglas.
				</p>
			</div>

			{/* Comparador: mismo costo CDR, márgenes distintos */}
			<div className='rounded-2xl border border-brand-200 bg-brand-50/40 p-4'>
				<h2 className='text-sm font-bold mb-2 text-ink-900'>Comparar por costo CDR</h2>
				<div className='flex flex-wrap items-end gap-5'>
					<label className='flex flex-col gap-1 text-xs text-ink-500'>
						Costo CDR (USD)
						<input
							type='number'
							value={cost}
							onChange={e => setCost(e.target.value)}
							className='w-32 rounded-lg border border-ink-200 px-3 py-2 text-sm'
						/>
					</label>
					<div className='text-sm text-ink-600'>
						Precio RF (web): <span className='text-lg font-bold text-emerald-700'>{formatPrice(rf)}</span>
					</div>
					<div className='text-sm text-ink-600'>
						Precio ML: <span className='text-lg font-bold text-blue-700'>{formatPrice(mlUsd)}</span>
					</div>
				</div>
				<p className='text-[11px] text-ink-400 mt-2'>
					Mismo costo, márgenes distintos en cada canal. Ambos en USD para comparar (en ML el listing puede ir en pesos al BCU). El de ML usa el tramo base (sin override de categoría).
				</p>
			</div>

			{/* Tabs */}
			<div className='flex gap-1 border-b border-ink-200'>
				<button onClick={() => setTab('rf')} className={tabCls(tab === 'rf')}>RF (web)</button>
				<button onClick={() => setTab('ml')} className={tabCls(tab === 'ml')}>Mercado Libre</button>
			</div>

			<div>
				{tab === 'rf' ? <DashboardPricingPage embedded /> : <MlPricingRulesSection />}
			</div>
		</div>
	);
};
