import { useForm, ValidationError } from '@formspree/react';
import { Link } from 'react-router-dom';
import {
	FaWhatsapp,
	FaEnvelope,
	FaPhoneAlt,
	FaMapMarkerAlt,
	FaRegCommentDots,
	FaRegBuilding,
	FaRegUser,
} from 'react-icons/fa';
import { HiOutlineCheckCircle, HiOutlineSparkles } from 'react-icons/hi2';
import { useUser } from '../hooks';
import { useEffect, useState } from 'react';

export const AboutPage = () => {
	const [state, handleSubmit] = useForm('mvgqddop');
	const { session } = useUser();
	const [userEmail, setUserEmail] = useState('');

	useEffect(() => {
		if (session?.user?.email) {
			setUserEmail(session.user.email);
		}
	}, [session?.user?.email]);

	if (state.succeeded) {
		return (
			<div className='max-w-2xl mx-auto px-4 py-24 text-center'>
				<div className='inline-grid place-items-center w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white mb-6 shadow-glow-brand'>
					<HiOutlineCheckCircle size={36} />
				</div>
				<h2 className='text-3xl font-bold text-ink-900 mb-3'>
					¡Mensaje enviado!
				</h2>
				<p className='text-ink-500 mb-8'>
					Gracias por escribirnos. Nuestro equipo te responderá a la brevedad.
				</p>
				<Link to='/' className='btn-primary'>
					Volver al inicio
				</Link>
			</div>
		);
	}

	return (
		<div className='-mt-8'>
			{/* HERO DARK */}
			<section className='relative section-dark py-20 bleed-full'>
				<div
					aria-hidden
					className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]'
				/>
				<div
					aria-hidden
					className='absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-brand-600/25 blur-3xl rounded-full'
				/>
				<div className='relative z-10 container text-center'>
					<span className='chip-dark mb-5'>
						<HiOutlineSparkles className='text-brand-400' />
						Estamos para ayudarte
					</span>
					<h1 className='text-4xl md:text-5xl font-bold tracking-tight mb-4'>
						Hablemos de tu{' '}
						<span className='bg-gradient-to-br from-brand-300 to-brand-500 bg-clip-text text-transparent'>
							proyecto
						</span>
					</h1>
					<p className='max-w-2xl mx-auto text-white/70'>
						Cotizá equipamiento para tu empresa, consultá disponibilidad o
						pedinos asesoramiento técnico. Respondemos rápido.
					</p>
				</div>
			</section>

			{/* CONTENIDO */}
			<section className='container py-16'>
				<div className='grid grid-cols-1 gap-8 md:grid-cols-3'>
					{/* FORM */}
					<div className='md:col-span-2'>
						<div className='relative bg-white border border-ink-200 rounded-2xl shadow-card p-6 md:p-8 overflow-hidden'>
							<div
								aria-hidden
								className='absolute -top-24 -right-24 w-64 h-64 bg-brand-100/60 rounded-full blur-3xl'
							/>
							<div className='relative'>
								<h2 className='text-2xl font-bold text-ink-900'>
									Envíanos tu mensaje
								</h2>
								<p className='text-sm text-ink-500 mt-1 mb-6'>
									Completa el formulario y te contactaremos a la brevedad.
								</p>

								<form onSubmit={handleSubmit} className='space-y-5'>
									<div>
										<label htmlFor='name' className='block text-xs font-semibold text-ink-700 mb-1.5'>
											Nombre o empresa <span className='text-rose-500'>*</span>
										</label>
										<div className='relative'>
											<FaRegBuilding className='absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400' />
											<input
												id='name'
												type='text'
												name='name'
												required
												placeholder='Ej: RF Tecnología SRL'
												className='input-base pl-10'
											/>
										</div>
									</div>

									<div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
										<div>
											<label htmlFor='email' className='block text-xs font-semibold text-ink-700 mb-1.5'>
												Correo <span className='text-rose-500'>*</span>
											</label>
											<div className='relative'>
												<FaEnvelope className='absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400' />
												<input
													id='email'
													type='email'
													name='email'
													defaultValue={userEmail}
													required
													placeholder='vos@empresa.com'
													className='input-base pl-10'
												/>
											</div>
											<ValidationError
												prefix='Email'
												field='email'
												errors={state.errors}
												className='mt-1 text-xs text-rose-500'
											/>
										</div>
										<div>
											<label htmlFor='phone' className='block text-xs font-semibold text-ink-700 mb-1.5'>
												Teléfono <span className='font-normal text-ink-400'>(opcional)</span>
											</label>
											<div className='relative'>
												<FaPhoneAlt className='absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400' />
												<input
													id='phone'
													type='tel'
													name='phone'
													placeholder='+598 9X XXX XXX'
													className='input-base pl-10'
												/>
											</div>
										</div>
									</div>

									<div>
										<label htmlFor='message' className='block text-xs font-semibold text-ink-700 mb-1.5'>
											Mensaje <span className='text-rose-500'>*</span>
										</label>
										<textarea
											id='message'
											name='message'
											required
											rows={5}
											placeholder='Contanos qué necesitás...'
											className='input-base resize-none'
										/>
										<ValidationError
											prefix='Message'
											field='message'
											errors={state.errors}
											className='mt-1 text-xs text-rose-500'
										/>
									</div>

									<button
										type='submit'
										disabled={state.submitting}
										className='btn-primary w-full py-3'
									>
										{state.submitting ? 'Enviando...' : 'Enviar mensaje'}
									</button>
								</form>
							</div>
						</div>
					</div>

					{/* ASIDE */}
					<aside className='space-y-5'>
						<div className='relative overflow-hidden p-6 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-card'>
							<div className='flex items-start gap-3'>
								<div className='shrink-0 grid place-items-center w-11 h-11 rounded-xl bg-white/20 backdrop-blur'>
									<FaRegCommentDots size={20} />
								</div>
								<div className='space-y-2'>
									<h3 className='font-bold'>¿Preferís WhatsApp?</h3>
									<p className='text-sm text-white/80'>
										Te respondemos al toque en horario comercial.
									</p>
									<a
										href='https://wa.me/59894116299'
										target='_blank'
										rel='noreferrer'
										className='inline-flex items-center gap-2 px-4 py-2 mt-2 rounded-lg bg-white text-emerald-700 font-semibold text-sm hover:bg-emerald-50 transition-colors'
									>
										<FaWhatsapp size={18} /> Hablar ahora
									</a>
								</div>
							</div>
						</div>

						<div className='p-6 border border-ink-200 rounded-2xl bg-white shadow-soft'>
							<h3 className='text-sm font-bold uppercase tracking-wider text-brand-700 mb-3'>
								Horario de atención
							</h3>
							<ul className='space-y-1.5 text-sm text-ink-600'>
								<li className='flex items-center justify-between'>
									<span>Lunes a Viernes</span>
									<span className='font-semibold text-ink-900'>8:00 — 20:00</span>
								</li>
								<li className='flex items-center justify-between'>
									<span>Sábados</span>
									<span className='font-semibold text-ink-900'>10:00 — 17:00</span>
								</li>
							</ul>
						</div>

						<div className='p-6 border border-ink-200 rounded-2xl bg-white shadow-soft'>
							<h3 className='text-sm font-bold uppercase tracking-wider text-brand-700 mb-3'>
								Contacto directo
							</h3>
							<ul className='space-y-3 text-sm text-ink-700'>
								<li className='flex items-center gap-3'>
									<span className='grid place-items-center w-9 h-9 rounded-lg bg-brand-50 text-brand-700'>
										<FaEnvelope size={14} />
									</span>
									<a href='mailto:ventas@rfstore.uy' className='hover:text-brand-700'>
										ventas@rfstore.uy
									</a>
								</li>
								<li className='flex items-center gap-3'>
									<span className='grid place-items-center w-9 h-9 rounded-lg bg-brand-50 text-brand-700'>
										<FaPhoneAlt size={14} />
									</span>
									<a href='tel:+59894116299' className='hover:text-brand-700'>
										+598 94 116 299
									</a>
								</li>
								<li className='flex items-center gap-3'>
									<span className='grid place-items-center w-9 h-9 rounded-lg bg-brand-50 text-brand-700'>
										<FaMapMarkerAlt size={14} />
									</span>
									Montevideo, Uruguay
								</li>
								<li className='flex items-center gap-3'>
									<span className='grid place-items-center w-9 h-9 rounded-lg bg-brand-50 text-brand-700'>
										<FaRegUser size={14} />
									</span>
									Ventas B2B y particulares
								</li>
							</ul>
						</div>
					</aside>
				</div>
			</section>
		</div>
	);
};
