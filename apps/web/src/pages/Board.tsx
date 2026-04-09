import { useEffect, useState } from 'react';
import { Newspaper, Search, Pin, Eye, MessageCircle, Plus, X, ChevronLeft, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth';

interface BoardItem {
  id: string;
  name: string;
  type: string;
  description?: string;
}

interface PostItem {
  id: string;
  title: string;
  isPinned: boolean;
  isMustRead: boolean;
  viewCount: number;
  createdAt: string;
  author: { id: string; name: string; position?: string };
  _count: { comments: number };
}

interface PostDetail {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  isMustRead: boolean;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; position?: string };
  board: { id: string; name: string };
  comments: CommentItem[];
  attachments: { id: string; fileName: string; fileSize: number }[];
  _count: { reads: number };
}

interface CommentItem {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string };
  replies: CommentItem[];
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function BoardPage() {
  const { user } = useAuthStore();
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<BoardItem | null>(null);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [selectedPost, setSelectedPost] = useState<PostDetail | null>(null);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoards();
  }, []);

  useEffect(() => {
    if (selectedBoard) fetchPosts();
  }, [selectedBoard, pagination.page, search]);

  const fetchBoards = async () => {
    try {
      const res = await api.get('/board/boards');
      setBoards(res.data.data);
      if (res.data.data.length > 0) setSelectedBoard(res.data.data[0]);
    } catch (err) {
      console.error('Board fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPosts = async () => {
    if (!selectedBoard) return;
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });
      if (search) params.set('search', search);
      const res = await api.get(`/board/boards/${selectedBoard.id}/posts?${params}`);
      setPosts(res.data.data);
      setPagination(res.data.meta);
    } catch (err) {
      console.error('Posts fetch error:', err);
    }
  };

  const fetchPostDetail = async (postId: string) => {
    try {
      const res = await api.get(`/board/posts/${postId}`);
      setSelectedPost(res.data.data);
    } catch (err) {
      console.error('Post detail fetch error:', err);
    }
  };

  const handleCreatePost = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedBoard) return;
    const form = new FormData(e.currentTarget);
    try {
      await api.post(`/board/boards/${selectedBoard.id}/posts`, {
        title: form.get('title'),
        content: form.get('content'),
        isPinned: form.get('isPinned') === 'on',
        isMustRead: form.get('isMustRead') === 'on',
      });
      setShowCreateModal(false);
      fetchPosts();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '게시글 작성 중 오류가 발생했습니다');
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('게시글을 삭제하시겠습니까?')) return;
    try {
      await api.delete(`/board/posts/${postId}`);
      setSelectedPost(null);
      fetchPosts();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '삭제 중 오류가 발생했습니다');
    }
  };

  const handleAddComment = async () => {
    if (!selectedPost || !newComment.trim()) return;
    try {
      await api.post(`/board/posts/${selectedPost.id}/comments`, { content: newComment });
      setNewComment('');
      fetchPostDetail(selectedPost.id);
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '댓글 작성 중 오류가 발생했습니다');
    }
  };

  const formatDate = (dt: string) => {
    const d = new Date(dt);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  const boardTypeLabel: Record<string, string> = {
    notice: '공지사항', general: '자유게시판', department: '부서게시판',
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-400">로딩중...</div>;
  }

  // Post Detail View
  if (selectedPost) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => setSelectedPost(null)} className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-4">
          <ChevronLeft size={16} /> 목록으로
        </button>
        <div className="card">
          <div className="border-b pb-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              {selectedPost.isPinned && <Pin size={14} className="text-primary-600" />}
              {selectedPost.isMustRead && <AlertCircle size={14} className="text-red-500" />}
              <span className="text-xs text-gray-400">{selectedPost.board.name}</span>
            </div>
            <h2 className="text-xl font-bold">{selectedPost.title}</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <span>{selectedPost.author.name}{selectedPost.author.position ? ` (${selectedPost.author.position})` : ''}</span>
              <span>{new Date(selectedPost.createdAt).toLocaleString('ko-KR')}</span>
              <span className="flex items-center gap-1"><Eye size={14} /> {selectedPost.viewCount}</span>
            </div>
          </div>

          <div className="prose max-w-none mb-6 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: selectedPost.content }} />

          {/* Actions */}
          {(selectedPost.author.id === user?.id || ['super_admin', 'admin'].includes(user?.role || '')) && (
            <div className="flex justify-end gap-2 border-t pt-4 mb-4">
              <button onClick={() => handleDeletePost(selectedPost.id)} className="btn-secondary text-red-600 hover:bg-red-50">삭제</button>
            </div>
          )}

          {/* Comments */}
          <div className="border-t pt-4">
            <h3 className="font-semibold mb-4">댓글 {selectedPost.comments.length}개</h3>
            <div className="space-y-4">
              {selectedPost.comments.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{c.author.name}</span>
                    <span className="text-xs text-gray-400">{formatDate(c.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-700">{c.content}</p>
                  {c.replies.length > 0 && (
                    <div className="ml-6 mt-2 space-y-2 border-l-2 pl-4">
                      {c.replies.map((r) => (
                        <div key={r.id}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{r.author.name}</span>
                            <span className="text-xs text-gray-400">{formatDate(r.createdAt)}</span>
                          </div>
                          <p className="text-sm text-gray-700">{r.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add Comment */}
            <div className="flex gap-2 mt-4">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                placeholder="댓글을 입력하세요"
                className="input-field flex-1"
              />
              <button onClick={handleAddComment} className="btn-primary">등록</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Board List View
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Newspaper size={24} /> 게시판
      </h1>

      {/* Board Tabs */}
      <div className="flex gap-1 mb-4 bg-primary-50/50 p-1.5 rounded-2xl overflow-x-auto">
        {boards.map((board) => (
          <button
            key={board.id}
            onClick={() => { setSelectedBoard(board); setPagination(p => ({ ...p, page: 1 })); }}
            className={`px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
              selectedBoard?.id === board.id ? 'bg-white shadow-sm text-primary-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {board.name}
            <span className="ml-1 text-xs text-gray-400">{boardTypeLabel[board.type] || ''}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="검색..."
            className="input-field pl-9 w-64"
          />
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> 글쓰기
        </button>
      </div>

      {/* Post List */}
      <div className="card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-3 font-medium w-16 text-center">번호</th>
              <th className="pb-3 font-medium">제목</th>
              <th className="pb-3 font-medium w-24">작성자</th>
              <th className="pb-3 font-medium w-20 text-center">조회</th>
              <th className="pb-3 font-medium w-24 text-center">날짜</th>
            </tr>
          </thead>
          <tbody>
            {posts.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400">게시글이 없습니다</td></tr>
            ) : (
              posts.map((post, i) => (
                <tr
                  key={post.id}
                  onClick={() => fetchPostDetail(post.id)}
                  className="border-b last:border-0 hover:bg-primary-50/50 cursor-pointer"
                >
                  <td className="py-3 text-center text-gray-400">
                    {post.isPinned ? <Pin size={14} className="mx-auto text-primary-600" /> : pagination.total - ((pagination.page - 1) * pagination.limit + i)}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      {post.isMustRead && <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded">필독</span>}
                      <span className="font-medium">{post.title}</span>
                      {post._count.comments > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-primary-600">
                          <MessageCircle size={12} /> {post._count.comments}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 text-gray-600">{post.author.name}</td>
                  <td className="py-3 text-center text-gray-400">{post.viewCount}</td>
                  <td className="py-3 text-center text-gray-400">{formatDate(post.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex justify-center gap-1 mt-4 pt-4 border-t">
            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => setPagination(p => ({ ...p, page }))}
                className={`px-3 py-1 rounded text-sm ${
                  pagination.page === page ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {page}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create Post Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">글쓰기 - {selectedBoard?.name}</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreatePost} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input type="text" name="title" className="input-field" required maxLength={200} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">내용</label>
                <textarea name="content" rows={12} className="input-field" required />
              </div>
              {['super_admin', 'admin', 'dept_admin'].includes(user?.role || '') && (
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isPinned" className="rounded" />
                    <Pin size={14} /> 상단 고정
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isMustRead" className="rounded" />
                    <AlertCircle size={14} /> 필독
                  </label>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">취소</button>
                <button type="submit" className="btn-primary">등록</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
