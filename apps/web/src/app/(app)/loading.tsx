export default function Loading() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลด">
      <div className="mb-6 space-y-2">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton h-4 w-72" />
      </div>
      <div className="space-y-2 rounded-xl bg-white p-4 shadow-card ring-1 ring-gray-200/80">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-10" style={{ opacity: 1 - i * 0.12 }} />
        ))}
      </div>
    </div>
  );
}
