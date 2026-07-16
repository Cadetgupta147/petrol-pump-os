interface ComingSoonProps {
  title: string;
  items: string[];
}

// Renders a visibly-empty placeholder instead of fabricated numbers. Every
// label here corresponds to a real gap: either the Prisma model exists but
// has no service/controller yet (LoyaltyConfig, PurchaseEntry, LubricantItem,
// AttendanceLog), or nothing models it at all (machine testing/calibration).
export function ComingSoon({ title, items }: ComingSoonProps) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-title">{title.toUpperCase()} — NOT WIRED YET</div>
      <div className="coming-soon-chips">
        {items.map((item) => (
          <span key={item} className="chip">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
