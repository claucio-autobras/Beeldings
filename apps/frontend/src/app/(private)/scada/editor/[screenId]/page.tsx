import ScadaEditorPage from '@/modules/scada/pages/scada-editor.page';

export const metadata = { title: 'Editor SCADA — BlueBee IoT' };

interface Props {
  params: Promise<{ screenId: string }>;
}

export default async function Page({ params }: Props) {
  const { screenId } = await params;
  return <ScadaEditorPage screenId={screenId} />;
}
