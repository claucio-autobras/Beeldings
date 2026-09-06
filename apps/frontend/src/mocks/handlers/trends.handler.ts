import {
  mockTrendRecords,
  mockTrendVariables,
  type TrendRecord,
  type TrendVariable,
  type TrendChartPoint,
} from '@/mocks/data/trends.mock';

export interface TrendsFilters {
  tenantId?: string;
  siteId?: string;
  controllerId?: string;
  deviceId?: string;
  variableId?: string;
  variableType?: 'analog' | 'digital';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: keyof TrendRecord;
  sortDir?: 'asc' | 'desc';
}

export interface TrendsSummary {
  totalRecords: number;
  totalChanges: number;
  firstOccurrence: string | null;
  lastOccurrence: string | null;
  readingInterval: string;
}

export interface TrendsPage {
  records: TrendRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TrendsData {
  summary: TrendsSummary;
  chartPoints: TrendChartPoint[];
  page: TrendsPage;
  variables: TrendVariable[];
}

function applyFilters(records: TrendRecord[], filters: TrendsFilters): TrendRecord[] {
  let result = records;

  if (filters.tenantId) {
    result = result.filter((r) => r.tenantId === filters.tenantId);
  }
  if (filters.siteId) {
    result = result.filter((r) => r.siteId === filters.siteId);
  }
  if (filters.controllerId) {
    result = result.filter((r) => r.controllerId === filters.controllerId);
  }
  if (filters.deviceId) {
    result = result.filter((r) => r.deviceId === filters.deviceId);
  }
  if (filters.variableId) {
    result = result.filter((r) => r.variableId === filters.variableId);
  }
  if (filters.variableType) {
    result = result.filter((r) => r.type === filters.variableType);
  }
  if (filters.dateFrom) {
    result = result.filter((r) => r.timestamp >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    result = result.filter((r) => r.timestamp <= filters.dateTo!);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.tag.toLowerCase().includes(q) ||
        r.device.toLowerCase().includes(q) ||
        r.site.toLowerCase().includes(q) ||
        r.controller.toLowerCase().includes(q),
    );
  }

  return result;
}

function computeSummary(records: TrendRecord[]): TrendsSummary {
  if (records.length === 0) {
    return {
      totalRecords: 0,
      totalChanges: 0,
      firstOccurrence: null,
      lastOccurrence: null,
      readingInterval: '—',
    };
  }

  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const changes = records.filter(
    (r) => r.previousValue !== null && r.previousValue !== r.newValue,
  ).length;

  // Derive reading interval from first record that has it
  const readingInterval = records.find((r) => r.readingInterval)?.readingInterval ?? '—';

  const last = sorted[sorted.length - 1];

  return {
    totalRecords: records.length,
    totalChanges: changes,
    firstOccurrence: sorted[0].timestamp,
    lastOccurrence: last.timestamp,
    readingInterval,
  };
}

function buildChartPoints(records: TrendRecord[]): TrendChartPoint[] {
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return sorted.map((r) => ({
    timestamp: r.timestamp,
    value: typeof r.newValue === 'boolean' ? (r.newValue ? 1 : 0) : (r.newValue as number),
  }));
}

export const trendsHandler = {
  getVariables(tenantId?: string): TrendVariable[] {
    if (!tenantId) return mockTrendVariables;
    return mockTrendVariables.filter((v) => v.tenantId === tenantId);
  },

  get(filters: TrendsFilters): TrendsData {
    const filtered = applyFilters(mockTrendRecords, filters);

    // Sort
    const sortField = filters.sortField ?? 'timestamp';
    const sortDir = filters.sortDir ?? 'desc';
    const sorted = [...filtered].sort((a, b) => {
      const va = a[sortField] as string | number | boolean | null;
      const vb = b[sortField] as string | number | boolean | null;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    // Paginate
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const pageRecords = sorted.slice(start, start + pageSize);

    // Chart always sorted ascending regardless of table sort
    const chartPoints = buildChartPoints(filtered);

    // Summary operates on all filtered (not paginated)
    const summary = computeSummary(filtered);

    // Variables scoped to the tenant filter
    const variables = trendsHandler.getVariables(filters.tenantId);

    return {
      summary,
      chartPoints,
      page: {
        records: pageRecords,
        total,
        page,
        pageSize,
        totalPages,
      },
      variables,
    };
  },
};
