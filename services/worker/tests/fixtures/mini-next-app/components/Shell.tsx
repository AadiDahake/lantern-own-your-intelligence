import { HeaderActions } from "@/components/HeaderActions";
import { Sidebar } from "@/components/Sidebar";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b border-line px-6">
          <HeaderActions />
        </header>
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
