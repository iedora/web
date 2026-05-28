"use client";

import * as React from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  LangSwitcher,
  type LangOption,
  Nav,
  NavActions,
  NavBrand,
  PageProgress,
  Wordmark,
} from "@iedora/design-system";
import { BRAND_NAME, BRAND_URL, CONTACT_EMAIL } from "@iedora/brand";

/**
 * imopush landing — coming-soon surface for `imopush.iedora.com`.
 *
 * Built from `@iedora/design-system` primitives only — no per-page CSS.
 * Visually coherent with the menu landing because both speak the same
 * `ds-*` vocabulary (paper/ink/cinnabar, Fraunces opsz-144 display,
 * JBMono labels, hairline rules, italic emphasis).
 *
 * The product itself is a backend scaffold today, so the page is honest
 * about the state: hero + how-it-works + portals + waitlist CTA. The
 * CTA is a `mailto:` because there is no waitlist endpoint yet — when
 * the form ships, swap the href, the rest stays.
 */

type LangCode = "en" | "pt" | "es" | "fr";

const LANGS: readonly LangOption[] = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "pt", name: "Português", flag: "🇵🇹" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
] as const;

type Copy = {
  nav: { back: string; cta: string };
  hero: {
    eyebrow: string;
    headline: string;
    tagline: string;
    ctaPrimary: string;
    trust: string;
  };
  how: {
    eyebrow: string;
    h: string;
    intro: string;
    steps: { n: string; h: string; p: string }[];
  };
  portals: {
    eyebrow: string;
    h: string;
    intro: string;
    /** Quiet line under each portal name. */
    meta: string;
  };
  closing: {
    eyebrow: string;
    h: string;
    ctaPrimary: string;
    badge: string;
  };
  footer: { left: string; right: string };
};

const WAITLIST_SUBJECT = "imopush%20waitlist";
const WAITLIST_HREF = `mailto:${CONTACT_EMAIL}?subject=${WAITLIST_SUBJECT}`;

const PORTALS = ["Idealista", "Custojusto", "OLX", "Imovirtual"] as const;

