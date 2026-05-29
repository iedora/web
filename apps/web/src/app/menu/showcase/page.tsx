import Link from "next/link";
import {
  Badge,
  Breadcrumb,
  BreadcrumbHere,
  BreadcrumbLink,
  Button,
  Card,
  CardDesc,
  CardFoot,
  CardIndex,
  CardTitle,
  CardVisual,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  FieldHint,
  FieldInput,
  FieldLabel,
  Lintel,
  MetaStrip,
  Statement,
  Tab,
  Table,
  TableRowNum,
  Tabs,
  Td,
  Th,
  Toast,
  Toggle,
  Wordmark,
} from "@iedora/design-system";

const palette = [
  { name: "paper", token: "--paper", hex: "#EFE8DA" },
  { name: "paper-2", token: "--paper-2", hex: "#E7DFCF" },
  { name: "paper-3", token: "--paper-3", hex: "#DDD3BF" },
  { name: "ink", token: "--ink", hex: "#1A1815" },
  { name: "ink-85", token: "--ink-85", hex: "85% ink" },
  { name: "ink-70", token: "--ink-70", hex: "70% ink" },
  { name: "ink-55", token: "--ink-55", hex: "55% ink" },
  { name: "ink-40", token: "--ink-40", hex: "40% ink" },
  { name: "ink-22", token: "--ink-22", hex: "22% ink" },
  { name: "ink-14", token: "--ink-14", hex: "14% ink" },
  { name: "ink-08", token: "--ink-08", hex: "08% ink" },
  { name: "ink-04", token: "--ink-04", hex: "04% ink" },
  { name: "cinnabar", token: "--cinnabar", hex: "#B83A26" },
  { name: "cinnabar-deep", token: "--cinnabar-deep", hex: "#8E2A1A" },
];

const typeScale = [
  { tag: "display", size: 88, opsz: 144, weight: 300, var: "--t-display", sample: "A quiet house" },
  { tag: "5xl", size: 80, opsz: 144, weight: 300, var: "--t-5xl", sample: "Slowly." },
  { tag: "4xl", size: 64, opsz: 96, weight: 300, var: "--t-4xl", sample: "A roof, first" },
  { tag: "3xl", size: 44, opsz: 72, weight: 400, var: "--t-3xl", sample: "Section heading" },
  { tag: "2xl", size: 30, opsz: 32, weight: 400, var: "--t-2xl", sample: "Card title or subhead" },
  { tag: "xl", size: 21, opsz: 14, weight: 300, var: "--t-xl", sample: "A statement, set in italic.", italic: true, color: "var(--ink-70)" },
  { tag: "lg", size: 16.5, opsz: 14, weight: 400, var: "--t-lg", sample: "Body prose, the workhorse.", color: "var(--ink-70)" },
  { tag: "md", size: 15, opsz: 14, weight: 400, var: "--t-md", sample: "Card descriptions.", color: "var(--ink-70)" },
];

const spacing = [
  { tag: "--s-1", px: 4, role: "Inline gap, dot-to-glyph" },
  { tag: "--s-2", px: 8, role: "Tight, badge padding" },
  { tag: "--s-3", px: 12, role: "Button gaps, inline" },
  { tag: "--s-4", px: 16, role: "Card grid gutter" },
  { tag: "--s-5", px: 22, role: "Card inner padding" },
  { tag: "--s-6", px: 28, role: "Subhead spacing" },
  { tag: "--s-7", px: 36, role: "Section internal gap" },
  { tag: "--s-8", px: 48, role: "Above subheads" },
  { tag: "--s-9", px: 64, role: "Section breathing" },
  { tag: "--s-10", px: 88, role: "Section top padding" },
  { tag: "--s-11", px: 120, role: "Cover & chapter breaks" },
  { tag: "--s-12", px: 160, role: "Editorial silence" },
];

