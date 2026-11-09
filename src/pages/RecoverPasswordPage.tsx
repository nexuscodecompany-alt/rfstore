import { useState } from 'react';
import { LuLoader2 } from 'react-icons/lu';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { requestPasswordResetCode, resetPasswordWithCode } from '../actions';
import { safeNextPath } from '../helpers';
import { supabase } from '../supabase/client';

/**
 * Recuperar contraseña: 1) el mail -> llega un código de 6 dígitos;
 * 2) código + contraseña nueva -> se cambia y entra directo.
 * Todo lo valida el servidor (edge function password-reset).
 */
export const RecoverPasswordPage = () => {
	const [params] = useSearchParams();
	const next = safeNextPath(params.get('next'));
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const [step, setStep] = useState<'email' | 'code'>('email');
	const [email, setEmail] = useState(params.get('email') ?? '');
	const [code, setCode] = useState('');
	const [password, setPassword] = useState('');
	const [password2, setPassword2] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const inputCls =
		'w-full px-5 py-4 text-sm text-black border rounded-full border-slate-200 placeholder:text-stone-500';

	const sendCode = async (e?: React.FormEvent) => {
		e?.preventDefault();
		setError(null);
		if (!email.trim()) return setError('Ingresá tu mail');
		setBusy(true);
		try {
			await requestPasswordResetCode(email.trim());
			setStep('code');
			toast.success('Si el mail está registrado, te llega un código en unos segundos.');
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const reset = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		if (code.replace(/\D/g, '').length !== 6) return setError('El código tiene 6 dígitos');
		if (password.length < 8) return setError('La contraseña tiene que tener al menos 8 caracteres');
		if (password !== password2) return setError('Las contraseñas no coinciden');
		setBusy(true);
		try {
			await resetPasswordWithCode(email.trim(), code.replace(/\D/g, ''), password);
			// Entra directo con la contraseña nueva.
			const { error: loginErr } = await supabase.auth.signInWithPassword({
				email: email.trim(),
				password,
			});
			toast.success('¡Listo! Cambiaste tu contraseña.');
			if (loginErr) {
				navigate(`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
				return;
			}
			queryClient.invalidateQueries({ queryKey: ['user'] });
			navigate(next);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='flex flex-col items-center h-full gap-5 mt-12 px-4'>
			<h1 className='text-4xl font-bold text-center'>Recuperar contraseña</h1>

			{step === 'email' ? (
				<>
					<p className='text-sm font-medium text-center max-w-md'>
						Ingresá el mail de tu cuenta y te mandamos un código para crear una
						contraseña nueva.
					</p>
					<form
						className='flex flex-col items-center gap-4 w-full mt-6 sm:w-[400px] lg:w-[500px]'
						onSubmit={sendCode}
					>
						<input
							type='email'
							autoComplete='email'
							placeholder='Tu correo electrónico'
							className={inputCls}
							value={email}
							onChange={e => setEmail(e.target.value)}
						/>
						{error && <p className='text-sm text-red-600 text-center'>{error}</p>}
						<button
							disabled={busy}
							className='flex justify-center w-full py-4 mt-2 text-xs font-semibold tracking-widest text-white uppercase bg-black rounded-full disabled:opacity-70'
						>
							{busy ? <LuLoader2 className='animate-spin' size={18} /> : 'Enviarme el código'}
						</button>
					</form>
				</>
			) : (
				<>
					<p className='text-sm font-medium text-center max-w-md'>
						Si <b>{email.trim()}</b> tiene una cuenta, le mandamos un código de 6
						dígitos (vence en 15 minutos). Revisá también la carpeta de spam.
					</p>
					<form
						className='flex flex-col items-center gap-4 w-full mt-6 sm:w-[400px] lg:w-[500px]'
						onSubmit={reset}
					>
						<input
							inputMode='numeric'
							autoComplete='one-time-code'
							placeholder='Código de 6 dígitos'
							maxLength={7}
							className={`${inputCls} text-center tracking-[0.4em] font-mono text-lg`}
							value={code}
							onChange={e => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
						/>
						<input
							type='password'
							autoComplete='new-password'
							placeholder='Contraseña nueva (mínimo 8 caracteres)'
							className={inputCls}
							value={password}
							onChange={e => setPassword(e.target.value)}
						/>
						<input
							type='password'
							autoComplete='new-password'
							placeholder='Repetí la contraseña nueva'
							className={inputCls}
							value={password2}
							onChange={e => setPassword2(e.target.value)}
						/>
						{error && <p className='text-sm text-red-600 text-center'>{error}</p>}
						<button
							disabled={busy}
							className='flex justify-center w-full py-4 mt-2 text-xs font-semibold tracking-widest text-white uppercase bg-black rounded-full disabled:opacity-70'
						>
							{busy ? <LuLoader2 className='animate-spin' size={18} /> : 'Cambiar contraseña'}
						</button>
					</form>
					<div className='flex gap-4 text-sm text-stone-700'>
						<button type='button' className='underline' disabled={busy} onClick={() => sendCode()}>
							Reenviar código
						</button>
						<button
							type='button'
							className='underline'
							onClick={() => {
								setStep('email');
								setCode('');
								setError(null);
							}}
						>
							Cambiar mail
						</button>
					</div>
				</>
			)}

			<Link
				to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`}
				className='text-sm text-stone-800 underline'
			>
				Volver a iniciar sesión
			</Link>
		</div>
	);
};
