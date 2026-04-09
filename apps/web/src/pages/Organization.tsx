import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';
import { ChevronRight, ChevronDown, Users, User, Plus, Building2 } from 'lucide-react';

interface DeptNode {
  id: string;
  name: string;
  code: string;
  manager?: { id: string; name: string; position?: string; profileImage?: string };
  _count?: { users: number };
  children: DeptNode[];
}

interface UserInfo {
  id: string;
  name: string;
  employeeId: string;
  position?: string;
  role: string;
  profileImage?: string;
}

export default function OrganizationPage() {
  const { user: currentUser } = useAuthStore();
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [members, setMembers] = useState<UserInfo[]>([]);
  const [deptInfo, setDeptInfo] = useState<{ name: string; code: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/departments').then(({ data }) => {
      setTree(data.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSelectDept = async (deptId: string) => {
    setSelectedDept(deptId);
    try {
      const { data } = await api.get(`/departments/${deptId}`);
      setMembers(data.data.users || []);
      setDeptInfo({ name: data.data.name, code: data.data.code });
    } catch {
      setMembers([]);
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-400">로딩 중...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">조직도</h1>
        {(currentUser?.role === 'super_admin' || currentUser?.role === 'admin') && (
          <button className="btn-primary flex items-center gap-2">
            <Plus size={16} />
            부서 추가
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tree */}
        <div className="card lg:col-span-1">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">부서 목록</h2>
          <div className="space-y-1">
            {tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                selectedId={selectedDept}
                onSelect={handleSelectDept}
                depth={0}
              />
            ))}
          </div>
        </div>

        {/* Members */}
        <div className="card lg:col-span-2">
          {selectedDept && deptInfo ? (
            <>
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={20} className="text-primary-600" />
                <h2 className="text-lg font-semibold text-gray-900">{deptInfo.name}</h2>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">{deptInfo.code}</span>
                <span className="text-sm text-gray-400 ml-auto">{members.length}명</span>
              </div>
              {members.length > 0 ? (
                <div className="divide-y">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 py-3">
                      <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-sm">
                        {m.name[0]}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{m.name}</p>
                        <p className="text-xs text-gray-400">{m.employeeId} {m.position && `| ${m.position}`}</p>
                      </div>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">{roleLabel(m.role)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <Users size={48} className="mx-auto mb-2 opacity-50" />
                  <p>소속 인원이 없습니다</p>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <Users size={48} className="mx-auto mb-2 opacity-50" />
              <p>부서를 선택하면 소속 인원이 표시됩니다</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNode({ node, selectedId, onSelect, depth }: {
  node: DeptNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;

  return (
    <div>
      <button
        onClick={() => { onSelect(node.id); if (hasChildren) setExpanded(!expanded); }}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-2xl text-sm transition-colors ${
          isSelected ? 'bg-primary-50 text-primary-700 font-medium' : 'hover:bg-primary-50/50 text-gray-700'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        ) : (
          <span className="w-3.5" />
        )}
        <span>{node.name}</span>
        {node._count && (
          <span className="text-xs text-gray-400 ml-auto">{node._count.users}</span>
        )}
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    super_admin: '최고관리자',
    admin: '관리자',
    dept_admin: '부서관리자',
    user: '일반',
    guest: '게스트',
  };
  return map[role] || role;
}
