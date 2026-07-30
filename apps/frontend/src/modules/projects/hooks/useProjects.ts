'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProjects,
  createProject,
  deleteProject,
  type CreateProjectDto,
} from '../services/projects.service';

export function useProjects(siteId?: string | null, tenantId?: string | null) {
  return useQuery({
    queryKey: ['projects', siteId ?? null, tenantId ?? null],
    queryFn: () => getProjects(siteId ?? undefined, tenantId ?? undefined),
    staleTime: 30_000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectDto) => createProject(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
