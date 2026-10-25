import { ProjectProvider } from "@/components/project/ProjectProvider";
import { Shell } from "@/components/project/Shell";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProjectProvider id={id}>
      <Shell>{children}</Shell>
    </ProjectProvider>
  );
}
