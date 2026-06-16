import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getMlPricingConfig, updateMlPricingConfig } from '../../actions/ml-pricing';
import { repriceActiveMl } from '../../actions/ml';
import { useTaxonomiesAdmin } from '../../hooks';
import { DEFAULT_ML_PRICING, formatPriceCurrency, mlPriceFromConfig, type MlPricingConfig } from '../../helpers';

// Reglas de precio para Mercado Libre: tramos por costo + override por
// categoria/subcategoria. Precedencia: subcategoria > categoria > tramo.
// El IVA y la regla USD/UYU (umbral) se mantienen para todos los casos.
export const MlPricingRulesSection = () => {
	const queryClient = useQueryClient();
	const { categories, subcategories } = useTaxonomiesAdmin();
	const { data, isLoading } = useQuery({ queryKey: ['ml_pricing_config'], queryFn: getMlPricingConfig });
	const [cfg, setCfg] = useState<MlPricingConfig>(DEFAULT_ML_PRICING);
	const [previewCost, setPreviewCost] = useState('100');
	const [previewCat, setPreviewCat] = useState('');
	const [previewSub, setPreviewSub] = useState('');
	const [newCat, setNewCat] = useState('');
	const [newSub, setNewSub] = useState('');

	useEffect(() => { if (data) setCfg(data); }, [data]);

	const { mutate: save, isPending } = useMutation({
		mutationFn: () => updateMlPricingConfig(cfg),
		onSuccess: () => {
			toast.success('Margenes ML guardados');
			queryClient.invalidateQueries({ queryKey: ['ml_pricing_config'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	// Guarda las reglas y repreciar TODAS las publicaciones activas (encola a la cola
	// que empuja a ML ~20/min). Es el unico modo de aplicar reglas a lo ya publicado.
	const { mutate: saveAndReprice, isPending: repricing } = useMutation({
		mutationFn: async () => {
			await updateMlPricingConfig(cfg);
			return repriceActiveMl(false);
		},
		onSuccess: (r) => {
			queryClient.invalidateQueries({ queryKey: ['ml_pricing_config'] });
			if (r.ok) toast.success(`Reglas guardadas. Encolados ${r.enqueued ?? 0} de ${r.active ?? 0} activos para repreciar en ML.`);
			else toast.error(`Repreciado fallo: ${r.error ?? 'desconocido'}`);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const catName = (id: string) => categories.find(c => c.id === id)?.name ?? id;
	const subLabel = (id: string) => {
		const s = subcategories.find(x => x.id === id);
		if (!s) return id;
		return `${categories.find(c => c.id === s.category_id)?.name ?? '-'} > ${s.name}`;
	};

	const setTier = (i: number, field: 'max' | 'pct', v: string) =>
		setCfg(c => ({
			...c,
			tiers: c.tiers.map((t, idx) =>
				idx === i ? { ...t, [field]: v === '' ? (field === 'max' ? null : 0) : Number(v) } : t
			),
		}));
	const addTier = () =>
		setCfg(c => {
			const tiers = [...c.tiers];
			const lastMax = tiers.length >= 2 ? tiers[tiers.length - 2].max ?? 0 : 0;
			tiers.splice(tiers.length - 1, 0, { max: Number(lastMax) + 50, pct: 30 });
			return { ...c, tiers };
		});
	const removeTier = (i: number) =>
		setCfg(c => ({ ...c, tiers: c.tiers.filter((_, idx) => idx !== i) }));
	const rangeLabel = (i: number) => {
		const prev = i === 0 ? 0 : cfg.tiers[i - 1].max ?? 0;
		const max = cfg.tiers[i].max;
		if (max === null) return `Desde USD ${prev} en adelante`;
		return `USD ${prev} a ${max - 0.01}`;
	};

	const setOverride = (kind: 'category' | 'subcategory', id: string, pct: number) =>
		setCfg(c => {
			const key = kind === 'category' ? 'category_overrides' : 'subcategory_overrides';
			return { ...c, [key]: { ...c[key], [id]: pct } };
		});
	const removeOverride = (kind: 'category' | 'subcategory', id: string) =>
		setCfg(c => {
			const key = kind === 'category' ? 'category_overrides' : 'subcategory_overrides';
			const next = { ...c[key] };
			delete next[id];
			return { ...c, [key]: next };
		});

	const previewResult = mlPriceFromConfig(Number(previewCost) || 0, 40, previewCat || null, previewSub || null, cfg);

	if (isLoading) {
		return (
			<section className='p-5 bg-white border border-gray-200 rounded-lg'>
				<p className='text-sm text-gray-500'>Cargando margenes ML...</p>
			</section>
		);
	}

	const catOverrideIds = Object.keys(cfg.category_overrides ?? {});
	const subOverrideIds = Object.keys(cfg.subcategory_overrides ?? {});

	return (
		<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-5'>
			<div>
				<h2 className='font-semibold'>Margenes de Mercado Libre</h2>
				<p className='text-xs text-gray-500 mt-1'>
					Reglas propias de ML (separadas de la web). Precio ML = costo x (1 + margen/100) x (1 + IVA/100).
					Si el costo supera el umbral USD, el precio va en USD; sino en pesos al BCU. Precedencia del margen:
					<b> subcategoria &rarr; categoria &rarr; tramo por costo</b>.
				</p>
			</div>

			<div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
				<div>
					<label className='block text-sm font-medium mb-1'>IVA (%)</label>
					<input
						type='number'
						className='border rounded px-3 py-2 w-full'
						value={cfg.iva_percent}
						onChange={e => setCfg(c => ({ ...c, iva_percent: Number(e.target.value) || 0 }))}
					/>
				</div>
				<div>
					<label className='block text-sm font-medium mb-1'>Umbral USD (precio en USD por encima)</label>
					<input
						type='number'
						className='border rounded px-3 py-2 w-full'
						value={cfg.usd_threshold}
						onChange={e => setCfg(c => ({ ...c, usd_threshold: Number(e.target.value) || 0 }))}
					/>
				</div>
			</div>

			<div>
				<div className='flex items-center justify-between mb-2'>
					<h3 className='text-sm font-semibold'>Margenes por tramo de costo</h3>
					<button onClick={addTier} className='text-xs font-semibold text-brand-700 hover:text-brand-900'>+ Agregar tramo</button>
				</div>
				<div className='space-y-2'>
					{cfg.tiers.map((tier, i) => (
						<div key={i} className='flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3'>
							<span className='min-w-[180px] text-sm font-medium text-gray-700'>{rangeLabel(i)}</span>
							{tier.max !== null && (
								<label className='flex items-center gap-1.5 text-xs text-gray-500'>
									Hasta USD
									<input type='number' value={tier.max} onChange={e => setTier(i, 'max', e.target.value)} className='w-24 rounded border border-gray-200 px-2 py-1.5 text-sm' />
								</label>
							)}
							<label className='ml-auto flex items-center gap-1.5 text-xs text-gray-500'>
								Margen
								<input type='number' value={tier.pct} onChange={e => setTier(i, 'pct', e.target.value)} className='w-20 rounded border border-gray-200 px-2 py-1.5 text-sm font-semibold' />
								%
							</label>
							{tier.max !== null && (
								<button onClick={() => removeTier(i)} className='text-xs text-rose-600 hover:text-rose-800'>Quitar</button>
							)}
						</div>
					))}
				</div>
			</div>

			<div>
				<h3 className='text-sm font-semibold mb-2'>Override por categoria</h3>
				<div className='flex flex-wrap items-center gap-2 mb-2'>
					<select value={newCat} onChange={e => setNewCat(e.target.value)} className='border rounded px-2 py-1.5 text-sm'>
						<option value=''>Elegi una categoria...</option>
						{categories.filter(c => !catOverrideIds.includes(c.id)).map(c => (
							<option key={c.id} value={c.id}>{c.name}</option>
						))}
					</select>
					<button
						onClick={() => { if (newCat) { setOverride('category', newCat, 30); setNewCat(''); } }}
						disabled={!newCat}
						className='px-3 py-1.5 text-xs font-semibold bg-stone-800 text-white rounded disabled:opacity-50'
					>Agregar</button>
				</div>
				{catOverrideIds.length === 0 ? (
					<p className='text-xs text-gray-400'>Sin overrides de categoria.</p>
				) : (
					<div className='space-y-2'>
						{catOverrideIds.map(id => (
							<div key={id} className='flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5'>
								<span className='text-sm text-gray-700 flex-1'>{catName(id)}</span>
								<label className='flex items-center gap-1.5 text-xs text-gray-500'>
									Margen
									<input type='number' value={cfg.category_overrides[id]} onChange={e => setOverride('category', id, Number(e.target.value) || 0)} className='w-20 rounded border border-gray-200 px-2 py-1.5 text-sm font-semibold' />
									%
								</label>
								<button onClick={() => removeOverride('category', id)} className='text-xs text-rose-600 hover:text-rose-800'>Quitar</button>
							</div>
						))}
					</div>
				)}
			</div>

			<div>
				<h3 className='text-sm font-semibold mb-2'>Override por subcategoria</h3>
				<div className='flex flex-wrap items-center gap-2 mb-2'>
					<select value={newSub} onChange={e => setNewSub(e.target.value)} className='border rounded px-2 py-1.5 text-sm max-w-xs'>
						<option value=''>Elegi una subcategoria...</option>
						{subcategories.filter(s => !subOverrideIds.includes(s.id)).map(s => (
							<option key={s.id} value={s.id}>{subLabel(s.id)}</option>
						))}
					</select>
					<button
						onClick={() => { if (newSub) { setOverride('subcategory', newSub, 30); setNewSub(''); } }}
						disabled={!newSub}
						className='px-3 py-1.5 text-xs font-semibold bg-stone-800 text-white rounded disabled:opacity-50'
					>Agregar</button>
				</div>
				{subOverrideIds.length === 0 ? (
					<p className='text-xs text-gray-400'>Sin overrides de subcategoria.</p>
				) : (
					<div className='space-y-2'>
						{subOverrideIds.map(id => (
							<div key={id} className='flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5'>
								<span className='text-sm text-gray-700 flex-1'>{subLabel(id)}</span>
								<label className='flex items-center gap-1.5 text-xs text-gray-500'>
									Margen
									<input type='number' value={cfg.subcategory_overrides[id]} onChange={e => setOverride('subcategory', id, Number(e.target.value) || 0)} className='w-20 rounded border border-gray-200 px-2 py-1.5 text-sm font-semibold' />
									%
								</label>
								<button onClick={() => removeOverride('subcategory', id)} className='text-xs text-rose-600 hover:text-rose-800'>Quitar</button>
							</div>
						))}
					</div>
				)}
			</div>

			<div className='rounded-lg border border-blue-200 bg-blue-50/50 p-4'>
				<h3 className='text-sm font-semibold mb-2'>Vista previa</h3>
				<div className='flex flex-wrap items-end gap-3'>
					<label className='flex flex-col gap-1 text-xs text-gray-500'>
						Costo USD
						<input type='number' value={previewCost} onChange={e => setPreviewCost(e.target.value)} className='w-28 rounded border border-gray-200 px-2 py-1.5 text-sm' />
					</label>
					<label className='flex flex-col gap-1 text-xs text-gray-500'>
						Categoria
						<select value={previewCat} onChange={e => { setPreviewCat(e.target.value); setPreviewSub(''); }} className='rounded border border-gray-200 px-2 py-1.5 text-sm'>
							<option value=''>(ninguna)</option>
							{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
						</select>
					</label>
					<label className='flex flex-col gap-1 text-xs text-gray-500'>
						Subcategoria
						<select value={previewSub} onChange={e => setPreviewSub(e.target.value)} className='rounded border border-gray-200 px-2 py-1.5 text-sm max-w-[220px]'>
							<option value=''>(ninguna)</option>
							{subcategories.filter(s => !previewCat || s.category_id === previewCat).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
						</select>
					</label>
					<div className='text-sm text-gray-700'>
						Precio ML: <span className='text-lg font-bold text-gray-900'>{formatPriceCurrency(previewResult.price, previewResult.currency)}</span>
						<span className='text-xs text-gray-500'> ({previewResult.currency === 'UYU' ? 'pesos al BCU ~40' : 'USD'})</span>
					</div>
				</div>
			</div>

			<div className='flex flex-wrap items-center gap-3 pt-1'>
				<button onClick={() => save()} disabled={isPending || repricing} className='px-4 py-2 bg-stone-800 text-white rounded-md text-sm disabled:opacity-50'>
					{isPending ? 'Guardando...' : 'Guardar margenes ML'}
				</button>
				<button
					onClick={() => {
						if (confirm('Esto guarda las reglas y RECALCULA el precio de TODAS las publicaciones activas en ML. Los nuevos precios se empujan a ML de a poco (~20/min). Confirmas?')) {
							saveAndReprice();
						}
					}}
					disabled={isPending || repricing}
					className='px-4 py-2 border border-stone-800 text-stone-800 rounded-md text-sm disabled:opacity-50'
				>
					{repricing ? 'Encolando...' : 'Guardar y repreciar publicaciones activas'}
				</button>
			</div>
			<p className='text-xs text-gray-400'>
				El repreciado aplica las reglas a lo YA publicado. Las publicaciones nuevas usan las reglas vigentes al publicar.
			</p>
		</section>
	);
};
