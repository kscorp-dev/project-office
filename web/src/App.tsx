import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>Project Office</div>} />
        {/* TODO: 페이지 라우트 추가 */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
