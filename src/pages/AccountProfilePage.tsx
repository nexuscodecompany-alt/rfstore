import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useUser } from '../hooks';
import { supabase } from '../supabase/client';
import { ImSpinner2 } from 'react-icons/im';
import { HiOutlineUser, HiOutlineMail, HiOutlinePhone } from 'react-icons/hi';

interface ProfileForm {
	full_name: string;
	email: string;
	phone: string;
}

export const AccountProfilePage = () => {
	const { session } = useUser();
	const userId = session?.user.id;

	const [form, setForm] = useState<ProfileForm>({
		full_name: '',
		email: '',
		phone: '',
	});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!userId) return;
		(async () => {
			setLoading(true);
			try {
				const { data, error } = await supabase
					.from('customers')
					.select('full_name, email, phone')
					.eq('user_id', userId)
					.maybeSingle();
				if (error) throw new Error(error.message);
				if (data) {
					setForm({
						full_name: data.full_name ?? '',
						email: data.email ?? session?.user.email ?? '',
						phone: data.phone ?? '',
					});
				} else if (session?.user.email) {
					setForm(f => ({ ...f, email: session.user.email ?? '' }));
				}
			} catch (e) {
				toast.error((e as Error).message);
			} finally {
				setLoading(false);
			}
		})();
	}, [userId, session?.user.email]);

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!userId) return;
		if (!form.full_name.trim()) {
			toast.error('Ingresá tu nombre completo');
			return;
		}
		if (!form.email.trim() || !/^.+@.+\..+$/.test(form.email)) {
			toast.error('Ingresá un email válido');
			return;
		}
		setSaving(true);
		try {
			const { error } = await supabase
				.from('customers')
				.update({
					full_name: form.full_name.trim(),
					email: form.email.trim(),
					phone: form.phone.trim(),
				})
				.eq('user_id', userId);
			if (error) throw new Error(error.message);
			toast.success('Datos guardados');
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className='flex items-center justify-center py-16'>
				<ImSpinner2 className='w-8 h-8 animate-spin text-brand-600' />
			</div>
		);
	}

	return (
		<div className='max-w-xl mx-auto'>
			<header className='mb-6'>
				<h1 className='text-2xl font-bold text-ink-900'>Mi perfil</h1>
				<p className='text-sm text-ink-500 mt-1'>
					Estos datos se usan automáticamente en cada checkout. Si los
					actualizás acá, quedan guardados para tus próximas compras.
				</p>
			</header>

			<form
				onSubmit={onSubmit}
				className='bg-white border border-ink-200 rounded-xl shadow-soft p-6 space-y-5'
			>
				<div className='space-y-1.5'>
					<label className='text-xs font-semibold text-ink-700 flex items-center gap-1.5'>
						<HiOutlineUser size={14} /> Nombre completo
					</label>
					<input
						type='text'
						className='input-base w-full'
						value={form.full_name}
						onChange={e => setForm({ ...form, full_name: e.target.value })}
						required
						minLength={2}
					/>
				</div>

				<div className='space-y-1.5'>
					<label className='text-xs font-semibold text-ink-700 flex items-center gap-1.5'>
						<HiOutlineMail size={14} /> Correo electrónico
					</label>
					<input
						type='email'
						className='input-base w-full'
						value={form.email}
						onChange={e => setForm({ ...form, email: e.target.value })}
						required
					/>
					<p className='text-[11px] text-ink-400'>
						Cambiar este email solo afecta tu perfil. El email de inicio de
						sesión sigue siendo {session?.user.email ?? 'el que usaste para registrarte'}.
					</p>
				</div>

				<div className='space-y-1.5'>
					<label className='text-xs font-semibold text-ink-700 flex items-center gap-1.5'>
						<HiOutlinePhone size={14} /> Teléfono
					</label>
					<input
						type='tel'
						inputMode='tel'
						className='input-base w-full'
						placeholder='094 116 299'
						value={form.phone}
						onChange={e => setForm({ ...form, phone: e.target.value })}
					/>
				</div>

				<div className='pt-2 border-t border-ink-100'>
					<button
						type='submit'
						className='bg-black text-white py-3 px-6 rounded-md font-semibold text-sm disabled:opacity-60'
						disabled={saving}
					>
						{saving ? 'Guardando…' : 'Guardar cambios'}
					</button>
				</div>
			</form>
		</div>
	);
};