const COPY: Record<LangCode, Copy> = {
  en: {
    nav: { back: `Back to ${BRAND_NAME}`, cta: "Join the waitlist" },
    hero: {
      eyebrow: "for hosts",
      headline: "Publish once. Live on every portal",
      tagline: "List your property on imopush — it lands on Idealista, Custojusto, OLX and Imovirtual automatically.",
      ctaPrimary: "Join the waitlist",
      trust: "Free at launch · One listing in four places · Edits sync everywhere",
    },
    how: {
      eyebrow: "how it works",
      h: "Three steps. No portal logins",
      intro: "Write the listing once. We take care of the four uploads, and keep them in sync as you edit.",
      steps: [
        { n: "01", h: "Publish", p: "Upload photos, price and description in imopush — one editor, your wording." },
        { n: "02", h: "Distribute", p: "We post it to every portal in your plan with the right format for each." },
        { n: "03", h: "Edit", p: "Change a price or a photo here. The portals update on the same day." },
      ],
    },
    portals: {
      eyebrow: "portals included",
      h: "Four feeds. One edit",
      intro: "Your imopush listing reaches the four portals Portuguese hosts actually use — without four accounts.",
      meta: "auto-publish",
    },
    closing: {
      eyebrow: "for hosts",
      h: "Stop juggling four uploaders",
      ctaPrimary: "Join the waitlist",
      badge: "coming soon",
    },
    footer: { left: "imopush — made in Lisbon", right: CONTACT_EMAIL },
  },
  pt: {
    nav: { back: `Voltar à ${BRAND_NAME}`, cta: "Entrar na waitlist" },
    hero: {
      eyebrow: "para anunciantes",
      headline: "Publica uma vez. Em todos os portais",
      tagline: "Anuncia o teu imóvel no imopush — aparece no Idealista, Custojusto, OLX e Imovirtual, automaticamente.",
      ctaPrimary: "Entrar na waitlist",
      trust: "Grátis no lançamento · Um anúncio em quatro portais · Alterações sincronizadas",
    },
    how: {
      eyebrow: "como funciona",
      h: "Três passos. Zero logins de portal",
      intro: "Escreve o anúncio uma vez. Tratamos das quatro publicações e mantemos tudo em sincronia quando editas.",
      steps: [
        { n: "01", h: "Publica", p: "Carrega fotos, preço e descrição no imopush — um editor, as tuas palavras." },
        { n: "02", h: "Distribui", p: "Publicamos em cada portal do teu plano, no formato certo para cada um." },
        { n: "03", h: "Edita", p: "Muda um preço ou uma foto aqui. Os portais actualizam no mesmo dia." },
      ],
    },
    portals: {
      eyebrow: "portais incluídos",
      h: "Quatro destinos. Uma edição",
      intro: "O teu anúncio chega aos quatro portais que os anunciantes em Portugal usam de facto — sem quatro contas.",
      meta: "publicação automática",
    },
    closing: {
      eyebrow: "para anunciantes",
      h: "Largue quatro carregamentos. Fique com um",
      ctaPrimary: "Entrar na waitlist",
      badge: "em breve",
    },
    footer: { left: "imopush — feito em Lisboa", right: CONTACT_EMAIL },
  },
  es: {
    nav: { back: `Volver a ${BRAND_NAME}`, cta: "Apuntarme a la waitlist" },
    hero: {
      eyebrow: "para anunciantes",
      headline: "Publica una vez. En cada portal",
      tagline: "Anuncia tu inmueble en imopush — aparece en Idealista, Custojusto, OLX e Imovirtual automáticamente.",
      ctaPrimary: "Apuntarme a la waitlist",
      trust: "Gratis al lanzamiento · Un anuncio en cuatro portales · Cambios sincronizados",
    },
    how: {
      eyebrow: "cómo funciona",
      h: "Tres pasos. Cero logins de portal",
      intro: "Escribe el anuncio una vez. Nosotros nos ocupamos de las cuatro publicaciones y las mantenemos sincronizadas.",
      steps: [
        { n: "01", h: "Publica", p: "Sube fotos, precio y descripción en imopush — un editor, tus palabras." },
        { n: "02", h: "Distribuye", p: "Lo publicamos en cada portal de tu plan, con el formato adecuado." },
        { n: "03", h: "Edita", p: "Cambia un precio o una foto aquí. Los portales se actualizan el mismo día." },
      ],
    },
    portals: {
      eyebrow: "portales incluidos",
      h: "Cuatro destinos. Una edición",
      intro: "Tu anuncio llega a los cuatro portales que los anunciantes usan de verdad — sin tener cuatro cuentas.",
      meta: "publicación automática",
    },
    closing: {
      eyebrow: "para anunciantes",
      h: "Deja de subir cuatro veces. Hazlo una sola",
      ctaPrimary: "Apuntarme a la waitlist",
      badge: "próximamente",
    },
    footer: { left: "imopush — hecho en Lisboa", right: CONTACT_EMAIL },
  },
  fr: {
    nav: { back: `Retour à ${BRAND_NAME}`, cta: "Rejoindre la waitlist" },
    hero: {
      eyebrow: "pour les annonceurs",
      headline: "Publiez une fois. Sur chaque portail",
      tagline: "Annoncez votre bien sur imopush — il est publié sur Idealista, Custojusto, OLX et Imovirtual, automatiquement.",
      ctaPrimary: "Rejoindre la waitlist",
      trust: "Gratuit au lancement · Une annonce, quatre portails · Mises à jour synchronisées",
    },
    how: {
      eyebrow: "comment ça marche",
      h: "Trois étapes. Aucun login de portail",
      intro: "Rédigez l'annonce une fois. Nous gérons les quatre publications et les maintenons synchronisées à chaque édition.",
      steps: [
        { n: "01", h: "Publier", p: "Téléchargez photos, prix et description sur imopush — un éditeur, vos mots." },
        { n: "02", h: "Distribuer", p: "Nous publions sur chaque portail de votre plan, au bon format." },
        { n: "03", h: "Éditer", p: "Changez un prix ou une photo ici. Les portails se mettent à jour le jour même." },
      ],
    },
    portals: {
      eyebrow: "portails inclus",
      h: "Quatre destinations. Une édition",
      intro: "Votre annonce atteint les quatre portails que les annonceurs utilisent vraiment — sans avoir quatre comptes.",
      meta: "publication automatique",
    },
    closing: {
      eyebrow: "pour les annonceurs",
      h: "Arrêtez de publier quatre fois",
      ctaPrimary: "Rejoindre la waitlist",
      badge: "bientôt",
    },
    footer: { left: "imopush — fait à Lisbonne", right: CONTACT_EMAIL },
  },
};

function LandingNav({
  c,
  lang,
  setLang,
}: {
  c: Copy;
  lang: LangCode;
  setLang: (l: LangCode) => void;
}) {
  return (
    <Nav data-test-id="imopush-landing-nav">
      <NavBrand>
        <Link
          href="#top"
          aria-label="imopush home"
          className="brand"
          data-test-id="imopush-landing-brand"
        >
          <Wordmark word="imopush" variant="inline" className="ds-wordmark--reveal" />
        </Link>
      </NavBrand>
      <NavActions>
        <LangSwitcher
          langs={LANGS}
          value={lang}
          onChange={(code) => setLang(code as LangCode)}
          testIdPrefix="imopush-landing-lang"
        />
        <Link href={BRAND_URL} className="nav-link" data-test-id="imopush-landing-back">
          {c.nav.back}
        </Link>
        <Link
          href={WAITLIST_HREF}
          className="nav-cta"
          data-test-id="imopush-landing-cta"
        >
          {c.nav.cta}
        </Link>
      </NavActions>
    </Nav>
  );
}

