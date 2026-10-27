import { DemoStoreProvider } from "@/components/store";
import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <DemoStoreProvider>
      <Dashboard />
    </DemoStoreProvider>
  );
}
