import type { Metadata } from "next";
import { CalendarClock, MailQuestion } from "lucide-react";
import { resolveInformationRequest } from "@/server/editorial/information-requests";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { RespondForm } from "./respond-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Answer an information request", robots: { index: false, follow: false } };

/** The newsletter that asked. Named rather than assumed: this page is public and personal. */
function Masthead({ newsletterName, label }: { newsletterName: string; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative inline-block size-7 rounded-full bg-brand" aria-hidden>
        <span className="absolute -left-1 top-2 size-2.5 rounded-full bg-primary" />
      </span>
      <div className="leading-tight">
        <div className="font-serif text-lg font-semibold tracking-tight text-primary">{newsletterName}</div>
        {label ? <div className="text-xs text-muted-foreground">{label}</div> : null}
      </div>
    </div>
  );
}

export default async function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveInformationRequest(token);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:py-12">
      <Masthead newsletterName={resolved.state === "valid" ? resolved.publicationName : "Briefly"} label={resolved.state === "valid" ? resolved.editionLabel : undefined} />
      {resolved.state === "invalid" ? (
        <Alert variant="destructive">
          <MailQuestion />
          <AlertTitle>This link is not valid</AlertTitle>
          <AlertDescription>
            <p>Check the address you received by email, or ask the newsroom to send you a new link.</p>
          </AlertDescription>
        </Alert>
      ) : resolved.state === "expired" ? (
        <Alert variant="warning">
          <CalendarClock />
          <AlertTitle>This link has expired</AlertTitle>
          <AlertDescription>
            <p>The request about “{resolved.storyTitle}” is closed. Reply to the newsroom&apos;s email if you still have details to share.</p>
          </AlertDescription>
        </Alert>
      ) : resolved.state === "answered" ? (
        <Alert variant="success">
          <AlertTitle>Already answered — thank you</AlertTitle>
          <AlertDescription>
            <p>
              Your answers about “{resolved.storyTitle}” were received{resolved.answeredAt ? ` on ${formatDate(resolved.answeredAt)}` : ""}. Nothing more to do.
            </p>
          </AlertDescription>
        </Alert>
      ) : resolved.state === "cancelled" ? (
        <Alert variant="info">
          <AlertTitle>This request was withdrawn</AlertTitle>
          <AlertDescription>
            <p>The editors no longer need details about “{resolved.storyTitle}”.</p>
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="gap-5 py-5">
          <CardHeader className="gap-2 px-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand">Information request</Badge>
              <span className="text-xs text-muted-foreground">Answer by {formatDate(resolved.request.expiresAt)}</span>
            </div>
            <CardTitle className="font-serif text-xl leading-tight font-semibold">{resolved.storyTitle}</CardTitle>
            <CardDescription className="text-sm leading-relaxed whitespace-pre-line text-foreground/80">{resolved.request.message}</CardDescription>
            {resolved.requesterName ? <p className="text-xs text-muted-foreground">Asked by {resolved.requesterName}, {resolved.publicationName} newsroom</p> : null}
          </CardHeader>
          <CardContent className="px-5">
            <RespondForm token={token} items={resolved.request.items.map((i) => ({ key: i.key, label: i.label }))} />
          </CardContent>
        </Card>
      )}
      <p className="text-center text-xs text-muted-foreground">{resolved.state === "valid" ? resolved.publicationName : ""}</p>
    </main>
  );
}
