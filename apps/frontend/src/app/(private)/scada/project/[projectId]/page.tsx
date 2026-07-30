import ScadaProjectPage from '@/modules/scada/pages/scada-project.page';

export const metadata = { title: 'Projeto SCADA — BlueBee IoT' };

interface Props {
  params: Promise<{ projectId: string }>;
}

export default async function Page({ params }: Props) {
  const { projectId } = await params;
  return <ScadaProjectPage projectId={projectId} />;
}
