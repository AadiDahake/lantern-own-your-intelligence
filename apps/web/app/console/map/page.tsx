import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ProductMap } from "@/components/console/map/ProductMap";
import { currentProjectOrNull } from "@/lib/console/current";
import { listKnownRoutes, loadGraph } from "@/lib/graph/store";

export const dynamic = "force-dynamic";

export default async function ProductMapPage() {
  const project = await currentProjectOrNull();
  if (!project) redirect("/signin");

  const [graph, routes] = await Promise.all([loadGraph(project.id), listKnownRoutes(project.id)]);

  return (
    <>
      <PageHeader
        eyebrow="Product map"
        title="What the agent knows about the product"
        description="The pages, controls and moves between them that guidance plans routes over."
      />
      <ProductMap initialGraph={graph} initialRoutes={routes} siteUrl={project.siteUrl} />
    </>
  );
}
