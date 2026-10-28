import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-samsung-dark text-gray-900 dark:text-gray-100">
          <div className="max-w-md w-full bg-white dark:bg-samsung-darkcard p-8 rounded-3xl shadow-2xl border border-gray-200 dark:border-samsung-border text-center">
            <h2 className="text-2xl font-extrabold mb-3 text-red-500">화면을 불러오는 중 문제가 발생했습니다</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              저장된 노트 데이터는 안전하게 보관되어 있습니다. 아래 버튼을 눌러 화면을 다시 불러오세요.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-samsung-blue text-white rounded-xl font-bold shadow-md hover:bg-blue-600 transition-colors"
            >
              화면 다시 불러오기
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
