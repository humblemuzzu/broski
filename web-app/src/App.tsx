import { ConnectionGate, Layout } from "@/components/layout"
import { GoogleOAuthProvider } from "@react-oauth/google"
import { ThemeProvider } from "@/theme/ThemeProvider"
import { AppErrorBoundary } from "@/components/layout/AppErrorBoundary"

export default function App() {
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as
    | string
    | undefined
  const content = (
    <ThemeProvider>
      <AppErrorBoundary>
        <ConnectionGate>
          <Layout />
        </ConnectionGate>
      </AppErrorBoundary>
    </ThemeProvider>
  )

  if (googleClientId && googleClientId.trim().length > 0) {
    return (
      <GoogleOAuthProvider clientId={googleClientId.trim()}>
        {content}
      </GoogleOAuthProvider>
    )
  }

  return (
    <>{content}</>
  )
}
