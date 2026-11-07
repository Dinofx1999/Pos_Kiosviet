import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntApp } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'antd/dist/reset.css';
import './styles.css';
import App from './App';
import { startUpdateWatcher } from './updateWatcher';
import { startIosViewportFix } from './iosViewport';

dayjs.locale('vi');
dayjs.extend(relativeTime);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={viVN}
        theme={{
          token: { colorPrimary: '#0070f4', borderRadius: 4, fontSize: 13, colorLink: '#0070f4' },
          components: { Table: { headerBg: '#f3f6fa', cellPaddingBlock: 8, cellPaddingInline: 10 }, Card: { paddingLG: 16 } },
        }}
      >
        <AntApp>
          <App />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

startIosViewportFix();
startUpdateWatcher();
