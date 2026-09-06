import { Suspense } from 'react';
import InfraspeakPage from '@/modules/infraspeak/pages/infraspeak.page';

export default function InfraspeakRoutePage() {
  return (
    <Suspense>
      <InfraspeakPage />
    </Suspense>
  );
}
