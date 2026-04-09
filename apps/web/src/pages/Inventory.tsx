import { useEffect, useState, useMemo } from 'react';
import {
  Package, Plus, Search, X, ArrowDownCircle, ArrowUpCircle, RotateCcw, Settings2,
  AlertTriangle, ChevronLeft, TrendingUp,
} from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth';

interface InventoryItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  specification?: string;
  minStock: number;
  currentStock: number;
  unitPrice?: number;
  location?: string;
  category?: { id: string; name: string };
  supplier?: { id: string; companyName: string };
}

interface Transaction {
  id: string;
  type: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  beforeStock: number;
  afterStock: number;
  reason?: string;
  reference?: string;
  processedAt: string;
  item: { id: string; name: string; code: string; unit: string };
  processor: { id: string; name: string };
}

interface Category {
  id: string;
  name: string;
  children: Category[];
}

interface Stats {
  totalItems: number;
  lowStockCount: number;
  totalValue: number;
  todayTransactions: number;
}

const txTypeLabel: Record<string, { text: string; color: string; icon: any }> = {
  in_stock: { text: '입고', color: 'text-green-600 bg-green-50', icon: ArrowDownCircle },
  out_stock: { text: '출고', color: 'text-red-600 bg-red-50', icon: ArrowUpCircle },
  return_stock: { text: '반품', color: 'text-primary-600 bg-primary-50', icon: RotateCcw },
  adjust: { text: '조정', color: 'text-orange-600 bg-orange-50', icon: Settings2 },
};

/* ── 월별 재고 추이 선 그래프 ── */
const CHART_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4',
  '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b',
];

interface StockTrendData {
  labels: string[];
  series: { id: string; name: string; code: string; unit: string; data: number[] }[];
}