export default function ShowcasePage() {
  return (
    <div className="ds-root ds-root--washed" style={{ minHeight: "100vh" }}>
      <div
        style={{
          width: "min(1320px, 100%)",
          margin: "0 auto",
          padding: "36px 56px 120px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <MetaStrip
          left={
            <>
              <span>MMXXVI · Ed. I</span>
              <span>Iedora · Design system</span>
            </>
          }
          center={<span>Showcase</span>}
          right={<Link href="/">Back to menu</Link>}
        />

        <Section index="01" name="Wordmark" note="Letter-by-letter Fraunces; the dot is cinnabar.">
          <div style={{ padding: "48px 0 24px" }}>
            <Wordmark variant="display" />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 32,
              paddingBottom: 24,
              borderTop: "1px solid var(--ink-14)",
              paddingTop: 24,
            }}
          >
            <Wordmark variant="inline" />
            <span className="ds-key" style={{ marginBottom: 0 }}>
              variant=inline · top-of-form bar
            </span>
          </div>
        </Section>

        <Section index="02" name="Statement" note="Italic Fraunces; wrap a word in <em> to upright it.">
          <div style={{ padding: "32px 0", maxWidth: 560 }}>
            <Statement>
              A quiet house for <em>digital craftsmanship</em>. A roof over
              independent <em>works</em>, made slowly, kept carefully.
            </Statement>
          </div>
        </Section>

        <Section index="03" name="Color" note="Three voices, with the ink ladder. Cinnabar is the accent, used once.">
          <Palette />
          <RatioBar />
        </Section>

        <Section index="04" name="Typography" note="Fraunces (variable, opsz 144 at display) + JetBrains Mono.">
          <TypeScale />
        </Section>

        <Section index="05" name="Spacing scale" note="Built on a 4-pixel baseline.">
          <SpacingScale />
        </Section>

        <Section index="06" name="Button" note="VI.1 — Mono label, ink border, square. Hover inverts ink and paper.">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "32px 0" }}>
            <Button arrow>Begin a work</Button>
            <Button variant="solid" arrow>Read the rooms</Button>
            <Button variant="ghost" arrow>Quietly</Button>
            <Button variant="primary" arrow>Send</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section index="07" name="Badge" note="VI.2 — The only round corner in the system.">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "32px 0" }}>
            <Badge>In study</Badge>
            <Badge variant="live">In service</Badge>
            <Badge variant="ink">Reserved</Badge>
            <Badge variant="accent">New</Badge>
            <Badge variant="ghost">Concept</Badge>
          </div>
        </Section>

        <Section index="08" name="Card" note="VI.3 — A room on the page. Hover lifts the border to ink.">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
              padding: "32px 0",
            }}
          >
            <Card style={{ maxWidth: 340 }}>
              <CardIndex>
                <span>Work № 01</span>
                <Badge variant="live">In service</Badge>
              </CardIndex>
              <CardVisual />
              <CardTitle>menu</CardTitle>
              <CardDesc>A QR menu system for restaurants, with quiet, deep analytics.</CardDesc>
              <CardFoot>
                <span>QR · Menu · Analytics</span>
                <span style={{ color: "var(--ink)" }}>menu.iedora.com</span>
              </CardFoot>
            </Card>
            <Card style={{ maxWidth: 340 }}>
              <CardIndex>
                <span>Work № 02</span>
                <Badge>In study</Badge>
              </CardIndex>
              <CardVisual />
              <CardTitle>·</CardTitle>
              <CardDesc>A room kept open. The next work hasn&apos;t been named yet.</CardDesc>
              <CardFoot>
                <span>Forthcoming</span>
                <span>·</span>
              </CardFoot>
            </Card>
          </div>
        </Section>

        <Section index="09" name="Field, check, toggle" note="VI.4 — No box. A line under the words.">
          <div style={{ display: "grid", gap: 32, padding: "32px 0", maxWidth: 480 }}>
            <Field>
              <FieldLabel htmlFor="ex-email">Email address</FieldLabel>
              <FieldInput id="ex-email" name="email" type="email" placeholder="name@iedora.com" />
              <FieldHint>We write back, slowly.</FieldHint>
            </Field>
            <Field error>
              <FieldLabel htmlFor="ex-slug">Slug</FieldLabel>
              <FieldInput id="ex-slug" name="slug" defaultValue="menu" />
              <FieldHint>Already taken.</FieldHint>
            </Field>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Checkbox checked readOnly name="kept">Keep this work in service</Checkbox>
              <Checkbox readOnly name="notify">Notify on a quiet release</Checkbox>
              <Toggle checked readOnly name="analytics">Analytics</Toggle>
              <Toggle readOnly name="newsletter">Newsletter</Toggle>
            </div>
          </div>
        </Section>

        <Section index="10" name="Table" note="VI.5 — Mono head, serif rows, hairline divisions.">
          <div style={{ padding: "32px 0" }}>
            <Table>
              <thead>
                <tr>
                  <Th style={{ width: 60 }}>№</Th>
                  <Th>Work</Th>
                  <Th>Discipline</Th>
                  <Th>State</Th>
                  <Th>Year</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td><TableRowNum>01</TableRowNum></Td>
                  <Td>menu</Td>
                  <Td style={{ color: "var(--ink-70)" }}>QR · Analytics</Td>
                  <Td><Badge variant="live">In service</Badge></Td>
                  <Td style={{ fontFamily: "var(--mono)", color: "var(--ink-55)" }}>MMXXIV</Td>
                </tr>
                <tr>
                  <Td><TableRowNum>02</TableRowNum></Td>
                  <Td style={{ color: "var(--ink-40)", fontStyle: "italic" }}>forthcoming</Td>
                  <Td style={{ color: "var(--ink-70)" }}>Concept</Td>
                  <Td><Badge>In study</Badge></Td>
                  <Td style={{ fontFamily: "var(--mono)", color: "var(--ink-55)" }}>MMXXVI</Td>
                </tr>
                <tr>
                  <Td><TableRowNum>03</TableRowNum></Td>
                  <Td style={{ color: "var(--ink-40)", fontStyle: "italic" }}>a room kept open</Td>
                  <Td style={{ color: "var(--ink-40)" }}>·</Td>
                  <Td><Badge variant="ghost">Reserved</Badge></Td>
                  <Td style={{ fontFamily: "var(--mono)", color: "var(--ink-55)" }}>·</Td>
                </tr>
              </tbody>
            </Table>
          </div>
        </Section>

        <Section index="11" name="Dialog" note="VI.6 — Radix-backed. Focus trap, Escape to dismiss, asChild trigger composition.">
          <div
            style={{
              padding: "32px 0",
              background: "var(--paper-2)",
              display: "grid",
              placeItems: "center",
              minHeight: 120,
            }}
          >
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="solid" arrow>Open dialog</Button>
              </DialogTrigger>
              <DialogContent eyebrow="Dialog · Confirm">
                <DialogHeader>
                  <DialogTitle>Send a quiet note?</DialogTitle>
                  <DialogDescription>
                    We will read it carefully and reply in our time. Iedora is
                    small; the inbox is, too.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="solid" arrow>Send</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </Section>

        <Section index="12" name="Toast" note="VI.7 — Quiet by default; cinnabar means stop.">
          <div style={{ display: "grid", gap: 12, padding: "32px 0", maxWidth: 360 }}>
            <Toast variant="ok" title="Saved">The work was kept.</Toast>
            <Toast title="Note">A draft is waiting in the side room.</Toast>
            <Toast variant="warn" title="Stop">This room is currently being tended.</Toast>
          </div>
        </Section>

        <Section index="13" name="Empty state" note="VI.8 — Honest about not-yet.">
          <div style={{ padding: "32px 0", maxWidth: 480 }}>
            <EmptyState
              label="Forthcoming"
              note="No work to show in this room yet. A room kept open, on purpose."
            />
          </div>
        </Section>

        <Section index="14" name="Tabs & breadcrumb" note="VI.9 — Mono, never serif.">
          <div style={{ display: "grid", gap: 22, padding: "32px 0" }}>
            <Tabs>
              <Tab active>Works</Tab>
              <Tab>About</Tab>
              <Tab>Contact</Tab>
            </Tabs>
            <Breadcrumb>
              <BreadcrumbLink href="/">Studio</BreadcrumbLink>
              <BreadcrumbLink href="/works">Works</BreadcrumbLink>
              <BreadcrumbHere>menu</BreadcrumbHere>
            </Breadcrumb>
          </div>
        </Section>

        <Section index="15" name="Lintel" note="Editorial chrome — top bar for forms.">
          <div style={{ padding: "32px 0" }}>
            <Lintel
              end={
                <span className="ds-key" style={{ marginBottom: 0 }}>
                  Contact
                </span>
              }
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  index,
  name,
  note,
  children,
}: {
  index: string;
  name: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ paddingTop: 64 }}>
      <header
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "baseline",
          gap: 24,
          paddingBottom: 14,
          borderBottom: "1px solid var(--ink-22)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: "var(--t-xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--cinnabar)",
          }}
        >
          / {index}
        </span>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--serif)",
            fontWeight: 300,
            fontVariationSettings: '"opsz" 144',
            fontSize: 36,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
          }}
        >
          {name}
        </h2>
        {note ? (
          <span
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--ink-55)",
              maxWidth: 420,
              textAlign: "right",
            }}
          >
            {note}
          </span>
        ) : (
          <span aria-hidden />
        )}
      </header>
      {children}
    </section>
  );
}

