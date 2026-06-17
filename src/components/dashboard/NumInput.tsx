import { useEffect, useState } from 'react';

// Input numérico que permite VACIAR el campo mientras se tipea (sin saltar a 0
// ni colapsar la opción). Solo confirma el valor cuando hay un número válido;
// al perder foco vacío, revierte al último válido.
export const NumInput = ({
	value,
	onChange,
	className = '',
	placeholder,
	min,
}: {
	value: number;
	onChange: (n: number) => void;
	className?: string;
	placeholder?: string;
	min?: number;
}) => {
	const [text, setText] = useState(String(value));

	// Sincroniza si el valor cambia desde afuera (carga inicial, reset, etc.).
	useEffect(() => {
		if (Number(text) !== value) setText(String(value));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	return (
		<input
			type='number'
			inputMode='decimal'
			min={min}
			placeholder={placeholder}
			value={text}
			onChange={e => {
				const v = e.target.value;
				setText(v);
				if (v !== '' && !isNaN(Number(v))) onChange(Number(v));
			}}
			onBlur={() => {
				if (text === '' || isNaN(Number(text))) setText(String(value));
			}}
			className={className}
		/>
	);
};
