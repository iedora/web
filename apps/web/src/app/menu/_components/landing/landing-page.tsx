"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, LangSwitcher, type LangOption, Nav, NavActions, NavBrand, PageProgress, Wordmark } from "@iedora/design-system";
import { BRAND_NAME, BRAND_URL, CONTACT_EMAIL, PRODUCTS, productUrl } from '@iedora/brand';
import { signInUrl, signUpUrl } from '@iedora/product-core/url';
import "./landing.css";

/**
 * Sign-in / sign-up cross-navigate to the `core` product's auth pages
 * (`https://core.iedora.com/sign-in` in prod, `http://localhost:3000/core/
 * sign-in` in dev). The pages call better-auth via `authClient.signIn.email`
 * / `signUp.email` and set the cookie on the parent `.iedora.com` domain
 * so SSO across iedora products works transparently.
 */
const SIGN_IN_HREF = signInUrl();
const SIGN_UP_HREF = signUpUrl();

type LangCode = "en" | "pt" | "es" | "fr";

type Headline = { roman: string; tagline: string };

type Copy = {
  nav: { signin: string; cta: string };
  hero: {
    eyebrow: string;
    headline: Headline;
    ctaPrimary: string;
    trust: string;
  };
  /** One quiet line under the simulator. No eyebrow, no title — just the
   *  value prop in a single sentence. Read like a printed statement. */
  statement: string;
  pricing: {
    eyebrow: string;
    h: string;
    free: { tier: string; priceMain: string; priceSub: string; desc: string; cta: string; feats: string[] };
    pro: { tier: string; priceMain: string; priceSub: string; desc: string; cta: string; feats: string[]; badge: string };
    foot: string;
  };
  closing: { eyebrow: string; h: string; ctaPrimary: string };
  footer: { left: (string | { text: string; href: string })[]; contact: string };
  editor: { title: string; restaurant: string; item: string; desc: string; section: string; price: string; publish: string; live: string; add: string };
  phone: { eyebrow: string; live: string };
};

const LANGS: readonly (LangOption & { code: LangCode; label: string })[] = [
  { code: "en", label: "EN", name: "English", flag: "🇬🇧" },
  { code: "pt", label: "PT", name: "Português", flag: "🇵🇹" },
  { code: "es", label: "ES", name: "Español", flag: "🇪🇸" },
  { code: "fr", label: "FR", name: "Français", flag: "🇫🇷" },
] as const;

