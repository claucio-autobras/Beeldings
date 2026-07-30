import ProjectDetailClient from './ProjectDetailClient';

export const metadata = { title: 'Projeto — BlueBee IoT' };

interface Props {
  params: Promise<{ projectId: string }>;
}

export default async function Page({ params }: Props) {
  const { projectId } = await params;
  return <ProjectDetailClient projectId={projectId} />;
}
