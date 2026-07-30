import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ screenId: string }>;
}

// Redirect to the standalone fullscreen viewer
export default async function Page({ params }: Props) {
  const { screenId } = await params;
  redirect(`/scada-view/${screenId}`);
}
