interface Step {
  title: string;
  description?: React.ReactNode;
  content?: React.ReactNode;
}

interface StepsProps {
  steps: Step[];
}

export function Steps({ steps }: StepsProps) {
  return (
    <div className="my-6 space-y-4">
      {steps.map((step, i) => (
        <div
          key={i}
          className="flex gap-4 p-4 rounded-lg border border-border/40 bg-card/30"
        >
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold">
            {i + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground mb-1">{step.title}</div>
            {step.description && (
              <p className="text-sm text-muted-foreground mb-3">{step.description}</p>
            )}
            {step.content}
          </div>
        </div>
      ))}
    </div>
  );
}

// Success step (checkmark instead of number)
interface SuccessStepProps {
  title: string;
  description?: React.ReactNode;
}

export function SuccessStep({ title, description }: SuccessStepProps) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border border-[#7fd88f]/30 bg-[#7fd88f]/5">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#7fd88f]/20 text-[#7fd88f] flex items-center justify-center">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <div className="flex-1">
        <div className="font-medium text-foreground mb-1">{title}</div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
