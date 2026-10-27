
"use client";

import { useState } from "react";

type Currency = "USD" | "COP" | "MXN";

type Product = {
  id: number;
  name: string;
  category: string;
  priceUSD: number;
  color: "black" | "cream" | "gray";
  label: string;
  artwork: string;
};

const rates: Record<Currency, number> = {
  USD: 1,
  COP: 4000,
  MXN: 17,
};

const products: Product[] = [
  {
    id: 1,
    name: "Camiseta Dojo Oversize",
    category: "CAMISETAS",
    priceUSD: 45,
    color: "black",
    label: "NUEVO",
    artwork: "DOJO",
  },
  {
    id: 2,
    name: "Camiseta Horizonte",
    category: "CAMISETAS",
    priceUSD: 45,
    color: "cream",
    label: "DESTACADO",
    artwork: "SHIFU",
  },
  {
    id: 3,
    name: "Gorra Shifu Club",
    category: "GORRAS",
    priceUSD: 35,
    color: "black",
    label: "MÁS VENDIDO",
    artwork: "✳",
  },
  {
    id: 4,
    name: "Hoodie Esencia",
    category: "HOODIES",
    priceUSD: 80,
    color: "gray",
    label: "EDICIÓN LIMITADA",
    artwork: "SC",
  },
];

const categories = [
  {
    name: "CAMISETAS",
    description: "Diseños para todos los días",
    symbol: "01",
  },
  {
    name: "GORRAS",
    description: "El sello de la comunidad",
    symbol: "02",
  },
  {
    name: "HOODIES",
    description: "Comodidad con actitud",
    symbol: "03",
  },
  {
    name: "ACCESORIOS",
    description: "Los detalles cuentan",
    symbol: "04",
  },
];

function formatMoney(priceUSD: number, currency: Currency): string {
  const amount = priceUSD * rates[currency];

  return new Intl.NumberFormat(
    currency === "USD" ? "en-US" : currency === "COP" ? "es-CO" : "es-MX",
    {
      style: "currency",
      currency,
      minimumFractionDigits: currency === "USD" ? 2 : 0,
      maximumFractionDigits: currency === "USD" ? 2 : 0,
    },
  ).format(amount);
}

