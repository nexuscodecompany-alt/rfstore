import { supabase } from '../supabase/client';

interface IAuthLogin {
	email: string;
	password: string;
}

interface IAuthRegister {
	email: string;
	password: string;
	fullName: string;
	phone?: string;
}

export const signUp = async ({
	email,
	password,
	fullName,
	phone,
}: IAuthRegister) => {
	try {
		// 1. Crear o Registrar usuario
		const { data, error } = await supabase.auth.signUp({
			email,
			password,
		});

		if (error) {
			throw new Error(error.message);
		}

		const userId = data.user?.id;

		if (!userId) {
			throw new Error('Error al obtener el id del usuario');
		}

		// 2. Autenticar al usuario
		const { error: signInError } =
			await supabase.auth.signInWithPassword({
				email,
				password,
			});

		if (signInError) {
			console.log(signInError);
			throw new Error('Email o contraseña incorrectos');
		}

		// 3. Insertar el rol por defecto - CUSTOMER (Cliente)
		const { error: roleError } = await supabase
			.from('user_roles')
			.insert({
				user_id: userId,
				role: 'customer',
			});

		if (roleError) {
			console.log(roleError);
			throw new Error('Error al registrar el rol del usuario');
		}

		// 4. Insertar los datos del usuario en la tabla customers (Clientes)
		const { error: customerError } = await supabase
			.from('customers')
			.insert({
				user_id: userId,
				full_name: fullName,
				phone,
				email,
			});

		if (customerError) {
			console.log(customerError);
			throw new Error('Error al registrar los datos del usuario');
		}

		return data;
	} catch (error) {
		console.log(error);
		throw new Error('Error al registrar el usuario');
	}
};

export const signIn = async ({ email, password }: IAuthLogin) => {
	const { data, error } = await supabase.auth.signInWithPassword({
		email,
		password,
	});

	if (error) {
		console.log(error);
		throw new Error('Email o contraseña incorrectos');
	}

	return data;
};

export const signOut = async () => {
	const { error } = await supabase.auth.signOut();

	if (error) {
		console.log(error);
		throw new Error('Error al cerrar sesión');
	}
};

/**
 * Deja al comprador con sesión y ficha de cliente antes de crear el pedido.
 * Con cuenta, actualiza sus datos de contacto. Sin cuenta, abre una sesión de
 * INVITADO (anónima de Supabase): así el pedido tiene dueño y todo lo que ya
 * valida "es tu pedido" (pago, página de gracias, comprobante) sigue igual.
 * Requiere "Allow anonymous sign-ins" prendido en Supabase → Authentication.
 */
export const ensureBuyerSession = async (buyer: {
	fullName: string;
	phone: string;
	email: string;
	/** Cédula: la pide el checkout en compras de más de 5000 UI (factura electrónica). */
	documentCi?: string;
}) => {
	let { data: { session } } = await supabase.auth.getSession();
	if (!session) {
		const { data, error } = await supabase.auth.signInAnonymously();
		if (error || !data.session) {
			console.log(error);
			throw new Error('No pudimos iniciar la compra. Probá de nuevo en unos segundos.');
		}
		session = data.session;
	}

	const userId = session.user.id;
	const datos: Record<string, string> = {
		full_name: buyer.fullName.trim(),
		phone: buyer.phone.trim(),
		email: buyer.email.trim(),
	};
	const ci = (buyer.documentCi ?? '').replace(/\D/g, '');
	if (ci) datos.document_ci = ci;
	const { data: existing } = await supabase
		.from('customers')
		.select('id')
		.eq('user_id', userId)
		.maybeSingle();
	// `as any`: src/supabase/types.ts no tiene document_ci (columna nueva).
	const customers = (supabase as any).from('customers');
	const { error } = existing
		? await customers.update(datos).eq('id', existing.id)
		: await customers.insert({ user_id: userId, ...datos });
	// Con cuenta ya existe la ficha: un fallo acá no frena la compra. Sin ficha
	// el pedido no tendría a quién mandarle los mails.
	if (error && !existing) {
		console.log(error);
		throw new Error('No pudimos guardar tus datos. Probá de nuevo.');
	}
	return session;
};

export const getSession = async () => {
	const { data, error } = await supabase.auth.getSession();

	if (error) {
		console.log(error);
		throw new Error('Error al obtener la sesión');
	}

	return data;
};

export const getUserData = async (userId: string) => {
	const { data, error } = await supabase
		.from('customers')
		.select('*')
		.eq('user_id', userId)
		.single();

	if (error) {
		console.log(error);
		throw new Error('Error al obtener los datos del usuario');
	}

	return data;
};

export const getUserRole = async (userId: string) => {
	const { data, error } = await supabase
		.from('user_roles')
		.select('role')
		.eq('user_id', userId)
		.single();

	if (error) {
		console.log(error);
		throw new Error('Error al obtener el rol del usuario');
	}

	return data.role;
};
