import ScadaViewerPage from '@/modules/scada/pages/scada-viewer.page';

export const metadata = { title: 'SCADA Viewer — Beeldings' };

interface Props {
  params: Promise<{ screenId: string }>;
}

export default async function Page({ params }: Props) {
  const { screenId } = await params;
  return <ScadaViewerPage screenId={screenId} />;
}