function Hero({ c }: { c: Copy }) {
  return (
    <header className="ds-hero ds-hero--in" id="top" data-test-id="imopush-hero">
      <div className="ds-shell">
        <span className="ds-eyebrow">
          <span className="ds-eyebrow__idx">/ 01</span>
          <span>{c.hero.eyebrow}</span>
        </span>
        <h1 className="ds-hero__h ds-hero__h--dot">{c.hero.headline}</h1>
        <p className="ds-hero__tagline">{c.hero.tagline}</p>
        <div className="ds-hero__ctas">
          <Button
            href={WAITLIST_HREF}
            variant="primary"
            arrow
            data-test-id="imopush-hero-cta"
          >
            {c.hero.ctaPrimary}
          </Button>
        </div>
        <p className="ds-hero__trust">{c.hero.trust}</p>
      </div>
    </header>
  );
}

function HowItWorks({ c }: { c: Copy }) {
  return (
    <section className="ds-section" id="how-it-works">
      <div className="ds-shell">
        <header className="ds-section__head ds-reveal">
          <span className="ds-eyebrow">
            <span className="ds-eyebrow__idx">/ 02</span>
            <span>{c.how.eyebrow}</span>
          </span>
          <h2 className="ds-section__h ds-section__h--dot">{c.how.h}</h2>
          <p className="ds-section__intro">{c.how.intro}</p>
        </header>
        <div className="ds-feat-grid">
          {c.how.steps.map((s, i) => (
            <div
              key={s.n}
              className="ds-feat ds-reveal"
              style={{ ["--rd" as string]: `${i * 80}ms` } as React.CSSProperties}
              data-test-id={`imopush-how-step-${s.n}`}
            >
              <span className="ds-feat__num">/ {s.n}</span>
              <h3 className="ds-feat__h">{s.h}</h3>
              <p className="ds-feat__p">{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Portals({ c }: { c: Copy }) {
  return (
    <section className="ds-section" id="portals">
      <div className="ds-shell">
        <header className="ds-section__head ds-reveal">
          <span className="ds-eyebrow">
            <span className="ds-eyebrow__idx">/ 03</span>
            <span>{c.portals.eyebrow}</span>
          </span>
          <h2 className="ds-section__h ds-section__h--dot">{c.portals.h}</h2>
          <p className="ds-section__intro">{c.portals.intro}</p>
        </header>
        <div className="ds-feat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {PORTALS.map((name, i) => (
            <div
              key={name}
              className="ds-feat ds-reveal"
              style={{ ["--rd" as string]: `${i * 60}ms` } as React.CSSProperties}
              data-test-id={`imopush-portal-${name.toLowerCase()}`}
            >
              <span className="ds-feat__num">/ {String(i + 1).padStart(2, "0")}</span>
              <h3 className="ds-feat__h">{name}</h3>
              <p className="ds-feat__p">{c.portals.meta}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing({ c }: { c: Copy }) {
  return (
    <>
      <section className="ds-closing ds-reveal" id="cta">
        <div className="ds-shell">
          <div className="ds-closing__inner">
            <span className="ds-eyebrow">
              <span className="ds-eyebrow__idx">/ 04</span>
              <span>{c.closing.eyebrow}</span>
            </span>
            <h2 className="ds-closing__h">{c.closing.h}</h2>
            <div className="ds-closing__ctas">
              <Badge variant="live">{c.closing.badge}</Badge>
              <Button
                href={WAITLIST_HREF}
                variant="primary"
                arrow
                data-test-id="imopush-closing-cta"
              >
                {c.closing.ctaPrimary}
              </Button>
            </div>
          </div>
        </div>
      </section>
      <footer className="ds-footer-bar">
        <div className="ds-footer-bar__inner">
          <span>
            {c.footer.left} ·{" "}
            <Link href={BRAND_URL} data-test-id="imopush-footer-brand">
              {BRAND_NAME}
            </Link>
          </span>
          <span className="ds-footer-bar__links">
            <Link
              href={`mailto:${c.footer.right}`}
              data-test-id="imopush-footer-contact"
            >
              {c.footer.right}
            </Link>
          </span>
        </div>
      </footer>
    </>
  );
}

/**
 * Two small jobs that mirror the menu landing:
 *   - Flip `body.ds-loaded` post-paint so `.ds-reveal` opt-in animations
 *     start running (without JS the elements stay fully visible — no FOUC).
 *   - Drive `--ds-pageprog-progress` from scroll position so the
 *     `<PageProgress />` rail at the top fills as the page scrolls.
 */
function useLandingMotion() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.add("ds-loaded");
      });
    });

    const fill = document.querySelector<HTMLElement>(".ds-pageprog__fill");
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
    const els = document.querySelectorAll<HTMLElement>(".ds-reveal");
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

  useReveal([lang]);
  useLandingMotion();

  return (
    <div lang={lang}>
      <PageProgress />
      <LandingNav c={c} lang={lang} setLang={setLang} />
      <Hero c={c} />
      <HowItWorks c={c} />
      <Portals c={c} />
      <Closing c={c} />
    </div>
  );
}
