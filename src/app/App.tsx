import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function App() {
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Publication List Generator</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>
            Build an auto-updating publication list from ORCID, PubMed and
            researchmap, then embed it on your lab website.
          </p>
          <p className="mt-2">The wizard is not implemented yet.</p>
        </CardContent>
      </Card>
    </main>
  )
}
