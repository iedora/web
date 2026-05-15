import Link from 'next/link'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Link
        href="/"
        className="mb-6 inline-flex items-baseline gap-2 text-foreground no-underline"
        aria-label="Meta Menu home"
      >
        <span
          aria-hidden="true"
          className="translate-y-[2px] font-serif text-[22px] italic leading-none text-brand"
        >
          ⁋
        </span>
        <span className="text-[15px] font-semibold tracking-tight">
          Meta <em className="font-serif italic font-medium">Menu</em>
        </span>
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
