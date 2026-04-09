import { useEffect, useState } from 'react';
import {
  FolderOpen, Folder, FileText, Search, Plus, X, Upload,
  Download, Share2, ChevronRight, ChevronDown, RefreshCw,
  HardDrive, Files, Tag,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  isShared: boolean;
  ownerId: string;
  children?: FolderNode[];
  _count?: { documents: number };
}

interface DocumentItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  description?: string;
  tags: string[];
  isShared: boolean;
  downloadCount: number;
  uploadedAt: string;
  uploader: { id: string; name: string; position?: string };
  folderId: string | null;
}

interface DocStats {
  totalFiles: number;
  totalFolders: number;
  totalSize: number;
  sharedFiles: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return '🖼';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '🗜';
  return '📎';
}

interface FolderTreeItemProps {
  node: FolderNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}

function FolderTreeItem({ node, selectedId, onSelect, depth = 0 }: FolderTreeItemProps) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <button
        onClick={() => { onSelect(node.id); if (hasChildren) setOpen((o) => !o); }}
        className={`w-full flex items-center gap-1.5 py-1.5 px-2 rounded text-sm text-left hover:bg-gray-100 transition-colors ${
          selectedId === node.id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (
          open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {open ? <FolderOpen size={14} className="shrink-0 text-yellow-500" /> : <Folder size={14} className="shrink-0 text-yellow-500" />}
        <span className="truncate">{node.name}</span>
        {node._count?.documents != null && (
          <span className="ml-auto text-xs text-gray-400">{node._count.documents}</span>
        )}
      </button>
      {open && hasChildren && node.children!.map((child) => (
        <FolderTreeItem key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function DocumentsPage() {
  const { user } = useAuthStore();

  const [myFolders, setMyFolders] = useState<FolderNode[]>([]);
  const [sharedFolders, setSharedFolders] = useState<FolderNode[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [stats, setStats] = useState<DocStats>({ totalFiles: 0, totalFolders: 0, totalSize: 0, sharedFiles: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [docsLoading, setDocsLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showUploadFile, setShowUploadFile] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  useEffect(() => {
    fetchFolders();
    fetchStats();
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [selectedFolderId, search]);

  const fetchFolders = async () => {
    try {
      const [myRes, sharedRes] = await Promise.all([
        api.get('/documents/folders', { params: { type: 'my' } }),
        api.get('/documents/folders', { params: { type: 'shared' } }),
      ]);
      setMyFolders(myRes.data.data || []);
      setSharedFolders(sharedRes.data.data || []);
    } catch (err) {
      console.error('Folder fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get('/documents/stats');
      setStats(res.data.data || { totalFiles: 0, totalFolders: 0, totalSize: 0, sharedFiles: 0 });
    } catch (err) {
      console.error('Stats fetch error:', err);
    }
  };

  const fetchDocuments = async () => {
    setDocsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedFolderId) params.folderId = selectedFolderId;
      if (search) params.search = search;
      const res = await api.get('/documents/files', { params });
      setDocuments(res.data.data || []);
    } catch (err) {
      console.error('Documents fetch error:', err);
    } finally {
      setDocsLoading(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/documents/folders', {
        name: form.get('name'),
        parentId: selectedFolderId || undefined,
        isShared: form.get('isShared') === 'on',
      });
      setShowCreateFolder(false);
      fetchFolders();
      fetchStats();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '폴더 생성 중 오류가 발생했습니다');
    }
  };

  const handleUploadFile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/documents/files', {
        fileName: form.get('fileName'),
        filePath: form.get('filePath'),
        fileSize: Number(form.get('fileSize')),
        mimeType: form.get('mimeType'),
        description: form.get('description') || undefined,
        tags: (form.get('tags') as string)
          ? (form.get('tags') as string).split(',').map((t) => t.trim()).filter(Boolean)
          : [],
        isShared: form.get('isShared') === 'on',
        folderId: selectedFolderId || undefined,
      });
      setShowUploadFile(false);
      fetchDocuments();
      fetchStats();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '파일 등록 중 오류가 발생했습니다');
    }
  };

  const handleDownload = async (doc: DocumentItem) => {
    try {
      await api.post(`/documents/files/${doc.id}/download`);
      setDocuments((prev) =>
        prev.map((d) => d.id === doc.id ? { ...d, downloadCount: d.downloadCount + 1 } : d)
      );
      if (selectedDoc?.id === doc.id) {
        setSelectedDoc((prev) => prev ? { ...prev, downloadCount: prev.downloadCount + 1 } : prev);
      }
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '다운로드 중 오류가 발생했습니다');
    }
  };

  const formatDate = (dt: string) =>
    new Date(dt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });

  const STAT_CARDS = [
    { label: '전체 파일',  value: `${stats.totalFiles}개`,            icon: Files,     color: 'text-primary-600' },
    { label: '폴더 수',    value: `${stats.totalFolders}개`,           icon: Folder,    color: 'text-yellow-600' },
    { label: '사용 용량',  value: formatFileSize(stats.totalSize),     icon: HardDrive, color: 'text-purple-600' },
    { label: '공유 파일',  value: `${stats.sharedFiles}개`,            icon: Share2,    color: 'text-green-600' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <FileText size={24} /> 문서관리
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {STAT_CARDS.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card py-4 flex items-center gap-4">
            <Icon size={28} className={color} />
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-xl font-bold">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-4">
        {/* Sidebar: Folder Tree */}
        <aside className="w-56 shrink-0">
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">내 폴더</span>
              <button
                onClick={() => setShowCreateFolder(true)}
                className="text-gray-400 hover:text-primary-600"
                title="폴더 생성"
              >
                <Plus size={14} />
              </button>
            </div>
            {loading ? (
              <p className="text-xs text-gray-400 px-2 py-1">로딩중...</p>
            ) : myFolders.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-2">폴더 없음</p>
            ) : (
              myFolders.map((f) => (
                <FolderTreeItem
                  key={f.id}
                  node={f}
                  selectedId={selectedFolderId}
                  onSelect={setSelectedFolderId}
                />
              ))
            )}

            <div className="mt-4 mb-2 px-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">공유 폴더</span>
            </div>
            {sharedFolders.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-2">공유 폴더 없음</p>
            ) : (
              sharedFolders.map((f) => (
                <FolderTreeItem
                  key={f.id}
                  node={f}
                  selectedId={selectedFolderId}
                  onSelect={setSelectedFolderId}
                />
              ))
            )}

            {selectedFolderId && (
              <button
                onClick={() => setSelectedFolderId(null)}
                className="mt-3 w-full text-xs text-gray-400 hover:text-gray-600 text-left px-2"
              >
                전체 보기 →
              </button>
            )}
          </div>
        </aside>

        {/* Main Area */}
        <div className="flex-1 min-w-0">
          {/* Toolbar */}
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="파일 검색..."
                className="input-field pl-9"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
                className="btn-secondary text-sm"
              >
                {viewMode === 'list' ? '격자' : '목록'}
              </button>
              <button onClick={() => setShowUploadFile(true)} className="btn-primary flex items-center gap-2">
                <Upload size={16} /> 파일 등록
              </button>
            </div>
          </div>

          {/* File Content */}
          {docsLoading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="animate-spin text-gray-400" size={32} />
            </div>
          ) : viewMode === 'list' ? (
            <div className="card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-3 font-medium">파일명</th>
                    <th className="pb-3 font-medium w-24">크기</th>
                    <th className="pb-3 font-medium w-28">등록일</th>
                    <th className="pb-3 font-medium w-24">등록자</th>
                    <th className="pb-3 font-medium w-32">태그</th>
                    <th className="pb-3 font-medium w-20 text-center">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-400">파일이 없습니다</td>
                    </tr>
                  ) : (
                    documents.map((doc) => (
                      <tr
                        key={doc.id}
                        onClick={() => setSelectedDoc(doc)}
                        className="border-b last:border-0 hover:bg-primary-50/50 cursor-pointer"
                      >
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{fileIcon(doc.mimeType)}</span>
                            <div>
                              <p className="font-medium truncate max-w-[220px]">{doc.fileName}</p>
                              {doc.description && (
                                <p className="text-xs text-gray-400 truncate max-w-[220px]">{doc.description}</p>
                              )}
                            </div>
                            {doc.isShared && <Share2 size={12} className="text-green-500 shrink-0" />}
                          </div>
                        </td>
                        <td className="py-3 text-gray-500">{formatFileSize(doc.fileSize)}</td>
                        <td className="py-3 text-gray-500">{formatDate(doc.uploadedAt)}</td>
                        <td className="py-3 text-gray-600">{doc.uploader.name}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {doc.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                                {tag}
                              </span>
                            ))}
                            {doc.tags.length > 2 && (
                              <span className="text-xs text-gray-400">+{doc.tags.length - 2}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleDownload(doc)}
                            className="text-gray-400 hover:text-primary-600 p-1"
                            title="다운로드"
                          >
                            <Download size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Grid View */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {documents.length === 0 ? (
                <div className="col-span-full py-12 text-center text-gray-400">파일이 없습니다</div>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDoc(doc)}
                    className="card p-4 cursor-pointer hover:shadow-md transition-shadow flex flex-col gap-2"
                  >
                    <div className="text-3xl text-center">{fileIcon(doc.mimeType)}</div>
                    <p className="text-sm font-medium text-center truncate">{doc.fileName}</p>
                    <p className="text-xs text-gray-400 text-center">{formatFileSize(doc.fileSize)}</p>
                    <div className="flex flex-wrap justify-center gap-1">
                      {doc.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                    {doc.isShared && (
                      <Share2 size={12} className="text-green-500 mx-auto" />
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* File Detail Modal */}
      {selectedDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{fileIcon(selectedDoc.mimeType)}</span>
                <div>
                  <h3 className="text-base font-bold">{selectedDoc.fileName}</h3>
                  <p className="text-xs text-gray-400">{selectedDoc.mimeType}</p>
                </div>
              </div>
              <button onClick={() => setSelectedDoc(null)} className="text-gray-400 hover:text-gray-600 ml-2">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {selectedDoc.description && (
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">설명</p>
                  <p>{selectedDoc.description}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">파일 크기</p>
                  <p className="font-medium">{formatFileSize(selectedDoc.fileSize)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">다운로드 수</p>
                  <p className="font-medium">{selectedDoc.downloadCount}회</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">등록자</p>
                  <p className="font-medium">{selectedDoc.uploader.name}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">등록일</p>
                  <p className="font-medium">{formatDate(selectedDoc.uploadedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">공유 여부</p>
                  <p className="font-medium">{selectedDoc.isShared ? '공유됨' : '비공개'}</p>
                </div>
              </div>
              {selectedDoc.tags.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <Tag size={12} /> 태그
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {selectedDoc.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 bg-primary-50 text-primary-700 text-xs rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setSelectedDoc(null)} className="btn-secondary">닫기</button>
              <button onClick={() => handleDownload(selectedDoc)} className="btn-primary flex items-center gap-2">
                <Download size={14} /> 다운로드
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {showCreateFolder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">폴더 생성</h3>
              <button onClick={() => setShowCreateFolder(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">폴더명 *</label>
                <input type="text" name="name" className="input-field" required maxLength={100} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" name="isShared" className="rounded" />
                공유 폴더로 설정
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateFolder(false)} className="btn-secondary">취소</button>
                <button type="submit" className="btn-primary">생성</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload File Modal */}
      {showUploadFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">파일 등록</h3>
              <button onClick={() => setShowUploadFile(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleUploadFile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">파일명 *</label>
                <input type="text" name="fileName" className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">파일 경로 *</label>
                <input type="text" name="filePath" className="input-field" required placeholder="/uploads/..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">파일 크기 (bytes) *</label>
                  <input type="number" name="fileSize" min={0} className="input-field" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">MIME 타입 *</label>
                  <input type="text" name="mimeType" className="input-field" required placeholder="application/pdf" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <textarea name="description" rows={2} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">태그 (쉼표로 구분)</label>
                <input type="text" name="tags" className="input-field" placeholder="보고서, 2024, 재무" />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" name="isShared" className="rounded" />
                공유 파일로 설정
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowUploadFile(false)} className="btn-secondary">취소</button>
                <button type="submit" className="btn-primary">등록</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
