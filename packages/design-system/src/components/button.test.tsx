import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";

describe("Button", () => {
  it("defaults to the secondary variant + base class", () => {
    const html = renderToStaticMarkup(<Button>Begin</Button>);
    expect(html).toMatch(/^<button[^>]*class="ds-btn ds-btn--secondary"/);
  });

  it("defaults to type='button' to avoid form-submit surprises", () => {
    const html = renderToStaticMarkup(<Button>Begin</Button>);
    expect(html).toContain('type="button"');
  });

  it("respects an explicit submit type", () => {
    const html = renderToStaticMarkup(<Button type="submit">Send</Button>);
    expect(html).toContain('type="submit"');
  });

  describe("variants", () => {
    it.each([
      ["primary",   "ds-btn--primary"],
      ["secondary", "ds-btn--secondary"],
      ["solid",     "ds-btn--solid"],
      ["ghost",     "ds-btn--ghost"],
      ["danger",    "ds-btn--danger"],
    ] as const)("%s → %s", (variant, klass) => {
      const html = renderToStaticMarkup(<Button variant={variant}>x</Button>);
      expect(html).toContain(`class="ds-btn ${klass}"`);
    });

  });

  describe("sizes", () => {
    it("md (default) emits no size class", () => {
      const html = renderToStaticMarkup(<Button>x</Button>);
      expect(html).not.toContain("ds-btn--sm");
      expect(html).not.toContain("ds-btn--lg");
    });

    it.each([
      ["sm", "ds-btn--sm"],
      ["lg", "ds-btn--lg"],
    ] as const)("%s emits %s", (size, klass) => {
      const html = renderToStaticMarkup(<Button size={size}>x</Button>);
      expect(html).toContain(klass);
    });
  });

  describe("loading state", () => {
    it("emits the spinner, the modifier class, and busy/disabled state", () => {
      const html = renderToStaticMarkup(<Button loading>Send</Button>);
      expect(html).toContain("ds-btn--loading");
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("disabled");
      expect(html).toContain("ds-btn__spinner");
    });

    it("suppresses the arrow while loading", () => {
      const html = renderToStaticMarkup(
        <Button loading arrow>
          Send
        </Button>,
      );
      expect(html).not.toContain("ds-btn__arrow");
    });
  });

  it("renders a default cinnabar arrow when arrow=true", () => {
    const html = renderToStaticMarkup(<Button arrow>Begin</Button>);
    expect(html).toContain(
      '<span class="ds-btn__arrow" aria-hidden="true">↗</span>',
    );
  });

  it("renders a custom arrow node when arrow is a ReactNode", () => {
    const html = renderToStaticMarkup(<Button arrow={<>→</>}>Begin</Button>);
    expect(html).toContain(
      '<span class="ds-btn__arrow" aria-hidden="true">→</span>',
    );
  });

  it("omits the arrow when arrow is unset / falsy", () => {
    const html = renderToStaticMarkup(<Button>Begin</Button>);
    expect(html).not.toContain("ds-btn__arrow");
  });

  it("renders as <a> when href is provided", () => {
    const html = renderToStaticMarkup(
      <Button href="/works" variant="solid">
        Read the rooms
      </Button>,
    );
    expect(html).toMatch(/^<a[^>]*href="\/works"[^>]*>/);
    expect(html).toContain('class="ds-btn ds-btn--solid"');
    expect(html).not.toContain("<button");
  });

  it("forwards arbitrary html attributes including disabled and aria-label", () => {
    const html = renderToStaticMarkup(
      <Button disabled aria-label="Submit form">
        x
      </Button>,
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Submit form"');
  });

  it("appends a custom className alongside the base class", () => {
    const html = renderToStaticMarkup(<Button className="my-cta">x</Button>);
    expect(html).toContain('class="ds-btn ds-btn--secondary my-cta"');
  });

  it("wraps children in a <span> so the arrow lays out next to them", () => {
    const html = renderToStaticMarkup(<Button>Begin a work</Button>);
    expect(html).toContain("<span>Begin a work</span>");
  });
});
