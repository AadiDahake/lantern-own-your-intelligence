import { redirect } from "next/navigation";
import { ConsoleNav } from "@/components/console/ConsoleNav";
import { currentAccount } from "@/lib/auth/server";
import { projectDisplayName } from "@/lib/console/project";
import { ensureProject } from "@/lib/console/provision";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // The middleware already turns anonymous visitors away; this is the belt to its braces, and it
  // is what gives the nav the signed-in account to show.
  const account = await currentAccount();
  if (!account) redirect("/signin");

  const project = await ensureProject(account);

  return (
    <div className="app-shell">
      <ConsoleNav
        email={account.email}
        company={projectDisplayName(project)}
        githubLogin={project.githubLogin}
      />
      <main className="console-page">{children}</main>
    </div>
  );
}
