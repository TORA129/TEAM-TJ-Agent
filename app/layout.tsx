import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Team-TJ · 小红书运营台',
  description: 'Team-TJ 小红书内容创作与复盘工作区',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