function Palette() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 1,
        background: "var(--ink-14)",
        border: "1px solid var(--ink-14)",
        marginTop: 24,
      }}
    >
      {palette.map((c) => (
        <div key={c.name} style={{ background: "var(--paper)", padding: 18 }}>
          <div
            aria-hidden
            style={{
              height: 56,
              background: `var(${c.token})`,
              border:
                c.name.startsWith("ink-1") ||
                c.name.startsWith("ink-2") ||
                c.name.startsWith("ink-0")
                  ? "1px dashed var(--ink-22)"
                  : "0",
            }}
          />
          <div style={{ paddingTop: 12 }}>
            <div className="ds-key" style={{ marginBottom: 2 }}>
              {c.name}
            </div>
            <div
              style={{
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 14,
                color: "var(--ink-70)",
              }}
            >
              {c.hex}
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--cinnabar)",
                marginTop: 2,
              }}
            >
              {c.token}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RatioBar() {
  return (
    <div style={{ marginTop: 32 }}>
      <div
        style={{
          display: "flex",
          border: "1px solid var(--ink-14)",
          height: 56,
          alignItems: "stretch",
        }}
      >
        <span
          style={{
            background: "var(--paper)",
            flex: 74,
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.16em",
            color: "var(--ink-55)",
          }}
        >
          74
        </span>
        <span
          style={{
            background: "var(--ink)",
            color: "var(--paper)",
            flex: 22,
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.16em",
          }}
        >
          22
        </span>
        <span
          style={{
            background: "var(--cinnabar)",
            color: "var(--paper)",
            flex: 4,
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.16em",
          }}
        >
          04
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 28,
          marginTop: 12,
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "0.14em",
          color: "var(--ink-55)",
        }}
      >
        <span>Paper · 74%</span>
        <span>Ink · 22%</span>
        <span>Cinnabar · 4%</span>
      </div>
    </div>
  );
}