function Garment({ product }: { product: Product }) {
  const isCap = product.category === "GORRAS";
  const isHoodie = product.category === "HOODIES";

  const garment =
    product.color === "cream"
      ? "bg-[#f4eee3] text-[#191919]"
      : product.color === "gray"
        ? "bg-[#292929] text-white"
        : "bg-[#141414] text-white";

  return (
    <div
      className={`relative flex aspect-[4/5] items-center justify-center overflow-hidden ${
        product.color === "cream"
          ? "bg-[#e9e3d9]"
          : product.color === "gray"
            ? "bg-[#d9d8d6]"
            : "bg-[#e8e7e5]"
      }`}
    >
      <span className="absolute left-3 top-3 z-10 bg-[#d8c4ff] px-2 py-1 text-[9px] font-bold tracking-wider">
        {product.label}
      </span>

      <span
        aria-hidden="true"
        className="absolute right-3 top-3 text-lg text-black/60"
      >
        ♡
      </span>

      <div className="transition-transform duration-300 group-hover:scale-105">
        <div
          className={`relative flex items-center justify-center shadow-xl ${
            isCap
              ? "h-20 w-32 rounded-t-[55%] rounded-b-xl md:h-24 md:w-40"
              : isHoodie
                ? "h-44 w-36 rounded-2xl md:h-56 md:w-44"
                : "h-40 w-32 rounded-sm md:h-52 md:w-40"
          } ${garment}`}
        >
          {!isCap && (
            <div
              aria-hidden="true"
              className="absolute left-0 top-5 h-14 w-5 -translate-x-2 rotate-12 rounded-sm bg-inherit md:h-20 md:w-7"
            />
          )}

          <div className="relative z-10 text-center">
            <span className="block text-2xl font-black tracking-widest md:text-3xl">
              {product.artwork === "✳" ? "✳" : "✳"}
            </span>
            {!isCap && (
              <span className="mt-1 block text-[9px] font-black tracking-[0.2em] md:text-xs">
                {product.artwork}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [currency, setCurrency] = useState<Currency>("USD");

  return (
    <main className="min-h-screen bg-[#faf9f6] text-[#171717]">
      {/* Barra superior */}
      <div className="bg-[#d8c4ff] px-4 py-2 text-center text-[9px] font-bold tracking-[0.16em] md:text-[10px] md:tracking-[0.2em]">
        FANS PARA FANS · NUEVA COLECCIÓN · ENVÍOS INTERNACIONALES
      </div>

      {/* Navegación */}
      <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4 border-b border-black/10 bg-[#faf9f6] px-5 py-5 md:px-10">
        <a href="#inicio" className="text-xl font-black tracking-tight md:text-2xl">
          SHIFU<span className="font-light"> CLUB ✳</span>
        </a>

        <nav
          aria-label="Navegación principal"
          className="order-3 flex w-full flex-wrap gap-x-5 gap-y-3 text-[10px] font-semibold tracking-[0.12em] md:order-none md:w-auto md:gap-6"
        >
          <a href="#inicio" className="hover:text-[#7555b5]">INICIO</a>
          <a href="#coleccion" className="hover:text-[#7555b5]">COLECCIONES</a>
          <a href="#productos" className="hover:text-[#7555b5]">PRODUCTOS</a>
          <a href="#fans" className="hover:text-[#7555b5]">FANS PARA FANS</a>
        </nav>

        <label className="flex items-center gap-2 border-l border-black/15 pl-4 text-xs">
          <span className="sr-only">Seleccionar moneda</span>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
            className="max-w-24 bg-transparent py-2 font-semibold outline-none"
            aria-label="Seleccionar moneda"
          >
            <option value="USD">USD $</option>
            <option value="COP">COP $</option>
            <option value="MXN">MXN $</option>
          </select>
        </label>
      </header>

      {/* Portada editorial */}
      <section
        id="inicio"
        className="relative isolate flex min-h-[490px] items-center overflow-hidden bg-[#373430] px-6 py-16 text-white md:min-h-[510px] md:px-16"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[radial-gradient(ellipse_at_75%_45%,#81776d_0%,#514b45_38%,#292725_85%)]"
        />

        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-r from-black/65 via-black/25 to-transparent"
        />

        <div className="absolute right-[8%] top-[15%] -z-10 hidden h-80 w-80 rounded-full border border-white/10 md:block" />

        <div className="relative max-w-2xl">
          <p className="mb-5 text-[10px] tracking-[0.38em] text-white/80 md:text-xs">
            SHIFU CLUB · OFFICIAL MERCH
          </p>

          <h1 className="max-w-2xl text-5xl font-black leading-[0.98] tracking-tight md:text-7xl">
            FANS PARA FANS.
            <br />
            MÁS QUE MERCH.
            <br />
            ES COMUNIDAD.
          </h1>

          <p className="mt-6 max-w-md text-sm leading-6 text-white/80 md:text-base">
            Prendas para quienes viven el stream, comparten la disciplina y
            sienten que forman parte del mismo dojo.
          </p>

          <a
            href="#productos"
            className="mt-8 inline-flex bg-white px-7 py-4 text-[10px] font-bold tracking-[0.16em] text-black transition hover:bg-[#d8c4ff]"
          >
            EXPLORAR COLECCIÓN →
          </a>

          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-[10px] font-medium text-white/90">
            <span>✳ COMUNIDAD</span>
            <span>✳ EDICIONES ESPECIALES</span>
            <span>✳ IDENTIDAD SHIFU</span>
          </div>
        </div>

        <div className="absolute bottom-7 right-7 hidden text-right text-[10px] leading-5 tracking-[0.18em] text-white/75 lg:block">
          DISCIPLINA
          <br />
          STREAMS
          <br />
          COMUNIDAD
          <br />
          SIEMPRE JUNTOS
        </div>
      </section>

      {/* Categorías */}
      <section id="coleccion" className="px-5 py-3 md:px-10 md:py-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {categories.map((category, index) => (
            <a
              href="#productos"
              key={category.symbol}
              className={`group relative flex min-h-32 items-end overflow-hidden p-4 text-white md:min-h-28 md:p-5 ${
                index % 2 === 0 ? "bg-[#45413d]" : "bg-[#252525]"
              }`}
            >
              <span className="absolute right-2 top-0 text-7xl font-black text-white/[0.06] md:text-8xl">
                {category.symbol}
              </span>

              <div className="relative">
                <h2 className="text-xs font-black tracking-wider md:text-sm">
                  {category.name} →
                </h2>
                <p className="mt-1 text-[10px] text-white/70">
                  {category.description}
                </p>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Productos */}
      <section id="productos" className="px-5 pb-16 pt-8 md:px-10 md:pt-10">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[0.28em] text-[#7555b5]">
              DROP 001
            </p>
            <h2 className="text-2xl font-black tracking-tight md:text-3xl">
              PRODUCTOS DESTACADOS
            </h2>
          </div>

          <a
            href="#productos"
            className="shrink-0 text-[9px] font-semibold tracking-wider md:text-[10px]"
          >
            VER TODOS →
          </a>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:gap-x-5 lg:grid-cols-4">
          {products.map((product) => (
            <article key={product.id} className="group min-w-0">
              <Garment product={product} />

              <div className="flex items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold tracking-[0.12em] text-black/50">
                    {product.category}
                  </p>

                  <h3 className="mt-1 text-xs font-bold md:text-sm">
                    {product.name}
                  </h3>

                  <p className="mt-2 text-sm font-bold">
                    {formatMoney(product.priceUSD, currency)}
                  </p>

                  <p className="mt-1 text-[9px] text-black/50">
                    Precio base: {formatMoney(product.priceUSD, "USD")}
                  </p>

                  <div className="mt-3 flex gap-2">
                    <span className="h-3 w-3 rounded-full bg-[#171717]" />
                    <span className="h-3 w-3 rounded-full border border-black/10 bg-[#e8e0d3]" />
                    <span className="h-3 w-3 rounded-full bg-[#cdb7f6]" />
                  </div>
                </div>

                <span
                  aria-hidden="true"
                  className="mt-5 text-lg transition group-hover:text-[#7555b5]"
                >
                  ↗
                </span>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-6 text-[10px] leading-5 text-black/50">
          Los productos, diseños y precios son ilustrativos. Las conversiones
          utilizan tasas de prueba, no cotizaciones en tiempo real.
        </p>
      </section>

      {/* Mensaje de comunidad */}
      <section
        id="fans"
        className="bg-[#eae5df] px-6 py-16 text-center md:py-24"
      >
        <p className="mb-4 text-[10px] font-bold tracking-[0.35em] text-[#7555b5]">
          UNA TIENDA HECHA CON LA COMUNIDAD
        </p>

        <h2 className="text-4xl font-black tracking-tight md:text-6xl">
          DE FANS.
          <br />
          PARA FANS.
        </h2>

        <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-black/65">
          Shifu Store nace de la pasión por el stream y de una comunidad que
          comparte algo más que una pantalla. Esto también es parte del dojo.
        </p>

        <a
          href="#productos"
          className="mt-7 inline-block bg-black px-7 py-4 text-[10px] font-bold tracking-[0.15em] text-white transition hover:bg-[#7555b5]"
        >
          DESCUBRIR EL DROP 001 →
        </a>
      </section>

      {/* Footer */}
      <footer className="bg-[#191919] px-6 py-10 text-white md:px-10">
        <div className="flex flex-col justify-between gap-6 md:flex-row">
          <div>
            <p className="text-xl font-black">
              SHIFU<span className="font-light"> CLUB ✳</span>
            </p>
            <p className="mt-2 text-xs text-white/60">
              Fans para fans. Una comunidad, una identidad.
            </p>
          </div>

          <div className="text-xs leading-6 text-white/60">
            <p>USD · COP · MXN</p>
            <p>Shifu Store · 2026</p>
            <p>Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
