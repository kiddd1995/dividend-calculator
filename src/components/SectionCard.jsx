export default function SectionCard({
  eyebrow,
  title,
  description,
  children,
  className = '',
}) {
  return (
    <section className={`card ${className}`}>
      <div className="section-heading">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  )
}
