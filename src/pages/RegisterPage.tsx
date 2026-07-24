import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, Navigate } from 'react-router-dom';
import { useRegister, useUser } from '../hooks';
import { LuLoader2 } from 'react-icons/lu';
import { Loader } from '../components/shared/Loader';
import {
	UserRegisterFormValues,
	userRegisterSchema,
} from '../lib/validators';
import { trackCompleteRegistration } from '../lib/pixel';

export const RegisterPage = () => {
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<UserRegisterFormValues>({
		defaultValues: {
			fullName: '',
			email: '',
			password: '',
			phone: '',
		},
		resolver: zodResolver(userRegisterSchema),
	});

	const { mutate, isPending } = useRegister();
	const { session, isLoading } = useUser();

	const onRegister = handleSubmit(data => {
		const { email, password, fullName, phone } = data;

		mutate(
			{ email, password, fullName, phone },
			{
				// Meta Pixel: CompleteRegistration al crear la cuenta con éxito.
				onSuccess: () => trackCompleteRegistration(),
			}
		);
	});

	if (isLoading) return <Loader />;

	if (session) return <Navigate to='/' />;

	return (
		<div className='flex flex-col items-center h-full gap-5 mt-12'>
			<h1 className='text-4xl font-bold capitalize'>Regístrate</h1>

			<p className='text-sm font-medium'>
				Por favor, rellene los siguientes campos:
			</p>

			{isPending ? (
				<div className='flex justify-center w-full h-full mt-20'>
					<LuLoader2 className='animate-spin' size={60} />
				</div>
			) : (
				<>
					<form
						className='flex flex-col items-center gap-4 w-full mt-10 sm:w-[400px] lg:w-[500px]'
						onSubmit={onRegister}
					>
						<input
							type='text'
							placeholder='Nombre Completo'
							className='w-full px-5 py-4 text-sm text-black border rounded-full border-slate-200 placeholder:text-black'
							{...register('fullName')}
						/>
						{errors.fullName && (
							<p className='text-red-500'>
								{errors.fullName.message}
							</p>
						)}

						<input
							type='text'
							placeholder='Celular'
							className='w-full px-5 py-4 text-sm text-black border rounded-full border-slate-200 placeholder:text-black'
							{...register('phone')}
						/>
						{errors.phone && (
							<p className='text-red-500'>{errors.phone.message}</p>
						)}

						<input
							type='email'
							placeholder='Ingresa tu correo electrónico'
							className='w-full px-5 py-4 text-sm text-black border rounded-full border-slate-200 placeholder:text-black'
							{...register('email')}
						/>
						{errors.email && (
							<p className='text-red-500'>{errors.email.message}</p>
						)}

						<input
							type='password'
							placeholder='Ingresa tu contraseña'
							className='w-full px-5 py-4 text-sm text-black border rounded-full border-slate-200 placeholder:text-black'
							{...register('password')}
						/>
						{errors.password && (
							<p className='text-red-500'>
								{errors.password.message}
							</p>
						)}

						<button className='w-full py-4 mt-5 text-xs font-semibold tracking-widest text-white uppercase bg-black rounded-full'>
							Registrarme
						</button>
					</form>

					<p className='text-sm text-stone-800'>
						¿Ya tienes una cuenta?
						<Link to='/login' className='ml-2 underline'>
							Inicia sesión
						</Link>
					</p>
				</>
			)}
		</div>
	);
};
