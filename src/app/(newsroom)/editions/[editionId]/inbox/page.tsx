import { Construction } from "lucide-react";
import { PageBody } from "@/components/newsroom/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export default function Placeholder() {
  return (
    <PageBody>
      <EmptyState icon={Construction} title="Inbox is being assembled" description="This screen is part of the current build and will replace this placeholder." />
    </PageBody>
  );
}
