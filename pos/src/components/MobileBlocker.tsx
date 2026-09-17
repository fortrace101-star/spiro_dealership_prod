export default function MobileBlocker() {
  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-[#0c1210]">
      <div className="card w-full max-w-md px-8 py-10 text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center mb-5">
          {/* Desktop / monitor icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8 text-brand-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <rect x="2" y="4" width="20" height="13" rx="2" />
            <path d="M8 21h8" strokeLinecap="round" />
            <path d="M12 17v4" strokeLinecap="round" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-white mb-2">Desktop required</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          The Spiro POS is not available on mobile devices or tablets. Please open this application
          on a desktop or laptop computer to continue.
        </p>
      </div>
    </div>
  )
}
