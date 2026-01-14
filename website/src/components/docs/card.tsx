import Link from "next/link";

interface CardProps {
  title: string;
  description?: string;
  href?: string;
  icon?: React.ReactNode;
}

export function Card({ title, description, href, icon }: CardProps) {
  const content = (
    <div className="p-4 rounded-lg border border-border/40 bg-card/30 hover:border-primary/30 hover:bg-card/50 transition-colors">
      {icon && <div className="mb-3 text-primary">{icon}</div>}
      <div className="font-medium text-foreground mb-1">{title}</div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

interface CardGridProps {
  children: React.ReactNode;
  columns?: 2 | 3;
}

export function CardGrid({ children, columns = 2 }: CardGridProps) {
  return (
    <div className={`grid gap-4 my-6 ${columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
      {children}
    </div>
  );
}

// Feature card with colored indicator
interface FeatureCardProps {
  title: string;
  description: string;
  color?: "primary" | "accent" | "green" | "amber";
}

const dotColors = {
  primary: "bg-primary",
  accent: "bg-accent",
  green: "bg-[#7fd88f]",
  amber: "bg-[#f5a742]",
};

export function FeatureCard({ title, description, color = "primary" }: FeatureCardProps) {
  return (
    <div className="p-4 rounded-lg border border-border/40 bg-card/30">
      <div className="font-medium text-foreground mb-2 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColors[color]}`} />
        {title}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
