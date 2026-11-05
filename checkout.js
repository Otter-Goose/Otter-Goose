// Creates a Stripe Checkout session for the whole basket.
// Prices come from shop.json on the server, never from the browser.
const shop = require("../../shop.json");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, { error: "Payments aren't set up yet. Add STRIPE_SECRET_KEY in Netlify." });

  let items;
  try { items = JSON.parse(event.body || "{}").items; } catch { return json(400, { error: "Bad request" }); }
  if (!Array.isArray(items) || items.length === 0) return json(400, { error: "Your basket is empty." });

  const site = process.env.URL || `https://${event.headers.host}`;
  const cur = shop.currency.toLowerCase();
  const p = new URLSearchParams();
  p.append("mode", "payment");
  p.append("success_url", `${site}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  p.append("cancel_url", `${site}/#basket`);
  p.append("billing_address_collection", "auto");
  (shop.shipToCountries || ["GB"]).forEach((c, i) =>
    p.append(`shipping_address_collection[allowed_countries][${i}]`, c));

  let subtotal = 0;
  const seen = new Set();
  let i = 0;
  for (const it of items.slice(0, 20)) {
    const prod = shop.products.find((x) => x.id === it.id);
    const qty = Math.floor(Number(it.qty));
    if (!prod || seen.has(prod.id) || !(qty >= 1 && qty <= 99))
      return json(400, { error: "Something in your basket isn't available. Please refresh and try again." });
    seen.add(prod.id);
    subtotal += prod.price * qty;
    p.append(`line_items[${i}][quantity]`, String(qty));
    p.append(`line_items[${i}][price_data][currency]`, cur);
    p.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(prod.price * 100)));
    p.append(`line_items[${i}][price_data][product_data][name]`, prod.name);
    if (/^https:\/\//.test(prod.image || ""))
      p.append(`line_items[${i}][price_data][product_data][images][0]`, prod.image);
    i++;
  }

  const free = shop.freeShippingOver && subtotal >= shop.freeShippingOver;
  p.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  p.append("shipping_options[0][shipping_rate_data][display_name]", free ? "Free delivery" : "Standard delivery");
  p.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(free ? 0 : Math.round(shop.shipping * 100)));
  p.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", cur);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p,
  });
  const data = await res.json();
  if (!res.ok) return json(502, { error: (data.error && data.error.message) || "Stripe couldn't start checkout." });
  return json(200, { url: data.url });
};
