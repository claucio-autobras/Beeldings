import { Suspense } from 'react';
import AlarmsPage from '@/modules/alarms/pages/alarms.page';

export default function AlarmsRoutePage() {
  return (
    <Suspense>
      <AlarmsPage />
    </Suspense>
  );
}
