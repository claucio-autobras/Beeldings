import ProjectDetailClient from './ProjectDetailClient';

export const metadata = { title: 'Gateway — Beeldings' };

interface Props {
  params: Promise<{ projectId: string }>;
}

export default async function Page({ params }: Props) {
  const { projectId } = await params;
  return <ProjectDetailClient projectId={projectId} />;
}
