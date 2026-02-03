import { Layout } from "@/components/layout/Layout"
import { ConnectionGate } from "@/components/layout/ConnectionGate"
import { GoogleOAuthProvider } from "@react-oauth/google"

export default function App() {
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as
    | string
    | undefined
  const content = (
    <ConnectionGate>
      <Layout />
    </ConnectionGate>
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