function TypeScale() {
  return (
    <div style={{ marginTop: 24, borderTop: "1px solid var(--ink-14)" }}>
      {typeScale.map((t) => (
        <div
          key={t.tag}
          style={{
            display: "grid",
            gridTemplateColumns: "80px 1fr 140px 80px",
            alignItems: "baseline",
            gap: 16,
            padding: "20px 0",
            borderBottom: "1px solid var(--ink-14)",
          }}
        >
          <span className="ds-key" style={{ marginBottom: 0 }}>{t.tag}</span>
          <span
            style={{
              fontFamily: "var(--serif)",
              fontSize: t.size,
              fontWeight: t.weight,
              fontStyle: t.italic ? "italic" : "normal",
              fontVariationSettings: `"opsz" ${t.opsz}`,
              color: t.color ?? "var(--ink)",
              letterSpacing: t.size > 40 ? "-0.025em" : "0",
              lineHeight: 1.1,
            }}
          >
            {t.sample}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--cinnabar)",
            }}
          >
            {t.var}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-55)",
              textAlign: "right",
            }}
          >
            {t.size} px
          </span>
        </div>
      ))}
    </div>
  );
}

function SpacingScale() {
  return (
    <div style={{ marginTop: 24 }}>
      {spacing.map((s) => (
        <div
          key={s.tag}
          style={{
            display: "grid",
            gridTemplateColumns: "80px 200px 60px 1fr",
            alignItems: "center",
            gap: 16,
            padding: "10px 0",
            borderBottom: "1px solid var(--ink-14)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--cinnabar)",
            }}
          >
            {s.tag}
          </span>
          <span
            style={{
              display: "block",
              width: s.px,
              height: 6,
              background: "var(--ink)",
            }}
          />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink)", textAlign: "right" }}>
            {s.px} px
          </span>
          <span
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--ink-70)",
            }}
          >
            {s.role}
          </span>
        </div>
      ))}
    </div>
  );
}