function InventoryChart() {
  const [months, setMonths] = useState(6);
  const [chartData, setChartData] = useState<StockTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<{ sIdx: number; pIdx: number } | null>(null);

  useEffect(() => {
    const fetchChart = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/inventory/stats/stock-trend?months=${months}`);
        setChartData(res.data.data);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchChart();
  }, [months]);

  // 차트 영역 상수
  const W = 600, H = 240, PAD = { top: 20, right: 20, bottom: 35, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxVal = useMemo(() => {
    if (!chartData) return 1;
    let max = 0;
    for (const s of chartData.series) for (const v of s.data) max = Math.max(max, v);
    return max || 1;
  }, [chartData]);

  const toX = (i: number, count: number) => PAD.left + (count > 1 ? (i / (count - 1)) * plotW : plotW / 2);
  const toY = (v: number) => PAD.top + plotH - (v / maxVal) * plotH;

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <TrendingUp size={16} className="text-primary-500" /> 월별 재고 추이
        </h3>
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
          {([6, 12] as const).map(m => (
            <button key={m} onClick={() => setMonths(m)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                months === m ? 'bg-white shadow-sm text-primary-600' : 'text-gray-500'
              }`}>
              {m}개월
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-52 flex items-center justify-center text-gray-400 text-sm">로딩중...</div>
      ) : !chartData || chartData.series.length === 0 ? (
        <div className="h-52 flex items-center justify-center text-gray-400 text-sm">
          <div className="text-center">
            <TrendingUp size={32} className="mx-auto mb-2 opacity-30" />
            <p>재고 데이터가 없습니다</p>
            <p className="text-xs mt-1">자재를 등록하면 재고 추이가 표시됩니다</p>
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 400 }}>
              {/* Y축 그리드 + 라벨 */}
              {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
                const y = toY(maxVal * ratio);
                return (
                  <g key={ratio}>
                    <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e5e7eb" strokeDasharray={ratio === 0 ? '' : '4 4'} />
                    <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{Math.round(maxVal * ratio)}</text>
                  </g>
                );
              })}

              {/* X축 라벨 */}
              {chartData.labels.map((label, i) => (
                <g key={i}>
                  <line x1={toX(i, chartData.labels.length)} y1={PAD.top} x2={toX(i, chartData.labels.length)} y2={PAD.top + plotH} stroke="#f3f4f6" />
                  <text x={toX(i, chartData.labels.length)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">{label}</text>
                </g>
              ))}

              {/* 각 부품의 선 */}
              {chartData.series.map((s, sIdx) => {
                const color = CHART_COLORS[sIdx % CHART_COLORS.length];
                const n = chartData.labels.length;
                const points = s.data.map((v, i) => `${toX(i, n)},${toY(v)}`).join(' ');
                // 영역 채우기 path
                const areaPath = `M${toX(0, n)},${toY(s.data[0])} ` +
                  s.data.map((v, i) => `L${toX(i, n)},${toY(v)}`).join(' ') +
                  ` L${toX(n - 1, n)},${PAD.top + plotH} L${toX(0, n)},${PAD.top + plotH} Z`;

                return (
                  <g key={s.id}>
                    {/* 영역 그라데이션 */}
                    <path d={areaPath} fill={color} opacity={0.06} />
                    {/* 선 */}
                    <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {/* 점 */}
                    {s.data.map((v, i) => {
                      const isHovered = hoveredPoint?.sIdx === sIdx && hoveredPoint?.pIdx === i;
                      return (
                        <g key={i}
                          onMouseEnter={() => setHoveredPoint({ sIdx, pIdx: i })}
                          onMouseLeave={() => setHoveredPoint(null)}
                        >
                          <circle cx={toX(i, n)} cy={toY(v)} r={isHovered ? 5 : 3} fill="white" stroke={color} strokeWidth={2} className="cursor-pointer" />
                          {isHovered && (
                            <>
                              <rect x={toX(i, n) - 40} y={toY(v) - 28} width={80} height={22} rx={6} fill="#1f2937" opacity={0.9} />
                              <text x={toX(i, n)} y={toY(v) - 14} textAnchor="middle" fontSize="10" fill="white" fontWeight="600">
                                {s.name}: {v} {s.unit}
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t">
            {chartData.series.map((s, idx) => {
              const color = CHART_COLORS[idx % CHART_COLORS.length];
              const current = s.data[s.data.length - 1];
              return (
                <div key={s.id} className="flex items-center gap-1.5 text-xs">
                  <div className="w-5 h-0.5 rounded" style={{ background: color }} />
                  <span className="text-gray-700 font-medium">{s.name}</span>
                  <span className="text-gray-400">({current} {s.unit})</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function InventoryPage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<'items' | 'transactions'>('items');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txItem, setTxItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });

  useEffect(() => {
    fetchCategories();
    fetchStats();
  }, []);

  useEffect(() => {
    if (tab === 'items') fetchItems();
    else fetchTransactions();
  }, [tab, search, categoryFilter, lowStockOnly, pagination.page]);

  const fetchStats = async () => {
    try {
      const res = await api.get('/inventory/stats/summary');
      setStats(res.data.data);
    } catch (err) { console.error(err); }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get('/inventory/categories');
      setCategories(res.data.data);
    } catch (err) { console.error(err); }
  };

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pagination.page.toString(), limit: '20' });
      if (search) params.set('search', search);
      if (categoryFilter) params.set('categoryId', categoryFilter);
      if (lowStockOnly) params.set('lowStock', 'true');
      const res = await api.get(`/inventory/items?${params}`);
      setItems(res.data.data);
      setPagination(res.data.meta);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pagination.page.toString(), limit: '20' });
      const res = await api.get(`/inventory/transactions?${params}`);
      setTransactions(res.data.data);
      setPagination(res.data.meta);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchItemDetail = async (id: string) => {
    try {
      const res = await api.get(`/inventory/items/${id}`);
      setSelectedItem(res.data.data);
    } catch (err) { console.error(err); }
  };

  const handleCreateItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/inventory/items', {
        code: form.get('code'),
        name: form.get('name'),
        categoryId: form.get('categoryId') || undefined,
        unit: form.get('unit') || 'EA',
        specification: form.get('specification') || undefined,
        minStock: parseInt(form.get('minStock') as string) || 0,
        unitPrice: parseFloat(form.get('unitPrice') as string) || undefined,
        location: form.get('location') || undefined,
      });
      setShowCreateModal(false);
      fetchItems();
      fetchStats();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '등록 중 오류가 발생했습니다');
    }
  };

  const handleTransaction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!txItem) return;
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/inventory/transactions', {
        itemId: txItem.id,
        type: form.get('type'),
        quantity: parseInt(form.get('quantity') as string),
        unitPrice: parseFloat(form.get('unitPrice') as string) || undefined,
        reason: form.get('reason') || undefined,
        reference: form.get('reference') || undefined,
      });
      setShowTxModal(false);
      setTxItem(null);
      fetchItems();
      fetchStats();
      if (selectedItem) fetchItemDetail(selectedItem.id);
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '처리 중 오류가 발생했습니다');
    }
  };

  const formatDate = (dt: string) => new Date(dt).toLocaleDateString('ko-KR');
  const formatDateTime = (dt: string) => new Date(dt).toLocaleString('ko-KR');

  // Item Detail View
  if (selectedItem) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => setSelectedItem(null)} className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-4">
          <ChevronLeft size={16} /> 목록으로
        </button>

        <div className="card mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-gray-400 font-mono">{selectedItem.code}</p>
              <h2 className="text-xl font-bold">{selectedItem.name}</h2>
              {selectedItem.specification && <p className="text-sm text-gray-500">{selectedItem.specification}</p>}
            </div>
            <button onClick={() => { setTxItem(selectedItem); setShowTxModal(true); }} className="btn-primary text-sm">입출고</button>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center py-4 bg-primary-50/50 rounded-2xl">
              <p className="text-gray-500 text-sm">현재 재고</p>
              <p className={`text-3xl font-bold mt-1 ${selectedItem.currentStock <= selectedItem.minStock ? 'text-red-600' : 'text-gray-800'}`}>
                {selectedItem.currentStock} <span className="text-sm font-normal text-gray-500">{selectedItem.unit}</span>
              </p>
            </div>
            <div className="text-center py-4 bg-primary-50/50 rounded-2xl">
              <p className="text-gray-500 text-sm">안전 재고</p>
              <p className="text-3xl font-bold mt-1">{selectedItem.minStock} <span className="text-sm font-normal text-gray-500">{selectedItem.unit}</span></p>
            </div>
            <div className="text-center py-4 bg-primary-50/50 rounded-2xl">
              <p className="text-gray-500 text-sm">단가</p>
              <p className="text-3xl font-bold mt-1">{selectedItem.unitPrice?.toLocaleString() || '-'}<span className="text-sm font-normal text-gray-500">원</span></p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm mb-6">
            <div><span className="text-gray-500">카테고리:</span> {selectedItem.category?.name || '-'}</div>
            <div><span className="text-gray-500">보관위치:</span> {selectedItem.location || '-'}</div>
            <div><span className="text-gray-500">공급업체:</span> {selectedItem.supplier?.companyName || '-'}</div>
            <div><span className="text-gray-500">재고가치:</span> {((selectedItem.currentStock * (selectedItem.unitPrice || 0))).toLocaleString()}원</div>
          </div>

          {/* Recent Transactions */}
          <div className="border-t pt-4">
            <h4 className="font-semibold text-sm mb-3">최근 입출고 이력</h4>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-gray-500">
                <th className="pb-2">일시</th><th className="pb-2">구분</th><th className="pb-2">수량</th><th className="pb-2">재고변동</th><th className="pb-2">처리자</th><th className="pb-2">사유</th>
              </tr></thead>
              <tbody>
                {(selectedItem.transactions || []).map((tx: any) => {
                  const typeInfo = txTypeLabel[tx.type];
                  return (
                    <tr key={tx.id} className="border-b last:border-0">
                      <td className="py-2">{formatDateTime(tx.processedAt)}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeInfo?.color}`}>{typeInfo?.text}</span>
                      </td>
                      <td className="py-2">{tx.quantity}</td>
                      <td className="py-2 text-gray-500">{tx.beforeStock} → {tx.afterStock}</td>
                      <td className="py-2">{tx.processor.name}</td>
                      <td className="py-2 text-gray-500">{tx.reason || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package size={24} /> 자재관리
        </h1>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> 자재 등록
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: '전체 자재', value: stats.totalItems.toString(), unit: '종', color: 'text-primary-600' },
            { label: '부족 재고', value: stats.lowStockCount.toString(), unit: '종', color: stats.lowStockCount > 0 ? 'text-red-600' : 'text-green-600' },
            { label: '총 재고가치', value: stats.totalValue.toLocaleString(), unit: '원', color: 'text-gray-800' },
            { label: '오늘 입출고', value: stats.todayTransactions.toString(), unit: '건', color: 'text-purple-600' },
          ].map(s => (
            <div key={s.label} className="card text-center py-4">
              <p className="text-gray-500 text-sm">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}<span className="text-sm font-normal text-gray-500 ml-1">{s.unit}</span></p>
            </div>
          ))}
        </div>
      )}

      {/* 입출고 추이 차트 */}
      <InventoryChart />

      {/* Tabs */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-1 bg-primary-50/50 p-1.5 rounded-2xl">
          <button onClick={() => setTab('items')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${tab === 'items' ? 'bg-white shadow-sm text-primary-600' : 'text-gray-500'}`}>
            자재 목록
          </button>
          <button onClick={() => setTab('transactions')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${tab === 'transactions' ? 'bg-white shadow-sm text-primary-600' : 'text-gray-500'}`}>
            입출고 이력
          </button>
        </div>

        {tab === 'items' && (
          <>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input-field w-40">
              <option value="">카테고리 전체</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lowStockOnly} onChange={e => setLowStockOnly(e.target.checked)} className="rounded" />
              <AlertTriangle size={14} className="text-red-500" /> 부족 재고만
            </label>
          </>
        )}

        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="자재명 또는 코드 검색..." className="input-field pl-9 w-full" />
        </div>
      </div>

      {/* Content */}
      <div className="card">
        {tab === 'items' ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-3 font-medium">코드</th>
                <th className="pb-3 font-medium">자재명</th>
                <th className="pb-3 font-medium">카테고리</th>
                <th className="pb-3 font-medium text-right">현재 재고</th>
                <th className="pb-3 font-medium text-right">안전 재고</th>
                <th className="pb-3 font-medium text-right">단가</th>
                <th className="pb-3 font-medium">보관위치</th>
                <th className="pb-3 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">로딩중...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">자재가 없습니다</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className="border-b last:border-0 hover:bg-primary-50/50">
                  <td className="py-3 font-mono text-xs text-gray-500 cursor-pointer" onClick={() => fetchItemDetail(item.id)}>{item.code}</td>
                  <td className="py-3 cursor-pointer" onClick={() => fetchItemDetail(item.id)}>
                    <span className="font-medium">{item.name}</span>
                    {item.specification && <span className="text-xs text-gray-400 ml-1">({item.specification})</span>}
                  </td>
                  <td className="py-3 text-gray-500">{item.category?.name || '-'}</td>
                  <td className="py-3 text-right">
                    <span className={item.currentStock <= item.minStock ? 'text-red-600 font-bold' : ''}>
                      {item.currentStock}
                    </span>
                    <span className="text-gray-400 ml-1">{item.unit}</span>
                    {item.currentStock <= item.minStock && <AlertTriangle size={14} className="inline ml-1 text-red-500" />}
                  </td>
                  <td className="py-3 text-right text-gray-500">{item.minStock}</td>
                  <td className="py-3 text-right">{item.unitPrice?.toLocaleString() || '-'}</td>
                  <td className="py-3 text-gray-500">{item.location || '-'}</td>
                  <td className="py-3">
                    <button onClick={() => { setTxItem(item); setShowTxModal(true); }}
                      className="text-primary-600 hover:text-primary-800 text-sm font-medium">입출고</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-3 font-medium">일시</th>
                <th className="pb-3 font-medium">구분</th>
                <th className="pb-3 font-medium">자재</th>
                <th className="pb-3 font-medium text-right">수량</th>
                <th className="pb-3 font-medium text-right">재고변동</th>
                <th className="pb-3 font-medium">처리자</th>
                <th className="pb-3 font-medium">사유/참조</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">로딩중...</td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">이력이 없습니다</td></tr>
              ) : transactions.map(tx => {
                const typeInfo = txTypeLabel[tx.type];
                return (
                  <tr key={tx.id} className="border-b last:border-0 hover:bg-primary-50/50">
                    <td className="py-3 text-gray-500">{formatDateTime(tx.processedAt)}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeInfo?.color}`}>{typeInfo?.text}</span>
                    </td>
                    <td className="py-3">
                      <span className="font-medium">{tx.item.name}</span>
                      <span className="text-xs text-gray-400 ml-1">({tx.item.code})</span>
                    </td>
                    <td className="py-3 text-right">{tx.quantity} {tx.item.unit}</td>
                    <td className="py-3 text-right text-gray-500">{tx.beforeStock} → {tx.afterStock}</td>
                    <td className="py-3">{tx.processor.name}</td>
                    <td className="py-3 text-gray-500">{tx.reason || tx.reference || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {pagination.totalPages > 1 && (
          <div className="flex justify-center gap-1 mt-4 pt-4 border-t">
            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPagination(prev => ({ ...prev, page: p }))}
                className={`px-3 py-1 rounded text-sm ${pagination.page === p ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create Item Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">자재 등록</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateItem} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">자재코드 *</label>
                  <input type="text" name="code" className="input-field" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">자재명 *</label>
                  <input type="text" name="name" className="input-field" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                  <select name="categoryId" className="input-field">
                    <option value="">미분류</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">단위</label>
                  <select name="unit" className="input-field">
                    {['EA', 'BOX', 'SET', 'KG', 'M', 'L', 'ROLL'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">규격</label>
                <input type="text" name="specification" className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">안전 재고</label>
                  <input type="number" name="minStock" className="input-field" defaultValue={0} min={0} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">단가 (원)</label>
                  <input type="number" name="unitPrice" className="input-field" min={0} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">보관위치</label>
                <input type="text" name="location" className="input-field" placeholder="예: A동 1층 선반3" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">취소</button>
                <button type="submit" className="btn-primary">등록</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction Modal */}
      {showTxModal && txItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">입출고 처리 - {txItem.name}</h3>
              <button onClick={() => { setShowTxModal(false); setTxItem(null); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              현재 재고: <span className="font-bold text-gray-800">{txItem.currentStock} {txItem.unit}</span>
            </p>
            <form onSubmit={handleTransaction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">구분 *</label>
                <select name="type" className="input-field" required>
                  <option value="in_stock">입고</option>
                  <option value="out_stock">출고</option>
                  <option value="return_stock">반품</option>
                  <option value="adjust">재고 조정</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">수량 *</label>
                <input type="number" name="quantity" className="input-field" required min={1} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">단가 (원)</label>
                <input type="number" name="unitPrice" className="input-field" min={0} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사유</label>
                <input type="text" name="reason" className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">참조 문서번호</label>
                <input type="text" name="reference" className="input-field" placeholder="작업지시서 번호 등" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setShowTxModal(false); setTxItem(null); }} className="btn-secondary">취소</button>
                <button type="submit" className="btn-primary">처리</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