const COPY: Record<LangCode, Copy> = {
  en: {
    nav: { signin: "Log in", cta: "Get started" },
    hero: {
      eyebrow: "at the table",
      headline: { roman: "One menu. Every screen it lives on.", tagline: "Always current. Always honest about the kitchen." },
      ctaPrimary: "Try it with your menu",
      trust: "Always free for one restaurant · No card · No setup call",
    },
    statement: "One QR on the table. The menu behind it changes whenever you want.",
    pricing: {
      eyebrow: "plans",
      h: "Two prices. Both honest.",
      free: {
        tier: "Free", priceMain: "€0", priceSub: "forever",
        desc: "For the corner café and the place that opens four nights a week.",
        cta: "Start free",
        feats: ["One restaurant", "1,000 guest views per month", "Multiple translations", "Allergens & dietary tags"],
      },
      pro: {
        tier: "Casa", priceMain: "€12", priceSub: "per year",
        desc: "For everyone past a thousand views, and anyone running more than one room.",
        cta: "Choose Casa",
        feats: ["Multiple restaurants", "Unlimited guest views", "Hour-by-hour scan analytics", "PDF export"],
        badge: "Recommended",
      },
      foot: "No card on file for the free tier. Cancel Casa anytime.",
    },
    closing: {
      eyebrow: "at the table",
      h: "Put your menu online this afternoon.",
      ctaPrimary: "Bring your menu over",
    },
    footer: { left: ["Menu · an ", { text: BRAND_NAME, href: BRAND_URL }, " product · made in Lisbon"], contact: CONTACT_EMAIL },
    editor: { title: "Menu", restaurant: "Restaurant", item: "Item name", desc: "Description", section: "Section", price: "Price (€)", publish: "⌘ S to save", live: "live", add: "+ add item" },
    phone: { eyebrow: "at the table", live: "updated just now" },
  },
  pt: {
    nav: { signin: "Entrar", cta: "Começar" },
    hero: {
      eyebrow: "à mesa",
      headline: { roman: "Uma carta. Em todos os ecrãs onde vive.", tagline: "Sempre actual. Honesta com a cozinha." },
      ctaPrimary: "Experimente com a sua carta",
      trust: "Grátis para um restaurante · Sem cartão · Sem chamada",
    },
    statement: "Um QR na mesa. A carta por trás muda quando quiser.",
    pricing: {
      eyebrow: "modelos",
      h: "Dois preços. Ambos honestos.",
      free: {
        tier: "Grátis", priceMain: "€0", priceSub: "para sempre",
        desc: "Para o café da esquina e a casa que abre quatro noites por semana.",
        cta: "Começar grátis",
        feats: ["Um restaurante", "1.000 visualizações por mês", "Várias traduções", "Alergénios e dietas"],
      },
      pro: {
        tier: "Casa", priceMain: "€12", priceSub: "por ano",
        desc: "Para quem passa as mil visualizações, e para quem tem mais que uma sala.",
        cta: "Escolher Casa",
        feats: ["Vários restaurantes", "Visualizações ilimitadas", "Análise de scans por hora", "Exportação para PDF"],
        badge: "Recomendado",
      },
      foot: "Sem cartão no plano grátis. Cancele a Casa quando quiser.",
    },
    closing: {
      eyebrow: "à mesa",
      h: "Coloque a carta online esta tarde.",
      ctaPrimary: "Traga a sua carta",
    },
    footer: { left: ["Menu · um produto ", { text: BRAND_NAME, href: BRAND_URL }, " · feito em Lisboa"], contact: CONTACT_EMAIL },
    editor: { title: "Carta", restaurant: "Restaurante", item: "Nome do prato", desc: "Descrição", section: "Secção", price: "Preço (€)", publish: "⌘ S para guardar", live: "ao vivo", add: "+ adicionar" },
    phone: { eyebrow: "à mesa", live: "actualizado agora" },
  },
  es: {
    nav: { signin: "Entrar", cta: "Empezar" },
    hero: {
      eyebrow: "à mesa",
      headline: { roman: "Una carta. En cada pantalla donde vive.", tagline: "Siempre al día. Honesta con la cocina." },
      ctaPrimary: "Pruébalo con tu carta",
      trust: "Gratis para un restaurante · Sin tarjeta · Sin llamadas",
    },
    statement: "Un QR en la mesa. La carta detrás cambia cuando quieras.",
    pricing: {
      eyebrow: "modelos",
      h: "Dos precios. Los dos honestos.",
      free: {
        tier: "Gratis", priceMain: "€0", priceSub: "para siempre",
        desc: "Para la cafetería de barrio y el sitio que abre cuatro noches.",
        cta: "Empezar gratis",
        feats: ["Un restaurante", "1.000 visitas al mes", "Varias traducciones", "Alérgenos y dietas"],
      },
      pro: {
        tier: "Casa", priceMain: "€12", priceSub: "al año",
        desc: "Para los que pasan de las mil visitas, y para quien tiene más de una sala.",
        cta: "Elegir Casa",
        feats: ["Varios restaurantes", "Visitas ilimitadas", "Análisis de escaneos por hora", "Exportar a PDF"],
        badge: "Recomendado",
      },
      foot: "Sin tarjeta en el plan gratis. Cancela Casa cuando quieras.",
    },
    closing: {
      eyebrow: "à mesa",
      h: "Pon tu carta online esta tarde.",
      ctaPrimary: "Trae tu carta",
    },
    footer: { left: ["Menu · un producto ", { text: BRAND_NAME, href: BRAND_URL }, " · hecho en Lisboa"], contact: CONTACT_EMAIL },
    editor: { title: "Carta", restaurant: "Restaurante", item: "Nombre del plato", desc: "Descripción", section: "Sección", price: "Precio (€)", publish: "⌘ S para guardar", live: "en vivo", add: "+ añadir" },
    phone: { eyebrow: "à mesa", live: "actualizado ahora" },
  },
  fr: {
    nav: { signin: "Se connecter", cta: "Commencer" },
    hero: {
      eyebrow: "à mesa",
      headline: { roman: "Une carte. Sur chaque écran où elle vit.", tagline: "Toujours à jour. Honnête avec la cuisine." },
      ctaPrimary: "Essayez avec votre carte",
      trust: "Gratuit pour un restaurant · Pas de carte · Pas d'appel",
    },
    statement: "Un QR sur la table. La carte derrière change quand vous voulez.",
    pricing: {
      eyebrow: "modèles",
      h: "Deux prix. Tous deux honnêtes.",
      free: {
        tier: "Gratuit", priceMain: "0 €", priceSub: "pour toujours",
        desc: "Pour le café du coin et l'adresse qui ouvre quatre soirs par semaine.",
        cta: "Commencer",
        feats: ["Un restaurant", "1 000 vues par mois", "Plusieurs traductions", "Allergènes et régimes"],
      },
      pro: {
        tier: "Casa", priceMain: "12 €", priceSub: "par an",
        desc: "Pour ceux qui dépassent les mille vues, et pour ceux qui ont plus d'une salle.",
        cta: "Choisir Casa",
        feats: ["Plusieurs restaurants", "Vues illimitées", "Analyses des scans par heure", "Export PDF"],
        badge: "Recommandé",
      },
      foot: "Aucune carte requise pour le gratuit. Annulez Casa à tout moment.",
    },
    closing: {
      eyebrow: "à mesa",
      h: "Mettez votre carte en ligne cet après-midi.",
      ctaPrimary: "Apportez votre carte",
    },
    footer: { left: ["Menu · un produit ", { text: BRAND_NAME, href: BRAND_URL }, " · fait à Lisbonne"], contact: CONTACT_EMAIL },
    editor: { title: "Carte", restaurant: "Restaurant", item: "Nom du plat", desc: "Description", section: "Section", price: "Prix (€)", publish: "⌘ S pour enregistrer", live: "en direct", add: "+ ajouter" },
    phone: { eyebrow: "à mesa", live: "mis à jour à l'instant" },
  },
};

