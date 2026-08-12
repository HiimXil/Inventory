import { AppShell } from "@/components/layout/AppShell";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoginForm } from "./components/LoginForm";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const rawCallbackUrl = resolvedSearchParams.callbackUrl;
  const callbackUrl = Array.isArray(rawCallbackUrl) ? rawCallbackUrl[0] : rawCallbackUrl;
  const rawError = resolvedSearchParams.error;
  const error = Array.isArray(rawError) ? rawError[0] : rawError;

  return (
    <AppShell>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm rounded-card border-2 border-border bg-paper p-6">
          <h1 className="mb-6 text-2xl font-bold text-ink">Connexion</h1>
          {error === "session-expired" && (
            <div className="mb-4">
              <ErrorState message="Votre session a expiré, reconnectez-vous." />
            </div>
          )}
          <LoginForm callbackUrl={callbackUrl} />
        </div>
      </div>
    </AppShell>
  );
}
