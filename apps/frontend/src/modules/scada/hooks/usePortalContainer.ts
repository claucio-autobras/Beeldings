'use client';

// Hook promovido para uso global (Topbar/NewAlarmModal também precisam dele).
// Mantido aqui como re-export para não quebrar imports do módulo SCADA.
export { usePortalContainer } from '@/hooks/usePortalContainer';