type DemoMenu = {
  restaurant: string;
  subtitle: string;
  sections: { title: string; items: { id: number; name: string; desc: string; price: string }[] }[];
};

const DEMO_MENUS: Record<LangCode, DemoMenu> = {
  en: {
    restaurant: "House Tavern", subtitle: "14 Flower Street · Lisbon",
    sections: [
      { title: "to begin", items: [
        { id: 1, name: "House bread, butter", desc: "slow crumb, Tavira sea salt", price: "2.50" },
        { id: 2, name: "Veal croquettes", desc: "three per plate, old mustard", price: "6.00" },
      ]},
      { title: "today's specials", items: [
        { id: 3, name: "Cod à lagareiro", desc: "smashed potato, sautéed greens", price: "18.50" },
        { id: 4, name: "Duck rice", desc: "slow oven, mountain chouriço", price: "16.00" },
      ]},
    ],
  },
  pt: {
    restaurant: "Tasca do Avô", subtitle: "Rua das Flores, 14 · Lisboa",
    sections: [
      { title: "para começar", items: [
        { id: 1, name: "Pão da casa, manteiga", desc: "miolo lento, sal de Tavira", price: "2,50" },
        { id: 2, name: "Croquetes de vitela", desc: "três por dose, mostarda antiga", price: "6,00" },
      ]},
      { title: "ementa do dia", items: [
        { id: 3, name: "Bacalhau à lagareiro", desc: "batata a murro, grelos salteados", price: "18,50" },
        { id: 4, name: "Arroz de pato", desc: "forno lento, chouriço da serra", price: "16,00" },
      ]},
    ],
  },
  es: {
    restaurant: "Taberna de la Casa", subtitle: "Calle de las Flores 14 · Lisboa",
    sections: [
      { title: "para empezar", items: [
        { id: 1, name: "Pan de la casa, mantequilla", desc: "miga lenta, sal de Tavira", price: "2,50" },
        { id: 2, name: "Croquetas de ternera", desc: "tres por ración, mostaza antigua", price: "6,00" },
      ]},
      { title: "menú del día", items: [
        { id: 3, name: "Bacalao à lagareiro", desc: "patata aplastada, grelos salteados", price: "18,50" },
        { id: 4, name: "Arroz de pato", desc: "horno lento, chouriço serrano", price: "16,00" },
      ]},
    ],
  },
  fr: {
    restaurant: "Taverne de la Maison", subtitle: "14 rue des Fleurs · Lisbonne",
    sections: [
      { title: "pour commencer", items: [
        { id: 1, name: "Pain maison, beurre", desc: "mie lente, sel de Tavira", price: "2,50 €" },
        { id: 2, name: "Croquettes de veau", desc: "trois par assiette, moutarde ancienne", price: "6,00 €" },
      ]},
      { title: "plats du jour", items: [
        { id: 3, name: "Morue à lagareiro", desc: "pommes écrasées, jeunes pousses sautées", price: "18,50 €" },
        { id: 4, name: "Riz au canard", desc: "four lent, chouriço des montagnes", price: "16,00 €" },
      ]},
    ],
  },
};

