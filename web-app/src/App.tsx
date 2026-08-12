import { ConnectionGate, Layout } from "@/components/layout"
import { ThemeProvider } from "@/theme/ThemeProvider"
import { AppErrorBoundary } from "@/components/layout/AppErrorBoundary"

export default function App() {
  return (
    <ThemeProvider>
      <AppErrorBoundary>
        <ConnectionGate>
          <Layout />
        </ConnectionGate>
      </AppErrorBoundary>
    </ThemeProvider>
  )
}
