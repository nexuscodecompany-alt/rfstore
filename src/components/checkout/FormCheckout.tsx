import { useState, useEffect, useMemo } from "react";
import { useCreateOrder, useUser } from "../../hooks";
import { useCartStore } from "../../store/cart.store";
import { useCheckoutShippingStore } from "../../store/checkoutShipping.store";
import { ImSpinner2 } from "react-icons/im";
import toast from "react-hot-toast";
import { ItemsCheckout } from "./ItemsCheckout";
import { formatPrice } from "../../helpers";
import { supabase } from "../../supabase/client";
import { URUGUAY_DEPARTMENTS_INTERIOR } from "../../constants/shipping";

const FORMSPREE_ID = "mvgqddop";

// Regla: envío gratis SOLO en Montevideo con compras desde USD 100.
// Cualquier otro caso queda "a coordinar" — el agente confirma por WhatsApp.
const FREE_SHIPPING_MIN_USD = 100;

const computeShippingLabel = (
  department: string,
  total: number
): string => {
  if (!department) return "A coordinar";
  if (department === "Montevideo") {
    return total >= FREE_SHIPPING_MIN_USD ? "Gratis" : "A coordinar";
  }
  return "A coordinar";
};

const ALL_DEPARTMENTS = ["Montevideo", ...URUGUAY_DEPARTMENTS_INTERIOR];

export const FormCheckout = () => {
  const { mutate: createOrder, isPending } = useCreateOrder();
  const { session } = useUser();

  const cleanCart = useCartStore((state) => state.cleanCart);
  const cartItems = useCartStore((state) => state.items);
  const totalAmount = useCartStore((state) => state.totalAmount);

  const setShippingLabel = useCheckoutShippingStore(s => s.setShippingLabel);
  const resetShippingLabel = useCheckoutShippingStore(s => s.reset);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const shippingLabel = useMemo(
    () => computeShippingLabel(department, totalAmount),
    [department, totalAmount]
  );

  // Sincronizamos la etiqueta con el resumen lateral (ItemsCheckout).
  useEffect(() => {
    setShippingLabel(shippingLabel);
    return () => resetShippingLabel();
  }, [shippingLabel, setShippingLabel, resetShippingLabel]);

  // Prefill datos del cliente desde customers (persistente entre compras).
  useEffect(() => {
    if (!session?.user?.id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('customers')
          .select('phone, email')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (data) {
          if (data.email) setEmail(data.email);
          else if (session.user.email) setEmail(session.user.email);
          if (data.phone) setPhone(data.phone);
        } else if (session.user.email) {
          setEmail(session.user.email);
        }
      } catch (e) {
        console.warn('prefill customer:', e);
      }
    })();
  }, [session?.user?.id, session?.user?.email]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Ingresá un correo válido");
      return;
    }
    if (!department) {
      toast.error("Seleccioná el departamento de envío");
      return;
    }

    const itemsText = cartItems
      .map((item, index) => {
        return `Producto ${index + 1}
				Nombre: ${item.name}
				Cantidad: ${item.quantity}
				Precio: ${formatPrice(item.price)}
				-------------------------`;
      })
      .join("\n");

    setSubmitting(true);

    // Persistir email/teléfono en customers para próximas compras.
    if (session?.user?.id) {
      try {
        await supabase
          .from('customers')
          .update({ email, phone })
          .eq('user_id', session.user.id);
      } catch (e) {
        console.warn('persist customer:', e);
      }
    }

    try {
      // Enviar datos de contacto a Formspree
      const response = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          phone,
          department,
          shipping: shippingLabel,
          message,
          source: "checkout",
          totalAmount,
          items_text: itemsText,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.errors) {
        throw new Error("Formspree validation errors");
      }

      const orderInput = {
        address: {
          addressLine1: "",
          addressLine2: "",
          city: department,
          state: department,
          postalCode: "",
          country: "Uruguay",
        },
        cartItems: cartItems.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          price: item.price,
        })),
        totalAmount,
      };

      toast.success(
        "¡Gracias por elegirnos! Un agente se estará comunicando con usted a la brevedad.",
        { position: "bottom-right" }
      );

      createOrder(orderInput, {
        onSuccess: () => {
          cleanCart();
        },
      });

    } catch (err) {
      console.error('Error:', err);
      toast.error("No se pudo enviar tu solicitud. Intenta nuevamente.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <ImSpinner2 className="w-10 h-10 animate-spin" />
        <p className="text-sm font-medium">Estamos procesando tu pedido</p>
      </div>
    );
  }

  return (
    <div>
      <form className="flex flex-col gap-6" onSubmit={onSubmit}>
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold tracking-normal">
            Datos de contacto
          </h3>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              Correo electrónico <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              className="p-2 border rounded-md border-slate-300"
              placeholder="correo@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Teléfono (opcional)</label>
            <input
              type="tel"
              className="p-2 border rounded-md border-slate-300"
              placeholder="099 123 456"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold tracking-normal">Envío</h3>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              Departamento <span className="text-red-500">*</span>
            </label>
            <select
              className="p-2 border rounded-md border-slate-300 bg-white"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              required
            >
              <option value="">Seleccioná tu departamento…</option>
              {ALL_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {department === "Montevideo" && totalAmount < FREE_SHIPPING_MIN_USD && (
              <p className="text-xs text-amber-700">
                Envío gratis dentro de Montevideo a partir de USD {FREE_SHIPPING_MIN_USD}.
                Coordinamos el costo por WhatsApp.
              </p>
            )}
            {department === "Montevideo" && totalAmount >= FREE_SHIPPING_MIN_USD && (
              <p className="text-xs text-emerald-700">
                ¡Tu pedido tiene envío gratis dentro de Montevideo!
              </p>
            )}
            {department && department !== "Montevideo" && (
              <p className="text-xs text-ink-500">
                Para envíos al interior coordinamos el costo por WhatsApp.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Mensaje (opcional)</label>
            <textarea
              className="p-2 border rounded-md border-slate-300"
              rows={4}
              placeholder="Contanos qué estás buscando o cualquier detalle relevante"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>

        {/* Resumen (solo mobile) */}
        <div className="md:hidden">
          <ItemsCheckout />
        </div>

        <button
          type="submit"
          className="bg-black text-white py-3.5 font-bold tracking-wide rounded-md mt-2 disabled:opacity-70"
          disabled={submitting}
        >
          {submitting ? "Enviando..." : "Solicitar Cotización"}
        </button>
      </form>
    </div>
  );
};