// ── Nav: brand + lang + log in + get started. No anchor links. ─────────────

function LandingNav({ c, lang, setLang }: { c: Copy; lang: LangCode; setLang: (l: LangCode) => void }) {
  return (
    <Nav data-test-id="landing-nav">
      <NavBrand>
        <Link className="brand" href="#top" aria-label="Menu home" data-test-id="landing-brand">
          {/* `ds-wordmark--reveal` is set statically so the letters are
              visible at first paint — no LCP penalty. The letter-by-letter
              animation only plays when a host adds the class POST-paint
              (the house product does that; we don't). */}
          <Wordmark word="menu" variant="inline" className="ds-wordmark--reveal" />
        </Link>
      </NavBrand>
      <NavActions>
        <LangSwitcher
          langs={LANGS}
          value={lang}
          onChange={(code) => setLang(code as LangCode)}
          testIdPrefix="landing-lang"
        />
        <Link
          href={SIGN_IN_HREF}
          className="nav-link"
          data-test-id="landing-signin"
        >
          {c.nav.signin}
        </Link>
        <Link
          href={SIGN_UP_HREF}
          className="nav-cta"
          data-test-id="landing-cta"
        >
          {c.nav.cta}
        </Link>
      </NavActions>
    </Nav>
  );
}

// ── Phone preview ──────────────────────────────────────────────────────────

