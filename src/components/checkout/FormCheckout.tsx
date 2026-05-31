import { useState, useEffect } from "react";
import { useCreateOrder, useUser } from "../../hooks";
import { useCartStore } from "../../store/cart.store";
import { ImSpinner2 } from "react-icons/im";
import toast from "react-hot-toast";
import { ItemsCheckout } from "./ItemsCheckout";
import { formatPrice } from "../../helpers";
import { supabase } from "../../supabase/client";

const FORMSPREE_ID = "mvgqddop";

export const FormCheckout = () => {
  const { mutate: createOrder, isPending } = useCreateOrder();
  const { session } = useUser();

  const cleanCart = useCartStore((state) => state.cleanCart);
  const cartItems = useCartStore((state) => state.items);
  const totalAmount = useCartStore((state) => state.totalAmount);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
          message,
          source: "checkout",
          totalAmount,
          items_text: itemsText,
        }),
      });

      // Verificar si la respuesta fue exitosa
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      // Verificar si Formspree procesó correctamente
      if (result.errors) {
        throw new Error("Formspree validation errors");
      }

      // Si llegamos aquí, Formspree fue exitoso
      // Crear la orden como hasta ahora
      const orderInput = {
        address: {
          addressLine1: "",
          addressLine2: "",
          city: "",
          state: "",
          postalCode: "",
          country: "",
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