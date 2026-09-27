/** Streamed instantly while the server fetches data — same shape as the page, so nothing jumps. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลด">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="skeleton h-7 w-40" />
          <div className="skeleton h-4 w-56" />
        </div>
        <div className="skeleton h-9 w-80" />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[104px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-2 rounded-xl bg-white p-4 shadow-card ring-1 ring-gray-200/80">
          <div className="skeleton h-14" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-12" style={{ opacity: 1 - i * 0.15 }} />
          ))}
        </div>
        <div className="skeleton hidden h-80 rounded-xl lg:block" />
      </div>
    </div>
  );
}