function PhonePreview({
  menu,
  c,
  highlightId,
  onPick,
}: {
  menu: DemoMenu;
  c: Copy;
  highlightId: number;
  onPick: (id: number) => void;
}) {
  return (
    <div className="phone">
      <div className="phone-shell">
        <div className="phone-screen">
          <div className="phone-notch" />
          <div className="phone-status" aria-hidden="true">
            <span>9:41</span>
            <span>·· ◰</span>
          </div>
          <div className="phone-head">
            <div className="small">{c.phone.eyebrow}</div>
            <h3>{menu.restaurant}</h3>
            <div className="sub">{menu.subtitle}</div>
          </div>
          <div className="menu-list">
            {menu.sections.map((s, si) => (
              <React.Fragment key={si}>
                <div className="menu-section-title">{s.title}</div>
                {s.items.map((it) => {
                  const active = highlightId === it.id;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => onPick(it.id)}
                      className={"menu-item" + (active ? " highlight" : "")}
                      aria-pressed={active}
                      data-test-id={`landing-phone-item-${it.id}`}
                    >
                      <span className="menu-item-text">
                        <span className="name">{it.name}</span>
                        {it.desc && <span className="desc">{it.desc}</span>}
                      </span>
                      <span className="price">{String(it.price).includes("€") ? it.price : it.price + " €"}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div className="phone-foot">
            <span><span className="live-dot" />{c.phone.live}</span>
            <span>{LANGS.map((l) => l.label).join(" · ")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Editor mock (laptop) ───────────────────────────────────────────────────

function EditorMock({
  menu,
  c,
  highlightId,
  onPick,
}: {
  menu: DemoMenu;
  c: Copy;
  highlightId: number;
  onPick: (id: number) => void;
}) {
  const editingItem = (() => {
    for (const s of menu.sections)
      for (const it of s.items)
        if (it.id === highlightId) return { item: it, section: s };
    const section = menu.sections[1]!;
    return { item: section.items[0]!, section };
  })();

  return (
    <div className="laptop">
      <div className="laptop-screen">
        <div className="laptop-bar" aria-hidden="true">
          <i></i><i></i><i></i>
          <span className="url">{new URL(productUrl(PRODUCTS.menu)).host} / house-tavern / editor</span>
        </div>
        <div className="editor">
          <div className="editor-side">
            <b>{c.editor.title}</b>
            <ul>
              {menu.sections.map((s, si) => (
                <React.Fragment key={si}>
                  <li className="group-label">{s.title}</li>
                  {s.items.map((it) => {
                    const active = editingItem.item.id === it.id;
                    return (
                      <li key={it.id} className={active ? "active" : ""}>
                        <button
                          type="button"
                          className="editor-row-btn"
                          onClick={() => onPick(it.id)}
                          aria-pressed={active}
                          data-test-id={`landing-editor-row-${it.id}`}
                        >
                          {it.name.length > 18 ? it.name.slice(0, 18) + "…" : it.name}
                        </button>
                      </li>
                    );
                  })}
                </React.Fragment>
              ))}
              <li className="add">{c.editor.add}</li>
            </ul>
          </div>
          <div className="editor-main">
            <span className="field-label">{c.editor.restaurant}</span>
            <div className="field-input">{menu.restaurant}</div>

            <span className="field-label">{c.editor.item}</span>
            <div className="field-input field-anim" key={"name-" + highlightId}>{editingItem.item.name}</div>

            <span className="field-label">{c.editor.desc}</span>
            <div className="field-textarea field-anim" key={"desc-" + highlightId}>{editingItem.item.desc}</div>

            <div className="editor-row" style={{ marginTop: 0 }}>
              <div>
                <span className="field-label">{c.editor.section}</span>
                <div className="field-input field-anim" key={"sec-" + highlightId}>{editingItem.section.title}</div>
              </div>
              <div>
                <span className="field-label">{c.editor.price}</span>
                <div className="field-input field-anim" key={"price-" + highlightId}>{editingItem.item.price}</div>
              </div>
            </div>

            <div className="editor-foot">
              <span>{c.editor.publish}</span>
              <span className="live">● {c.editor.live}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="laptop-base" />
    </div>
  );
}

// ── Hero: eyebrow + headline + tagline + one CTA + simulator ───────────────

function Hero({
  c,
  menu,
  highlightId,
  onPick,
}: {
  c: Copy;
  menu: DemoMenu;
  highlightId: number;
  onPick: (id: number) => void;
}) {
  return (
    <header className="hero" id="top">
      <div className="container">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">{c.hero.eyebrow}</div>
            <h1>{c.hero.headline.roman}</h1>
            <p className="tagline">{c.statement}</p>
            <div className="hero-ctas">
              <Link
                className="btn btn-primary"
                href={SIGN_UP_HREF}
                data-test-id="landing-hero-cta"
              >
                {c.hero.ctaPrimary}
              </Link>
            </div>
            <p className="trust-line">{c.hero.trust}</p>
          </div>
          <div className="devices">
            <EditorMock menu={menu} c={c} highlightId={highlightId} onPick={onPick} />
            <PhonePreview menu={menu} c={c} highlightId={highlightId} onPick={onPick} />
          </div>
        </div>
      </div>
    </header>
  );
}

// ── Pricing: two cards, hairline framed ────────────────────────────────────

function Pricing({ c }: { c: Copy }) {
  return (
    <section id="pricing">
      <div className="container">
        <div className="sec-head reveal">
          <div className="eyebrow">{c.pricing.eyebrow}</div>
          <h2>{c.pricing.h}</h2>
        </div>
        <div className="price-cards">
          <article className="menu-card reveal" data-test-id="landing-pricing-free">
            <header className="menu-card-head">
              <span className="menu-card-tier">{c.pricing.free.tier}</span>
              <span className="menu-card-price">
                <span className="amt-main">{c.pricing.free.priceMain}</span>
                <span className="amt-sub">{c.pricing.free.priceSub}</span>
              </span>
            </header>
            <p className="menu-card-desc">{c.pricing.free.desc}</p>
            <ul className="menu-card-feats">
              {c.pricing.free.feats.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            <div className="menu-card-foot">
              <Link className="btn btn-ghost" href={SIGN_UP_HREF} data-test-id="landing-pricing-free-cta">
                {c.pricing.free.cta}
              </Link>
            </div>
          </article>

          <article className="menu-card reveal" data-test-id="landing-pricing-pro" style={{ ["--rd" as string]: "120ms" } as React.CSSProperties}>
            <header className="menu-card-head">
              <span className="menu-card-tier" style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                {c.pricing.pro.tier}
                <Badge variant="live">{c.pricing.pro.badge}</Badge>
              </span>
              <span className="menu-card-price">
                <span className="amt-main">{c.pricing.pro.priceMain}</span>
                <span className="amt-sub">{c.pricing.pro.priceSub}</span>
              </span>
            </header>
            <p className="menu-card-desc">{c.pricing.pro.desc}</p>
            <ul className="menu-card-feats">
              {c.pricing.pro.feats.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            <div className="menu-card-foot">
              <Link className="btn btn-primary" href={SIGN_UP_HREF} data-test-id="landing-pricing-pro-cta">
                {c.pricing.pro.cta}
              </Link>
            </div>
          </article>
        </div>
        <div className="price-foot">{c.pricing.foot}</div>
      </div>
    </section>
  );
}

// ── Closing + footer (a single quiet strip) ────────────────────────────────

function Closing({ c }: { c: Copy }) {
  return (
    <>
      <section id="cta" className="closing reveal">
        <div className="container">
          <span className="eyebrow">{c.closing.eyebrow}</span>
          <h2>{c.closing.h}</h2>
          <div className="hero-ctas" style={{ justifyContent: "center" }}>
            <Link className="btn btn-primary" href={SIGN_UP_HREF} data-test-id="landing-closing-cta">
              {c.closing.ctaPrimary}
            </Link>
          </div>
        </div>
      </section>
      <footer className="footer">
        <div className="container">
          <span>
            {c.footer.left.map((part, i) =>
              typeof part === "string" ? (
                <React.Fragment key={i}>{part}</React.Fragment>
              ) : (
                <Link key={i} href={part.href} data-test-id="landing-footer-brand">{part.text}</Link>
              ),
            )}
          </span>
          <span className="footer-links">
            <Link href={`mailto:${c.footer.contact}`} data-test-id="landing-footer-contact">
              {c.footer.contact}
            </Link>
          </span>
        </div>
      </footer>
    </>
  );
}

/**
 * One-time motion init.
 *
 * Two deliberately small jobs:
 *   - Flag `body.ds-loaded` once we're past first paint. The CSS gates
 *     `.reveal`'s hidden state on this flag, so no-JS and pre-hydration
 *     users render with everything fully visible (no FOUC, no blank
 *     section on a slow client). Above-the-fold content (the hero) is
 *     NOT marked `.reveal` and renders synchronously — LCP stays clean.
 *   - PageProgress: write `--ds-pageprog-progress` (0..1) from
 *     `scrollY / (scrollHeight - innerHeight)` on every scroll/resize
 *     frame. One rAF, passive listener; cinnabar rail at the top.
 *
 * Skipped on purpose: the wordmark letter-reveal animation. Toggling
 * it would gate the brand text behind hydration and worsen the LCP of
 * the nav — the wordmark already renders statically with
 * `ds-wordmark--reveal` so the letters paint immediately.
 */
function useLandingMotion() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.add("ds-loaded");
      });
    });

    const fill = document.querySelector<HTMLElement>(
      ".landing-root .ds-pageprog__fill",
    );
    let raf = 0;
    const update = () => {
      raf = 0;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, h.scrollTop / max)) : 0;
      if (fill) fill.style.setProperty("--ds-pageprog-progress", p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}

function useReveal(deps: React.DependencyList) {
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default function LandingPage() {
  const [lang, setLang] = React.useState<LangCode>("en");
  const c = COPY[lang];
  const menu = DEMO_MENUS[lang];

  const itemIds = React.useMemo(() => {
    const ids: number[] = [];
    for (const s of menu.sections) for (const it of s.items) ids.push(it.id);
    return ids;
  }, [menu]);

  const [rawHighlightId, setHighlightId] = React.useState<number>(3);
  const [userInteracted, setUserInteracted] = React.useState(false);

  const highlightId = itemIds.includes(rawHighlightId) ? rawHighlightId : (itemIds[0] ?? 1);

  const pick = React.useCallback((id: number) => {
    setHighlightId(id);
    setUserInteracted(true);
  }, []);

  React.useEffect(() => {
    if (userInteracted) return;
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    if (itemIds.length < 2) return;

    let interval: number | null = null;
    let timeout: number | null = null;

    const startCycle = () => {
      interval = window.setInterval(() => {
        if (document.hidden) return;
        setHighlightId((prev) => {
          const i = itemIds.indexOf(prev);
          return itemIds[(i + 1) % itemIds.length]!;
        });
      }, 4000);
    };

    timeout = window.setTimeout(startCycle, 6000);

    const onVis = () => {
      if (document.hidden && interval) {
        window.clearInterval(interval);
        interval = null;
      } else if (!document.hidden && !interval && !timeout) {
        startCycle();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timeout) window.clearTimeout(timeout);
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [itemIds, userInteracted]);

  useReveal([lang]);
  useLandingMotion();

  return (
    <div className="landing-root" lang={lang}>
      <PageProgress />
      <LandingNav c={c} lang={lang} setLang={setLang} />
      <Hero c={c} menu={menu} highlightId={highlightId} onPick={pick} />
      <Pricing c={c} />
      <Closing c={c} />
    </div>
  );
}
