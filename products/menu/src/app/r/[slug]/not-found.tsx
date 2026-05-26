export default function NotFound() {
  return (
    <main className="ds-shell flex min-h-screen flex-col items-center justify-center gap-3 text-center" style={{ maxWidth: 520 }}>
      <h1 className="font-serif text-[clamp(28px,7vw,40px)] italic">Menu not found<span className="dot">.</span></h1>
      <p className="text-sm text-muted-foreground">
        The restaurant you&rsquo;re looking for doesn&rsquo;t exist.
      </p>
    </main>
  )
}
